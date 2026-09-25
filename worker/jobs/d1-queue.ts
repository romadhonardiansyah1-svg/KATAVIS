/**
 * Akses D1 untuk consumer antrian.
 *
 * `d1-jobs.ts` melayani pembacaan demi layar; `d1-agent.ts` melayani klaim
 * Studio Agent. Berkas ini melayani pihak ketiga yang berbeda lagi:
 * consumer itu sendiri, yang perlu **tahu cukup banyak untuk mengerjakan
 * satu pekerjaan** lalu **menulis hasilnya kembali**.
 *
 * Tiga hal yang membentuk seluruh berkas ini:
 *
 *   1. **Satu kueri per pekerjaan, bukan satu per bidang.** Batas D1 paket
 *      gratis 50 kueri per invocation, dan satu batch dapat memuat lima
 *      pekerjaan. Seluruh yang dibutuhkan satu pekerjaan diambil dalam satu
 *      `JOIN`, dan seluruh tulisannya dikumpulkan lalu dijalankan sebagai
 *      satu `batch`.
 *   2. **Tidak ada pola N+1.** Ini yang paling mudah dilanggar saat
 *      menambahkan tahap baru, dan yang paling mahal saat demo.
 *   3. **Tulis hanya bila statusnya masih `running`.** Dua konsumen yang
 *      menerima pekerjaan sama tidak boleh sama-sama menganggap dirinya
 *      berhasil.
 */

import type { JobKind, JobStatus, Locale } from "../../lib/schemas";

/** Satu pekerjaan lengkap dengan seluruh konteks yang dibutuhkan pemrosesnya. */
export interface JobContext {
  readonly id: string;
  readonly productId: string;
  readonly artisanId: string;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly locale: Locale | null;
  readonly attempt: number;
  readonly payload: string | null;
  readonly prompt: string;
  /** Nama produk pada bahasa pekerjaan, atau bahasa Indonesia bila belum ada. */
  readonly productName: string;
  /** Kunci R2 foto asli terkonfirmasi, atau null bila pengrajin belum mengunggah. */
  readonly sourceKey: string | null;
  /** Kunci R2 audio mentah terkonfirmasi, untuk pekerjaan ASR. */
  readonly audioKey: string | null;
  /** Teks transkrip yang sudah ditinjau, untuk pekerjaan teks. */
  readonly transcript: string;
  /** Kunci R2 aset hasil terbaru dengan jenis yang diminta, untuk lapis cache. */
  readonly cachedKey: string | null;
}

interface JobContextRow {
  readonly id: string;
  readonly product_id: string;
  readonly artisan_id: string;
  readonly kind: string;
  readonly status: string;
  readonly locale: string | null;
  readonly attempt: number;
  readonly payload: string | null;
  readonly content_name: string | null;
  readonly fallback_name: string | null;
  readonly source_key: string | null;
  readonly audio_key: string | null;
  readonly transcript: string | null;
  readonly cached_key: string | null;
}

/**
 * Seluruh konteks satu pekerjaan dalam **satu** kueri.
 *
 * Subkueri yang diurutkan mengambil aset terbaru lebih dulu, sehingga
 * `LIMIT 1` di luarnya mengambil yang terbaru. `COALESCE` memilih nama
 * produk pada bahasa pekerjaan, lalu jatuh ke bahasa Indonesia, lalu ke
 * apa pun yang ada — nama kosong akan membuat prompt gambar tidak berarti.
 */
const JOB_CONTEXT_QUERY = `
  SELECT
    j.id, j.product_id, j.kind, j.status, j.locale, j.attempt, j.payload,
    p.artisan_id,
    (SELECT c.name FROM product_content c
      WHERE c.product_id = j.product_id AND c.locale = COALESCE(j.locale, 'id')
      LIMIT 1) AS content_name,
    (SELECT c.name FROM product_content c
      WHERE c.product_id = j.product_id AND c.locale = 'id'
      LIMIT 1) AS fallback_name,
    (SELECT m.r2_key FROM media_assets m
      WHERE m.product_id = j.product_id
        AND m.kind = 'photo_original' AND m.upload_status = 'confirmed'
      ORDER BY m.created_at LIMIT 1) AS source_key,
    (SELECT m.r2_key FROM media_assets m
      WHERE m.product_id = j.product_id
        AND m.kind = 'audio_raw' AND m.upload_status = 'confirmed'
      ORDER BY m.created_at DESC LIMIT 1) AS audio_key,
    (SELECT t.text FROM transcripts t
      WHERE t.product_id = j.product_id LIMIT 1) AS transcript,
    (SELECT m.r2_key FROM media_assets m
      WHERE m.product_id = j.product_id
        AND m.kind = CASE j.kind
          WHEN 'image' THEN 'photo_studio'
          WHEN 'tts' THEN 'audio_tts'
          ELSE 'photo_studio'
        END
        AND m.upload_status = 'confirmed'
      ORDER BY m.created_at DESC LIMIT 1) AS cached_key
  FROM jobs j
  JOIN products p ON p.id = j.product_id
  WHERE j.id = ?
`;

/**
 * Membaca konteks lengkap satu pekerjaan.
 *
 * `null` berarti barisnya tidak ada. Pekerjaan yang barisnya hilang tidak
 * dapat ditandai gagal — tidak ada yang dapat ditandai — jadi pemanggilnya
 * cukup melewatinya dan membiarkan pengakuan antrian berjalan.
 */
export async function d1LoadJobContext(
  db: D1Database,
  jobId: string,
): Promise<JobContext | null> {
  const row = await db.prepare(JOB_CONTEXT_QUERY).bind(jobId).first<JobContextRow>();
  if (row === null) return null;

  return {
    id: row.id,
    productId: row.product_id,
    artisanId: row.artisan_id,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    locale: row.locale as Locale | null,
    attempt: row.attempt,
    payload: row.payload,
    prompt: readPrompt(row.payload),
    productName: row.content_name ?? row.fallback_name ?? "produk kerajinan",
    sourceKey: row.source_key,
    audioKey: row.audio_key,
    transcript: row.transcript ?? "",
    cachedKey: row.cached_key,
  };
}

function readPrompt(payload: string | null): string {
  if (payload === null) return "";

  try {
    const decoded: unknown = JSON.parse(payload);
    if (typeof decoded !== "object" || decoded === null) return "";
    const prompt = (decoded as { prompt?: unknown }).prompt;
    return typeof prompt === "string" ? prompt : "";
  } catch {
    return "";
  }
}

/**
 * Menandai pekerjaan berjalan.
 *
 * Lapis penyedia dicatat di `provider` supaya layar proses dapat menjelaskan
 * mengapa satu pekerjaan selesai dalam 12 detik dan yang lain 28 — pertanyaan
 * yang pasti muncul saat demo.
 */
export async function d1StartJob(
  db: D1Database,
  jobId: string,
  input: { readonly provider: string; readonly attempt: number },
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs
       SET status = 'running', provider = ?, attempt = ?, progress = 10,
           started_at = ?, error_code = NULL
       WHERE id = ? AND status = 'queued'`,
    )
    .bind(input.provider, input.attempt, nowMs, jobId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/**
 * Menyimpan kemajuan antara.
 *
 * Dipanggil sebelum tulisan besar berikutnya. Layar proses menyegarkan
 * setiap dua detik, dan pekerjaan yang melompat dari 10 persen ke 100
 * membuat layar itu tampak membeku di antaranya.
 */
export async function d1SetProgress(
  db: D1Database,
  jobId: string,
  progress: number,
): Promise<void> {
  await db
    .prepare("UPDATE jobs SET progress = ? WHERE id = ? AND status = 'running'")
    .bind(progress, jobId)
    .run();
}

/**
 * Menulis hasil gambar dan menutup pekerjaannya.
 *
 * Satu batch, empat pernyataan — bukan empat perjalanan ke basis data.
 * Aset hasil ditulis sebagai baris **baru** dengan `kind = 'photo_studio'`.
 * Foto asli tetap ada dan bitanya tidak ditimpa; hanya penanda foto utamanya
 * yang dicabut saat hasil studio siap.
 *
 * Hasil studio menjadi primer karena ia yang ditampilkan katalog. Foto asli
 * tetap ada, tetap terkonfirmasi, dan tetap dapat dipilih kembali lewat
 * `PATCH /products/:id/media/:mediaId`.
 */
export async function d1FinishImageJob(
  db: D1Database,
  input: {
    readonly jobId: string;
    readonly productId: string;
    readonly mediaId: string;
    readonly r2Key: string;
    readonly mimeType: string;
    readonly bytes: number;
    readonly provider: string;
    readonly productStatus: string;
  },
  nowMs: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO media_assets
           (id, product_id, kind, r2_key, mime_type, bytes, provider,
            is_primary, upload_status, created_at)
         VALUES (?, ?, 'photo_studio', ?, ?, ?, ?, 1, 'confirmed', ?)`,
      )
      .bind(
        input.mediaId,
        input.productId,
        input.r2Key,
        input.mimeType,
        input.bytes,
        input.provider,
        nowMs,
      ),
    db
      .prepare(
        `UPDATE media_assets SET is_primary = 0
         WHERE product_id = ? AND id <> ?`,
      )
      .bind(input.productId, input.mediaId),
    db
      .prepare(
        `UPDATE jobs SET status = 'succeeded', progress = 100, provider = ?,
             completed_at = ?, error_code = NULL
         WHERE id = ? AND status = 'running'`,
      )
      .bind(input.provider, nowMs, input.jobId),
  ];

  // Produk hanya maju dari `draft` ke `processing`, sekali. Pekerjaan yang
  // selesai setelah produk sudah di `review` tidak memundurkannya.
  if (input.productStatus === "draft") {
    statements.push(
      db
        .prepare(
          "UPDATE products SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'draft'",
        )
        .bind(nowMs, input.productId),
    );
  }

  await db.batch(statements);
}

/**
 * Menandai pekerjaan gagal.
 *
 * `diagnostic` sengaja tidak ditulis ke `error_code`. Kolom itu memuat kode
 * katalog, dan hanya itu yang sampai ke antarmuka — "timeout setelah 45
 * detik" tidak pernah terbaca pengrajin (AGENTS.md aturan 2).
 *
 * Kegagalan juga tidak diulang di sini. Percobaan ulang adalah keputusan
 * pengrajin lewat `POST /products/:id/jobs/:jobId/retry`, dibatasi
 * `canRetryJob`. Konsumen yang mencoba ulang sendiri akan membuat tombol
 * "Coba lagi" tidak lagi menjelaskan apa yang terjadi.
 */
export async function d1FailJob(
  db: D1Database,
  jobId: string,
  errorCode: string,
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET status = 'failed', error_code = ?, provider = NULL,
           completed_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    )
    .bind(errorCode, nowMs, jobId)
    .run();
}

/**
 * Menyimpan hasil pekerjaan teks ke baris `product_content`.
 *
 * `source` bernilai `ai`, dan hanya pekerjaan yang belum pernah menyentuh
 * tangan manusia yang sampai di sini: `submitTranscript` mengubah transkrip
 * menjadi `ai_edited` bila pengrajin menyuntingnya, dan transkrip itulah
 * masukannya. Nilai `ai` di sini berarti "kalimat ini disusun mesin dari
 * cerita yang pengrajin sudah setujui", bukan "belum diperiksa siapa pun".
 */
export async function d1FinishCopyJob(
  db: D1Database,
  input: {
    readonly jobId: string;
    readonly productId: string;
    readonly locale: Locale;
    readonly contentId: string;
    readonly name: string;
    readonly story: string;
    readonly specs: readonly string[];
    readonly socialCopy: string | null;
    readonly seoKeywords: readonly string[];
    readonly provider: string;
    readonly productStatus: string;
  },
  nowMs: number,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO product_content
           (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai', ?)
         ON CONFLICT(product_id, locale) DO UPDATE SET
           name = excluded.name,
           story = excluded.story,
           specs = excluded.specs,
           social_copy = excluded.social_copy,
           seo_keywords = excluded.seo_keywords,
           source = 'ai',
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.contentId,
        input.productId,
        input.locale,
        input.name,
        input.story,
        JSON.stringify(input.specs),
        input.socialCopy,
        JSON.stringify(input.seoKeywords),
        nowMs,
      ),
    db
      .prepare(
        `UPDATE jobs SET status = 'succeeded', progress = 100, provider = ?,
             completed_at = ?, error_code = NULL
         WHERE id = ? AND status = 'running'`,
      )
      .bind(input.provider, nowMs, input.jobId),
  ];

  if (input.productStatus === "draft") {
    statements.push(
      db
        .prepare(
          "UPDATE products SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'draft'",
        )
        .bind(nowMs, input.productId),
    );
  }

  await db.batch(statements);
}

/**
 * Menyimpan transkrip hasil ASR.
 *
 * `reviewed` tetap 0. ADR-008 menuntut pengrajin meninjau transkrip sebelum
 * pemrosesan dimulai, dan `reviewed` yang terisi sendiri akan melewati
 * langkah ketiga dari alur enam langkah tanpa siapa pun membacanya.
 *
 * Baris transkrip dapat sudah ada sebelumnya; yang berlaku adalah yang
 * terbaru.
 */
export async function d1FinishAsrJob(
  db: D1Database,
  input: {
    readonly jobId: string;
    readonly productId: string;
    readonly transcriptId: string;
    readonly text: string;
    readonly locale: Locale;
    readonly provider: string;
    readonly durationMs: number;
  },
  nowMs: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO transcripts
           (id, product_id, text, locale, reviewed, edited, provider, duration_ms, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET
           text = excluded.text,
           locale = excluded.locale,
           reviewed = 0,
           edited = 0,
           provider = excluded.provider,
           duration_ms = excluded.duration_ms,
           created_at = excluded.created_at,
           reviewed_at = NULL`,
      )
      .bind(
        input.transcriptId,
        input.productId,
        input.text,
        input.locale,
        input.provider,
        input.durationMs,
        nowMs,
      ),
    db
      .prepare(
        `UPDATE jobs SET status = 'succeeded', progress = 100, provider = ?,
             completed_at = ?, error_code = NULL
         WHERE id = ? AND status = 'running'`,
      )
      .bind(input.provider, nowMs, input.jobId),
  ]);
}

/**
 * Mengembalikan pekerjaan ke antrian tanpa menambah percobaan.
 *
 * `attempt` sengaja tidak dinaikkan: yang kembali ke antrian di sini adalah
 * pekerjaan yang penyedianya melaporkan gangguan sementara, bukan pekerjaan
 * yang sudah dicoba dan gagal. Menaikkannya akan membuat `MAX_JOB_ATTEMPTS`
 * habis oleh antrean yang ramai, dan pengrajin kehilangan tombol "Coba lagi"
 * sebelum ia sempat melihat hasilnya.
 *
 * `error_code` juga dibersihkan: pekerjaan yang kembali ke antrian tidak
 * sedang gagal, dan meninggalkan kode lama akan menampilkan pesan kegagalan
 * di layar proses selagi pekerjaannya berjalan.
 */
export async function d1RequeueJob(
  db: D1Database,
  jobId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE jobs SET status = 'queued', claimed_by = NULL, deadline_at = NULL,
           started_at = NULL, completed_at = NULL, progress = 0, error_code = NULL
       WHERE id = ? AND status = 'running'`,
    )
    .bind(jobId)
    .run();
}
