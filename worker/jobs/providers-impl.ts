/**
 * Implementasi penyedia AI konkret.
 *
 * `providers.ts` mendefinisikan bentuknya; berkas ini mengisinya. Tiga
 * rantai, tujuh implementasi, dan satu aturan yang mengikat semuanya:
 * **tidak ada satu penyedia pun yang, bila mati, menghentikan demo**
 * (ADR-004, AGENTS.md aturan 5).
 *
 * Yang tidak ada di sini, dan itu disengaja: `GeminiWebProvider`. Jalur itu
 * tidak dipanggil dari Worker melainkan dari Studio Agent di laptop, lewat
 * antrian dan `POST /agent/jobs/claim`. Worker tidak pernah membuka Chrome —
 * ia hanya menyediakan pekerjaan bagi agen yang hidup. Karena itu lapis
 * `gemini_web` memang tidak terdaftar sebagai penyedia di sini
 * (`buildChain` melewati penyedia yang tidak terdaftar, bukan menggagalkan
 * rantai), dan `IMAGE_CHAIN` di sini dimulai dari `workers_ai`.
 *
 * Setiap penyedia mematuhi `signal`. Batas waktu ditegakkan rantai, tetapi
 * penyedia yang mengabaikan pembatalan akan tetap memakai jatah kuota
 * setelah lapis berikutnya menang — dan pada paket gratis, jatah itulah
 * yang habis lebih dulu.
 */

import {
  ProviderError,
  type Content,
  type ImageRequest,
  type ImageResult,
  type ProviderId,
  type Transcript,
  type TranscriptionRequest,
} from "./providers";

// --- Batas waktu ---

/**
 * Batas waktu lapis cadangan.
 *
 * Angkanya ditetapkan di sini, bukan di `providers.ts`, karena berkas itu
 * menyatakan bahwa lapis selain Gemini "belum diukur, jadi angkanya
 * ditetapkan masing-masing implementasi, bukan dikarang di sana". Angka di
 * bawah adalah batas atas terhadap panggilan jaringan yang cepat — cukup
 * longgar untuk model yang sedang ramai, cukup ketat agar pengrajin tidak
 * menunggu lebih lama daripada membuat katalog baru.
 */
const IMAGE_TIMEOUT_MS = 30_000;
const CACHE_TIMEOUT_MS = 5_000;
const ASR_TIMEOUT_MS = 20_000;
/**
 * Batas per lapis teks. `ag/gemini-3.8-flash-high` lewat SSE terukur 11-12
 * detik; 20 detik terlalu mepet saat proksi sedang lambat dan memutus
 * balasan yang sebenarnya sah.
 */
const TEXT_TIMEOUT_MS = 30_000;

/**
 * Model Workers AI.
 *
 * Dipilih dari katalog yang memang ada, bukan dikarang: nama model yang
 * salah gagal dengan pesan "model tidak ditemukan", dan itu terlihat sama
 * seperti gangguan penyedia bagus dari luar.
 */
const WORKERS_AI_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const WORKERS_AI_ASR_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const WORKERS_AI_TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// --- Pembantu bersama ---

/**
 * Membungkus kegagalan apa pun menjadi `ProviderError`.
 *
 * Penyebab mentahnya masuk ke `diagnostic` dan berhenti di sana. Yang keluar
 * ke rantai hanyalah status HTTP, dan yang sampai ke pengrajin hanyalah
 * kode katalog.
 */
async function guard<TValue>(
  provider: ProviderId,
  signal: AbortSignal,
  run: () => Promise<TValue>,
): Promise<TValue> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (signal.aborted) throw new ProviderError(499, `${provider}: permintaan dibatalkan.`);

    const detail = error instanceof Error ? error.message : String(error);
    throw new ProviderError(502, `${provider}: ${detail}`);
  }
}

/** Satuan bita dari apa pun yang dikembalikan Workers AI. */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

/**
 * Mengambil satu bidang teks dari balasan Workers AI.
 *
 * Binding `AI` mengembalikan union yang memuat bentuk batch asinkron, dan
 * bentuk itu tidak punya bidang yang dicari. Karena itu pembacaan ini
 * melewati `unknown` lebih dulu: yang menentukan apakah hasilnya ada adalah
 * pemeriksaan `typeof` di bawah, bukan tipe yang dijanjikan binding —
 * janji itu tidak selalu berlaku untuk model yang dipanggil dengan
 * `as never`.
 */
function readTextField(response: unknown, field: string): string | null {
  if (typeof response !== "object" || response === null) return null;

  const value = (response as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/**
 * Membaca biner dari Workers AI yang dapat berbentuk beberapa cara.
 *
 * Model gambar mengembalikan `Uint8Array` pada satu versi runtime dan
 * `ArrayBuffer` pada versi lain. Menerima keduanya lebih murah daripada
 * menebak yang mana yang berlaku pada akun juri.
 */
async function readAiBinary(response: unknown): Promise<Uint8Array | null> {
  if (response === null || typeof response !== "object") return null;

  const candidate = response as Record<string, unknown>;

  const direct = toBytes(candidate.image ?? candidate.audio);
  if (direct !== null) return direct;

  const body = candidate.response;
  if (body instanceof Response) {
    return new Uint8Array(await body.arrayBuffer());
  }

  return null;
}

// --- Gambar: Workers AI ---

export interface WorkersAiImageOptions {
  readonly ai: Ai;
  /** Tidak dipakai lapis ini; ada supaya bentuknya seragam dengan lapis cache. */
  readonly media?: R2Bucket;
}

/**
 * Lapis 2 rantai gambar.
 *
 * Menerima `sourceImageUrl`, tetapi tidak selalu dapat memakainya: Workers
 * AI bekerja dari prompt teks, sedangkan jalur img2img menuntut model lain
 * yang belum tentu tersedia di akun mana pun. Karena itu foto asli tetap
 * dipertahankan sebagai aset terpisah — hasil lapis ini adalah foto studio
 * tambahan, bukan pengganti (AGENTS.md aturan 7).
 */
export function createWorkersAiImageProvider(options: WorkersAiImageOptions) {
  return {
    id: "workers_ai" as const,
    timeoutMs: IMAGE_TIMEOUT_MS,

    async generate(request: ImageRequest): Promise<ImageResult> {
      const startedAt = Date.now();

      return guard("workers_ai", request.signal, async () => {
        const response = await options.ai.run(
          WORKERS_AI_IMAGE_MODEL as never,
          {
            prompt: request.stylePrompt,
            steps: 4,
          } as never,
          { signal: request.signal } as never,
        );

        const bytes = await readAiBinary(response);
        if (bytes === null || bytes.byteLength === 0) {
          throw new ProviderError(502, "workers_ai: model tidak mengembalikan gambar.");
        }

        return {
          // Kunci dibentuk konsumen setelah bita ini diunggah. Penyedia
          // generatif tidak menulis ke R2 sendiri: ia tidak punya bindingnya,
          // dan memberinya berarti membuka penyimpanan ke pihak ketiga.
          r2Key: "",
          bytes,
          mimeType: mimeFromBytes(bytes),
          provider: "workers_ai" as const,
          durationMs: Date.now() - startedAt,
        };
      });
    },
  };
}

/**
 * MIME dari magic bytes.
 *
 * Daftar yang sama dengan `IMAGE_MAGIC_BYTES` di lib/schemas.ts. Model
 * sesekali mengembalikan JPEG meski diminta PNG, dan menyimpannya dengan
 * MIME yang salah membuat peramban menolak menampilkannya.
 */
function mimeFromBytes(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return "image/png";
}

// --- Gambar: cache ---

export interface CacheImageOptions {
  readonly media: R2Bucket;
  /** Kunci R2 yang sudah ada untuk produk ini, atau null. */
  readonly cachedKey: string | null;
}

/**
 * Lapis 3 rantai gambar — aset pra-produksi.
 *
 * Lapis ini tidak menghasilkan gambar; ia memastikan demo tetap berjalan
 * saat kuota habis dan internet ruang lomba putus. Yang disajikannya adalah
 * foto studio yang **memang sudah ada** untuk produk tersebut, dan itu
 * disebut apa adanya di layar: katalog yang menampilkan foto lama lebih
 * jujur daripada katalog tanpa foto.
 */
export function createCacheImageProvider(options: CacheImageOptions) {
  return {
    id: "cache" as const,
    timeoutMs: CACHE_TIMEOUT_MS,

    async generate(request: ImageRequest): Promise<ImageResult> {
      const startedAt = Date.now();

      return guard("cache", request.signal, async () => {
        const key = options.cachedKey;
        if (key === null) {
          throw new ProviderError(404, "cache: tidak ada aset pra-produksi untuk produk ini.");
        }

        const head = await options.media.head(key);
        if (head === null) {
          throw new ProviderError(404, `cache: objek ${key} tidak ada di penyimpanan.`);
        }

        return {
          r2Key: key,
          // Lapis ini tidak punya bita: yang dipakai adalah objek yang sudah
          // ada, dan mengunduhnya hanya untuk mengunggahnya kembali berarti
          // memindahkan bita yang sama dua kali tanpa mengubah apa pun.
          bytes: null,
          mimeType: head.httpMetadata?.contentType ?? "image/png",
          provider: "cache" as const,
          durationMs: Date.now() - startedAt,
        };
      });
    },
  };
}

// --- ASR: Groq ---

export interface GroqOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const GROQ_MODEL = "whisper-large-v3-turbo";

/**
 * Lapis 1 rantai ASR.
 *
 * Whisper berjalan di sisi Groq, bukan di laptop: AGENTS.md melarang Whisper
 * lokal di atas ukuran `small`, dan mesin pengembangan tidak punya CUDA.
 * Akun gratisnya memberi 28.800 detik audio per hari — jauh lebih banyak
 * daripada kebutuhan demo.
 */
export function createGroqTranscriptionProvider(options: GroqOptions) {
  const baseUrl = options.baseUrl ?? GROQ_DEFAULT_BASE_URL;

  return {
    id: "groq" as const,
    timeoutMs: ASR_TIMEOUT_MS,

    async transcribe(request: TranscriptionRequest): Promise<Transcript> {
      const startedAt = Date.now();

      return guard("groq", request.signal, async () => {
        let audio: Blob;
        if (request.audioBytes && request.audioBytes.byteLength > 0) {
          audio = new Blob([request.audioBytes as BlobPart], { type: "audio/webm" });
        } else {
          const source = await fetch(request.audioUrl, { signal: request.signal });
          if (!source.ok) {
            throw new ProviderError(502, `groq: audio tidak dapat diambil (${source.status}).`);
          }
          audio = await source.blob();
        }

        const form = new FormData();
        // Nama berkas wajib ada; tanpa itu Groq menolaknya sebagai muatan
        // yang tidak lengkap dan pesannya tidak menyebut penyebabnya.
        form.append("file", audio, "rekaman.webm");
        form.append("model", GROQ_MODEL);
        form.append("language", request.locale);
        form.append("response_format", "json");

        const response = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}` },
          body: form,
          signal: request.signal,
        });

        if (!response.ok) {
          // Status diteruskan apa adanya: rantai memetakan 429 dan 503 ke
          // kode katalog yang sudah ada, dan mengarang status di sini akan
          // membuat "kuota habis" terlihat seperti "rekaman tidak jelas".
          throw new ProviderError(response.status, `groq: transkripsi ditolak (${response.status}).`);
        }

        const body: unknown = await response.json();
        const text =
          typeof body === "object" && body !== null && typeof (body as { text?: unknown }).text === "string"
            ? (body as { text: string }).text
            : "";

        if (text.trim().length === 0) {
          // Rekaman tanpa suara yang terdengar bukan kegagalan penyedia, dan
          // pesannya sudah disiapkan untuk pengrajin.
          throw new ProviderError(422, "groq: tidak ada suara yang terdengar pada rekaman.");
        }

        return {
          text: text.trim(),
          provider: "groq" as const,
          durationMs: Date.now() - startedAt,
        };
      });
    },
  };
}

// --- ASR: Workers AI ---

export interface WorkersAiAsrOptions {
  readonly ai: Ai;
}

/** Lapis 2 rantai ASR. Berjalan di jaringan Cloudflare, jadi tidak butuh kunci. */
export function createWorkersAiTranscriptionProvider(options: WorkersAiAsrOptions) {
  return {
    id: "workers_ai" as const,
    timeoutMs: ASR_TIMEOUT_MS,

    async transcribe(request: TranscriptionRequest): Promise<Transcript> {
      const startedAt = Date.now();

      return guard("workers_ai", request.signal, async () => {
        let bytes: Uint8Array;
        if (request.audioBytes && request.audioBytes.byteLength > 0) {
          bytes = request.audioBytes;
        } else {
          const source = await fetch(request.audioUrl, { signal: request.signal });
          if (!source.ok) {
            throw new ProviderError(502, `workers_ai: audio tidak dapat diambil (${source.status}).`);
          }
          bytes = new Uint8Array(await source.arrayBuffer());
        }

        const response = await options.ai.run(
          WORKERS_AI_ASR_MODEL as never,
          { audio: Array.from(bytes) } as never,
          { signal: request.signal } as never,
        );

        const text = readTextField(response, "text");

        if (text === null || text.trim().length === 0) {
          throw new ProviderError(422, "workers_ai: tidak ada suara yang terdengar pada rekaman.");
        }

        return {
          text: text.trim(),
          provider: "workers_ai" as const,
          durationMs: Date.now() - startedAt,
        };
      });
    },
  };
}

// --- Teks: 9router ---

export interface NineRouterOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  /**
   * Model teks di proksi 9router. Bawaan `ag/gemini-3.8-flash-high` —
   * terverifikasi September 2026 menjawab lewat proksi lokal dalam bentuk
   * SSE dan menghasilkan copywriting yang lebih kreatif. Diganti lewat
   * `NINEROUTER_TEXT_MODEL` tanpa mengubah kode.
   */
  readonly model?: string | undefined;
}

export const DEFAULT_NINEROUTER_TEXT_MODEL = "ag/gemini-3.8-flash-high";

/** Bentuk yang diminta dari model teks. Divalidasi ulang oleh pemanggil. */
interface GeneratedCopy {
  readonly name: string;
  readonly story: string;
  readonly specs: readonly string[];
  readonly socialCopy: string | null;
  readonly seoKeywords: readonly string[];
}

/**
 * Menerjemahkan balasan model menjadi bentuk yang tetap.
 *
 * Model menulis JSON di dalam blok kode berpagar sekitar separuh waktu.
 * Menolak balasan karena pagarnya berarti membuang hasil yang sebenarnya
 * benar, jadi pagarnya dilepas lebih dulu. Bidang yang hilang tetap
 * menghasilkan string kosong — pemanggil yang memutuskan apakah itu cukup,
 * bukan fungsi ini.
 */
export function parseCopyResponse(raw: string): GeneratedCopy | null {
  const fenced = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();

  let decoded: unknown;
  try {
    decoded = JSON.parse(fenced);
  } catch {
    return null;
  }

  if (typeof decoded !== "object" || decoded === null) return null;

  const candidate = decoded as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const story = typeof candidate.story === "string" ? candidate.story.trim() : "";
  if (name.length === 0 || story.length === 0) return null;

  return {
    name,
    story,
    specs: readStringArray(candidate.specs, 12),
    socialCopy: typeof candidate.socialCopy === "string" ? candidate.socialCopy.trim() : null,
    seoKeywords: readStringArray(candidate.seoKeywords, 20),
  };
}

function readStringArray(value: unknown, max: number): readonly string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, max);
}

/**
 * Prompt penyusunan katalog.
 *
 * Ditulis sekali di sini dan tidak disalin ke model lokal mana pun. Kalimat
 * "jangan mengarang" bukan sopan-santun: katalog yang memuat klaim yang
 * tidak pernah disebut pengrajin adalah cacat yang paling sulit terlihat
 * saat demo, karena hasilnya justru tampak paling bagus.
 */
export function buildCopyPrompt(transcript: string, locale: string): string {
  const language = locale === "id" ? "Bahasa Indonesia" : `bahasa dengan kode BCP-47 "${locale}"`;

  return [
    `Anda menyusun katalog produk untuk pengrajin difabel di Indonesia, dalam ${language}.`,
    "Cerita pengrajin berikut ini adalah SATU-SATUNYA sumber informasi Anda:",
    "<<<",
    transcript,
    ">>>",
    "JANGAN mengarang bahan, ukuran, harga, asal daerah, atau klaim apa pun yang tidak disebut di atas.",
    "Bila suatu hal tidak disebut, jangan tuliskan hal itu.",
    "Balas HANYA dengan JSON tanpa penjelasan lain, berbentuk:",
    '{"name":"...","story":"...","specs":["..."],"socialCopy":"...","seoKeywords":["..."]}',
    "name maksimal 120 karakter. story 2-4 kalimat yang hangat dan apa adanya.",
    "specs diisi hanya dari yang disebut pengrajin. socialCopy satu kalimat untuk media sosial.",
  ].join("\n");
}

export interface GroqTextOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
}

/**
 * Lapis teks tercepat lewat Groq.
 * Menghasilkan naskah katalog dalam format JSON dalam ~1,3 detik.
 */
export function createGroqTextProvider(options: GroqTextOptions) {
  const baseUrl = options.baseUrl ?? GROQ_DEFAULT_BASE_URL;
  const model = options.model ?? "openai/gpt-oss-120b";

  return {
    id: "groq" as const,
    timeoutMs: TEXT_TIMEOUT_MS,

    async generate(request: {
      readonly transcript: string;
      readonly locale: string;
      readonly signal: AbortSignal;
    }): Promise<Content> {
      const startedAt = Date.now();

      return guard("groq", request.signal, async () => {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
            "User-Agent": "KATAVIS/1.0",
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "You are a professional Indonesian craft catalog writer. Always respond with pure valid JSON only.",
              },
              { role: "user", content: buildCopyPrompt(request.transcript, request.locale) },
            ],
            response_format: { type: "json_object" },
            temperature: 0.3,
          }),
          signal: request.signal,
        });

        if (!response.ok) {
          throw new ProviderError(response.status, `groq: permintaan teks ditolak (${response.status}).`);
        }

        const raw = await response.text();
        const cleaned = raw.replace(/data:\s*\[DONE\][\s\r\n]*$/, "").trim();
        const body: unknown = JSON.parse(cleaned);
        const content = readChoiceContent(body);
        const parsed = content === null ? null : parseCopyResponse(content);

        if (parsed === null) {
          throw new ProviderError(502, "groq: balasan teks bukan JSON yang dapat dibaca.");
        }

        return { ...parsed, provider: "groq" as const, durationMs: Date.now() - startedAt };
      });
    },
  };
}

/**
 * Lapis 1 rantai teks.
 *
 * `9router` adalah proksi yang menyatukan beberapa model. Bentuk permintaannya
 * mengikuti OpenAI, yang berarti menukar penyedianya kelak tidak menuntut
 * perubahan di sisi konsumen.
 */
export function createNineRouterTextProvider(options: NineRouterOptions) {
  return {
    id: "9router" as const,
    timeoutMs: TEXT_TIMEOUT_MS,

    async generate(request: {
      readonly transcript: string;
      readonly locale: string;
      readonly signal: AbortSignal;
    }): Promise<Content> {
      const startedAt = Date.now();

      return guard("9router", request.signal, async () => {
        const response = await fetch(`${options.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model ?? DEFAULT_NINEROUTER_TEXT_MODEL,
            messages: [{ role: "user", content: buildCopyPrompt(request.transcript, request.locale) }],
            temperature: 0.4,
          }),
          signal: request.signal,
        });

        if (!response.ok) {
          throw new ProviderError(response.status, `9router: permintaan ditolak (${response.status}).`);
        }

        const raw = await response.text();
        const content = extractChatText(raw);
        const parsed = content === null ? null : parseCopyResponse(content);

        if (parsed === null) {
          throw new ProviderError(502, "9router: balasan bukan JSON yang dapat dibaca.");
        }

        return { ...parsed, provider: "9router" as const, durationMs: Date.now() - startedAt };
      });
    },
  };
}

function readChoiceContent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;

  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first = choices[0] as { message?: unknown; delta?: unknown };
  for (const part of [first.message, first.delta]) {
    if (typeof part !== "object" || part === null) continue;
    const msg = part as { content?: unknown; reasoning_content?: unknown };
    if (typeof msg.content === "string" && msg.content.trim().length > 0) {
      return msg.content;
    }
    if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim().length > 0) {
      return msg.reasoning_content;
    }
  }
  return null;
}

/**
 * Mengambil teks balasan dari badan respons chat OpenAI-compatible.
 *
 * Dua bentuk didukung karena proksi 9router mengembalikan keduanya
 * tergantung model: JSON murni (`{choices:[...]}`) atau aliran SSE
 * (baris-baris `data: {...}` diakhiri `data: [DONE]`). Model
 * `ag/gemini-3.8-flash-high` menjawab dalam bentuk SSE — parser yang hanya
 * bisa JSON akan membuang balasan yang sebenarnya sah.
 */
export function extractChatText(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  try {
    return readChoiceContent(JSON.parse(trimmed));
  } catch {
    // Bukan JSON murni — coba sebagai SSE di bawah.
  }

  const parts: string[] = [];
  for (const line of trimmed.split("\n")) {
    const text = line.trim();
    if (!text.startsWith("data:")) continue;
    const payload = text.slice(5).trim();
    if (payload === "[DONE]" || payload.length === 0) continue;
    try {
      const content = readChoiceContent(JSON.parse(payload));
      if (content !== null) parts.push(content);
    } catch {
      // Baris rusak dilewati; baris lain tetap dipakai.
    }
  }

  const joined = parts.join("");
  return joined.trim().length > 0 ? joined : null;
}

// --- Teks: Workers AI ---

export interface WorkersAiTextOptions {
  readonly ai: Ai;
}

/**
 * Lapis 2 rantai teks.
 *
 * Model Llama lewat binding `AI`. Ia tidak selalu mematuhi `response_format`,
 * jadi `parseCopyResponse` yang menangani pagar kode berlaku penuh di sini —
 * dan itu alasan fungsi itu tidak disatukan ke dalam provider 9router.
 */
export function createWorkersAiTextProvider(options: WorkersAiTextOptions) {
  return {
    id: "workers_ai" as const,
    timeoutMs: TEXT_TIMEOUT_MS,

    async generate(request: {
      readonly transcript: string;
      readonly locale: string;
      readonly signal: AbortSignal;
    }): Promise<Content> {
      const startedAt = Date.now();

      return guard("workers_ai", request.signal, async () => {
        const response = await options.ai.run(
          WORKERS_AI_TEXT_MODEL as never,
          {
            messages: [
              { role: "user", content: buildCopyPrompt(request.transcript, request.locale) },
            ],
          } as never,
          { signal: request.signal } as never,
        );

        const content = readTextField(response, "response");

        const parsed = content === null ? null : parseCopyResponse(content);
        if (parsed === null) {
          throw new ProviderError(502, "workers_ai: balasan bukan JSON yang dapat dibaca.");
        }

        return { ...parsed, provider: "workers_ai" as const, durationMs: Date.now() - startedAt };
      });
    },
  };
}
