/**
 * Consumer antrian pekerjaan AI.
 *
 * Inti dari seluruh sistem, dan satu-satunya berkas yang menyentuh ketiga
 * lapisan sekaligus: antrian, penyedia, dan basis data. Karena itu aturan
 * yang mengikatnya ditulis di sini, bukan disebar:
 *
 *   1. **Setiap pekerjaan diakui sendiri-sendiri.** Satu pekerjaan yang
 *      melempar tidak boleh menggagalkan pekerjaan lain di batch yang sama —
 *      pada demo, satu batch sering memuat empat pekerjaan dari satu
 *      katalog, dan kehilangan ketiganya karena yang pertama gagal berarti
 *      mengulang seluruh alur.
 *   2. **Kegagalan permanen tidak diulang.** Pekerjaan yang masukannya tidak
 *      lengkap — pengrajin belum mengunggah foto — akan gagal dengan cara
 *      yang sama pada percobaan kelima. Yang diulang hanya kegagalan
 *      penyedia yang bersifat sementara.
 *   3. **Kode katalog, bukan pesan penyedia.** Yang ditulis ke
 *      `jobs.error_code` dan yang sampai ke layar pengrajin hanyalah kode
 *      dari `lib/errors.ts` (AGENTS.md aturan 2).
 *
 * Yang TIDAK dilakukan berkas ini: membuka Chrome. Jalur Gemini dijalankan
 * Studio Agent di laptop, mengambil pekerjaannya lewat
 * `POST /agent/jobs/claim`. Antrian ini adalah jalur cadangan yang harus
 * bekerja tanpa agen sama sekali.
 */

import { ulid } from "ulid";

import type { ErrorCode } from "../../lib/errors";
import type { JobKind, Locale } from "../../lib/schemas";

import {
  d1FailJob,
  d1FinishAsrJob,
  d1FinishCopyJob,
  d1FinishImageJob,
  d1LoadJobContext,
  d1RequeueJob,
  d1SetProgress,
  d1StartJob,
  type JobContext,
} from "./d1-queue";
import { imageChainSteps, runProviderChain, textChainSteps, transcriptionChainSteps } from "./chain";
import { buildImagePrompt } from "./payload";
import {
  createGroqTextProvider,
  createGroqTranscriptionProvider,
  createNineRouterTextProvider,
  createWorkersAiImageProvider,
  createWorkersAiTextProvider,
  createWorkersAiTranscriptionProvider,
} from "./providers-impl";
import type { ImageResult } from "./providers";

/** Konfigurasi yang datang dari `Env`. Sengaja sempit: hanya yang dibutuhkan. */
export interface ConsumerEnv {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  readonly AI: Ai;
  readonly GROQ_API_KEY?: string | undefined;
  readonly NINEROUTER_API_KEY?: string | undefined;
  readonly NINEROUTER_BASE_URL?: string | undefined;
}

/** Bentuk pesan antrian. Kontrak API bagian 7: pekerjaan yang baru dijadwalkan. */
export interface JobMessage {
  readonly jobId: string;
  readonly productId: string;
  readonly kind: JobKind;
}

const JOB_KINDS: readonly string[] = ["asr", "copy", "image", "tts", "export"];

/**
 * Membaca pesan antrian.
 *
 * Pesan yang bentuknya tidak dikenal dilewati, bukan digagalkan: pesan lama
 * dari versi sebelumnya dapat masih ada di antrian saat demo, dan
 * menggagalkan batch karenanya berarti kehilangan pekerjaan yang sah.
 */
export function parseJobMessage(body: unknown): JobMessage | null {
  if (typeof body !== "object" || body === null) return null;

  const candidate = body as Record<string, unknown>;
  const { jobId, productId, kind } = candidate;
  if (typeof jobId !== "string" || typeof productId !== "string") return null;
  if (typeof kind !== "string" || !JOB_KINDS.includes(kind)) return null;

  return { jobId, productId, kind: kind as JobKind };
}

/**
 * Hasil satu pekerjaan.
 *
 * `retry` adalah satu-satunya nilai yang membuat pengakuan ditunda. Pesan
 * yang diminta diulang kembali ke konsumen setelah `retry_delay`, dan itu
 * yang memberi lapis kedua rantai kesempatan saat gangguannya sebatas
 * jaringan.
 */
export type JobOutcome =
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly code: ErrorCode }
  | { readonly status: "retry" }
  | { readonly status: "skipped" };

export interface ConsumerDependencies {
  readonly env: ConsumerEnv;
  readonly nowMs: number;
  /**
   * Alamat publik Worker ini.
   *
   * Dibutuhkan penyedia ASR, yang mengambil berkas audionya sendiri lewat
   * `fetch`. Tanpa alamat yang dapat dijangkau, penyedia menerima URL yang
   * tidak menunjuk apa pun dan gagal pada lapis pertama — jadi nilainya
   * dibawa eksplisit, bukan ditebak dari `request.url` yang tidak tersedia
   * di dalam consumer antrian.
   *
   * Boleh tidak ada: `undefined` membuat URL dibentuk dari alamat sentinel,
   * dan penyedia gagal dengan pesan yang terbaca di log. Itu lebih baik
   * daripada menolak mengerjakan pekerjaan sama sekali.
   */
  readonly audioBaseUrl?: string | undefined;
  /** Hanya untuk log operator. Tidak pernah sampai ke pengrajin. */
  readonly log: (message: string) => void;
}

/** Batas berkas audio yang masih layak dikirim ke penyedia. */
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

/**
 * Mengerjakan satu pekerjaan.
 *
 * Urutannya selalu sama dan tidak dapat ditukar:
 *
 *   muat konteks → tandai `running` → jalankan rantai → tulis hasil
 *
 * Menandai `running` sebelum rantai berjalan adalah yang membuat layar
 * proses memperlihatkan pekerjaan yang benar-benar sedang berjalan. Bila
 * penandaan itu gagal — pekerjaan sudah dipegang konsumen lain — pekerjaan
 * ini berhenti di situ tanpa menyentuh apa pun.
 */
export async function processJob(
  message: JobMessage,
  dependencies: ConsumerDependencies,
): Promise<JobOutcome> {
  const { env, nowMs, log } = dependencies;

  const context = await d1LoadJobContext(env.DB, message.jobId);
  if (context === null) {
    log(`Pekerjaan ${message.jobId} tidak ada di basis data. Pesan dilewati.`);
    return { status: "skipped" };
  }

  // Pekerjaan yang sudah selesai dapat muncul kembali bila pesan antriannya
  // dikirim dua kali. Menegakkannya di sini menghemat seluruh pemanggilan
  // penyedia.
  if (context.status !== "queued") {
    log(`Pekerjaan ${message.jobId} berstatus ${context.status}. Tidak dikerjakan lagi.`);
    return { status: "skipped" };
  }

  const started = await d1StartJob(
    env.DB,
    context.id,
    { provider: providerHint(context.kind), attempt: context.attempt + 1 },
    nowMs,
  );
  if (!started) {
    log(`Pekerjaan ${message.jobId} sudah dipegang pihak lain. Dilewati.`);
    return { status: "skipped" };
  }

  switch (context.kind) {
    case "image":
      return processImageJob(context, dependencies);
    case "copy":
      return processCopyJob(context, dependencies);
    case "asr":
      return processAsrJob(context, dependencies);
    default:
      // `tts` dan `export` belum punya penyedia. ADR-005 O4 masih terbuka
      // untuk suara avatar, dan mengarang suara yang tidak pernah diputuskan
      // lebih buruk daripada mengakuinya di log.
      log(`Pekerjaan ${message.jobId} berjenis ${context.kind}: belum ada penyedia.`);
      await d1FailJob(env.DB, context.id, "INTERNAL_ERROR", nowMs);
      return { status: "failed", code: "INTERNAL_ERROR" };
  }
}

/** Nama lapis pertama rantai, untuk kolom `provider` sebelum hasilnya ada. */
function providerHint(kind: JobKind): string {
  switch (kind) {
    case "image":
      return "workers_ai";
    case "asr":
      return "groq";
    default:
      return "9router";
  }
}

// --- Gambar ---

/**
 * Pekerjaan gambar.
 *
 * Dua lapis penyedia dan satu lapis cache:
 *
 *   workers_ai  menghasilkan bita dari prompt
 *   cache       menunjuk aset pra-produksi yang sudah ada
 *
 * Hasil lapis mana pun diperlakukan sama: bita diunggah sebagai aset BARU
 * dengan `kind = 'photo_studio'`. Tidak ada satu baris pun di sini yang
 * menulis ke `photo_original` — AGENTS.md aturan 7, dan itu yang membuat
 * kegagalan generate tidak pernah menghilangkan foto pengrajin.
 *
 * Kunci R2 dibentuk di sini, bukan di lapis `cache`: lapis itu tidak
 * menghasilkan objek apa pun, ia hanya menunjuk objek yang sudah ada.
 */
async function processImageJob(
  context: JobContext,
  dependencies: ConsumerDependencies,
): Promise<JobOutcome> {
  const { env, nowMs, log } = dependencies;

  const prompt =
    context.prompt.length > 0
      ? context.prompt
      : buildImagePrompt(context.productName, readStyle(context.payload), context.locale ?? "id");

  const providers = [createWorkersAiImageProvider({ ai: env.AI, media: env.MEDIA })];
  const steps = imageChainSteps(providers, {
    productId: context.productId,
    sourceImageUrl: context.sourceKey ?? "",
    stylePrompt: prompt,
  });

  await d1SetProgress(env.DB, context.id, 30);

  const outcome = await runProviderChain(steps, "IMAGE_GENERATE_FAILED");

  if (!outcome.ok) {
    log(`Pekerjaan gambar ${context.id} gagal: ${outcome.failure.code}.`);
    return failOrRetry(context, outcome.failure.code, dependencies);
  }

  // Lapis generatif mengembalikan bita; lapis cache hanya menunjuk objek
  // yang sudah ada. Keduanya berakhir di `media_assets` sebagai aset baru.
  const result = outcome.value;

  if (result.bytes !== null && result.bytes.byteLength > 0) {
    const uploaded = await persistGeneratedImage(context, result, dependencies);
    if (uploaded !== null) {
      await recordImageResult(context, uploaded, result.mimeType, result.bytes.byteLength, result.provider, dependencies);
      log(`Pekerjaan ${context.id} selesai lewat ${result.provider}.`);
      return { status: "succeeded" };
    }

    log(`Hasil pekerjaan ${context.id} tidak dapat disimpan. Mencoba aset pra-produksi.`);
  }

  // Hasil kosong, atau penyimpanan gagal. Lapis cache masih tersedia: aset
  // pra-produksi dipakai apa adanya supaya demo tidak berhenti pada katalog
  // tanpa foto sama sekali.
  const cached = await useCachedImage(context, dependencies);
  if (cached) return { status: "succeeded" };

  // Fallback jaring pengaman: jika model studio gagal, pertahankan foto asli pengrajin (AGENTS.md aturan 7)
  if (context.sourceKey !== null) {
    const head = await env.MEDIA.head(context.sourceKey);
    if (head !== null) {
      await recordImageResult(
        context,
        { mediaId: ulid(), r2Key: context.sourceKey },
        head.httpMetadata?.contentType ?? "image/jpeg",
        head.size,
        "original",
        dependencies,
      );
      log(`Pekerjaan gambar ${context.id} mempertahankan foto asli ${context.sourceKey}.`);
      return { status: "succeeded" };
    }
  }

  await d1FailJob(env.DB, context.id, "IMAGE_GENERATE_FAILED", nowMs);
  return { status: "failed", code: "IMAGE_GENERATE_FAILED" };
}

/** Satu tempat yang menulis hasil gambar ke basis data, dipakai dua jalur. */
async function recordImageResult(
  context: JobContext,
  stored: { readonly mediaId: string; readonly r2Key: string },
  mimeType: string,
  bytes: number,
  provider: string,
  dependencies: ConsumerDependencies,
): Promise<void> {
  await d1FinishImageJob(
    dependencies.env.DB,
    {
      jobId: context.id,
      productId: context.productId,
      mediaId: stored.mediaId,
      r2Key: stored.r2Key,
      mimeType,
      bytes,
      provider,
      productStatus: context.status,
    },
    dependencies.nowMs,
  );
}

function readStyle(payload: string | null): string {
  if (payload === null) return "studio";

  try {
    const decoded: unknown = JSON.parse(payload);
    if (typeof decoded !== "object" || decoded === null) return "studio";
    const style = (decoded as { style?: unknown }).style;
    return typeof style === "string" ? style : "studio";
  } catch {
    return "studio";
  }
}

/**
 * Menyimpan hasil generate sebagai objek baru.
 *
 * Kuncinya memuat id pekerjaan, bukan id produk saja: dua percobaan ulang
 * pada produk yang sama tidak boleh saling menimpa, dan riwayat hasil adalah
 * hal yang membuat operator dapat menjelaskan apa yang terjadi saat demo.
 */
async function persistGeneratedImage(
  context: JobContext,
  result: ImageResult,
  dependencies: ConsumerDependencies,
): Promise<{ readonly mediaId: string; readonly r2Key: string } | null> {
  const extension =
    result.mimeType === "image/jpeg" ? "jpg" : result.mimeType === "image/webp" ? "webp" : "png";
  const key = `products/${context.productId}/studio-${context.id}.${extension}`;

  try {
    await dependencies.env.MEDIA.put(key, result.bytes as Uint8Array, {
      httpMetadata: { contentType: result.mimeType },
    });
    return { mediaId: ulid(), r2Key: key };
  } catch (error) {
    dependencies.log(
      `Hasil pekerjaan ${context.id} tidak dapat disimpan: ${
        error instanceof Error ? error.message : "gangguan"
      }.`,
    );
    return null;
  }
}

/**
 * Lapis cache rantai gambar.
 *
 * Ia tidak menghasilkan gambar; ia memastikan demo tetap berjalan saat kuota
 * habis dan internet ruang lomba putus. Yang disajikannya adalah foto studio
 * yang memang sudah ada untuk produk tersebut — dan itu jujur: katalog
 * dengan foto lama lebih baik daripada katalog tanpa foto.
 */
async function useCachedImage(
  context: JobContext,
  dependencies: ConsumerDependencies,
): Promise<boolean> {
  const { env, nowMs, log } = dependencies;
  if (context.cachedKey === null) return false;

  const head = await env.MEDIA.head(context.cachedKey);
  if (head === null) return false;

  await d1FinishImageJob(
    env.DB,
    {
      jobId: context.id,
      productId: context.productId,
      mediaId: ulid(),
      r2Key: context.cachedKey,
      mimeType: head.httpMetadata?.contentType ?? "image/png",
      bytes: head.size,
      provider: "cache",
      productStatus: context.status,
    },
    nowMs,
  );

  log(`Pekerjaan ${context.id} memakai aset pra-produksi ${context.cachedKey}.`);
  return true;
}

/**
 * Menutup pekerjaan yang gagal, atau memintanya diulang.
 *
 * Kegagalan sementara dikembalikan ke antrian; yang permanen ditandai gagal
 * sekarang juga supaya pengrajin melihat pesannya tanpa menunggu tiga
 * percobaan. Foto asli tidak pernah disentuh di jalur mana pun.
 */
async function failOrRetry(
  context: JobContext,
  code: ErrorCode,
  dependencies: ConsumerDependencies,
): Promise<JobOutcome> {
  if (code === "RATE_LIMITED" || code === "QUOTA_EXCEEDED") {
    await d1RequeueJob(dependencies.env.DB, context.id);
    return { status: "retry" };
  }

  await d1FailJob(dependencies.env.DB, context.id, code, dependencies.nowMs);
  return { status: "failed", code };
}

// --- Teks ---

/**
 * Pekerjaan penyusunan konten.
 *
 * Satu pekerjaan per bahasa. Kegagalan bahasa Inggris tidak boleh
 * menggagalkan bahasa Indonesia — itu kriteria F1-07, dan pemisahannya sudah
 * ada di tingkat data karena setiap bahasa punya barisnya sendiri.
 */
async function processCopyJob(
  context: JobContext,
  dependencies: ConsumerDependencies,
): Promise<JobOutcome> {
  const { env, nowMs, log } = dependencies;

  if (context.transcript.trim().length === 0) {
    // Tanpa cerita pengrajin, tidak ada yang dapat disusun. Mengirim prompt
    // kosong ke model hanya menghasilkan karangan.
    await d1FailJob(env.DB, context.id, "TRANSCRIPT_NOT_REVIEWED", nowMs);
    log(`Pekerjaan teks ${context.id} tidak punya transkrip.`);
    return { status: "failed", code: "TRANSCRIPT_NOT_REVIEWED" };
  }

  const locale = (context.locale ?? "id") as Locale;

  const providers = [
    ...(env.GROQ_API_KEY !== undefined
      ? [createGroqTextProvider({ apiKey: env.GROQ_API_KEY })]
      : []),
    ...(env.NINEROUTER_API_KEY !== undefined && env.NINEROUTER_BASE_URL !== undefined
      ? [
          createNineRouterTextProvider({
            apiKey: env.NINEROUTER_API_KEY,
            baseUrl: env.NINEROUTER_BASE_URL,
          }),
        ]
      : []),
    createWorkersAiTextProvider({ ai: env.AI }),
  ];

  const steps = textChainSteps(providers, {
    transcript: context.transcript,
    locale,
    task: "copy",
  });

  await d1SetProgress(env.DB, context.id, 40);

  const outcome = await runProviderChain(steps, "COPY_GENERATE_FAILED");

  if (!outcome.ok) {
    log(`Pekerjaan teks ${context.id} gagal: ${outcome.failure.code}.`);
    return failOrRetry(context, outcome.failure.code, dependencies);
  }

  await d1FinishCopyJob(
    env.DB,
    {
      jobId: context.id,
      productId: context.productId,
      locale,
      contentId: ulid(),
      name: outcome.value.name,
      story: outcome.value.story,
      specs: outcome.value.specs,
      socialCopy: outcome.value.socialCopy ?? null,
      seoKeywords: outcome.value.seoKeywords,
      provider: outcome.value.provider,
      productStatus: context.status,
    },
    nowMs,
  );

  log(`Pekerjaan teks ${context.id} (${locale}) selesai lewat ${outcome.value.provider}.`);
  return { status: "succeeded" };
}

// --- ASR ---

/**
 * Pekerjaan transkripsi.
 *
 * Transkrip yang tersimpan tetap `reviewed = 0`. ADR-008 menuntut pengrajin
 * membacanya lebih dulu, dan transkrip yang menandai dirinya sudah diperiksa
 * akan melewati langkah ketiga tanpa siapa pun melihatnya.
 */
async function processAsrJob(
  context: JobContext,
  dependencies: ConsumerDependencies,
): Promise<JobOutcome> {
  const { env, nowMs, log } = dependencies;

  if (context.audioKey === null) {
    await d1FailJob(env.DB, context.id, "ASR_NO_SPEECH", nowMs);
    log(`Pekerjaan ASR ${context.id} tidak punya berkas audio.`);
    return { status: "failed", code: "ASR_NO_SPEECH" };
  }

  const object = await env.MEDIA.get(context.audioKey);
  if (object === null) {
    await d1FailJob(env.DB, context.id, "ASR_NO_SPEECH", nowMs);
    log(`Objek audio ${context.audioKey} tidak ada di penyimpanan.`);
    return { status: "failed", code: "ASR_NO_SPEECH" };
  }

  if (object.size > MAX_AUDIO_BYTES) {
    await d1FailJob(env.DB, context.id, "FILE_TOO_LARGE", nowMs);
    return { status: "failed", code: "FILE_TOO_LARGE" };
  }

  const locale = (context.locale ?? "id") as Locale;

  const audioBytes = new Uint8Array(await object.arrayBuffer());

  // Penyedia menerima audioBytes langsung dari R2 tanpa perlu fetch balik ke Worker lewat HTTP.
  const audioUrl = `${dependencies.audioBaseUrl ?? "https://katavis.invalid"}/api/v1/media/${context.audioKey}`;

  const providers = [
    ...(env.GROQ_API_KEY !== undefined
      ? [createGroqTranscriptionProvider({ apiKey: env.GROQ_API_KEY })]
      : []),
    createWorkersAiTranscriptionProvider({ ai: env.AI }),
  ];

  const steps = transcriptionChainSteps(providers, { audioUrl, audioBytes, locale });

  await d1SetProgress(env.DB, context.id, 40);

  const outcome = await runProviderChain(steps, "ASR_NO_SPEECH");

  if (!outcome.ok) {
    log(`Pekerjaan ASR ${context.id} gagal: ${outcome.failure.code}.`);
    return failOrRetry(context, outcome.failure.code, dependencies);
  }

  await d1FinishAsrJob(
    env.DB,
    {
      jobId: context.id,
      productId: context.productId,
      transcriptId: ulid(),
      text: outcome.value.text,
      locale,
      provider: outcome.value.provider,
      durationMs: outcome.value.durationMs,
    },
    nowMs,
  );

  log(`Pekerjaan ASR ${context.id} selesai lewat ${outcome.value.provider}.`);
  return { status: "succeeded" };
}
