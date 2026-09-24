/**
 * Akses D1 untuk pekerjaan AI.
 *
 * Berkas ini adalah satu-satunya tempat di modul `jobs` yang menulis SQL.
 * Aturan siklus hidupnya tetap di `lifecycle.ts`, yang murni dan tidak
 * menyentuh basis data — pemisahan yang sama dengan `worker/db` dan
 * `worker/auth`.
 */

import type { JobKind, JobStatus, Locale } from "../../lib/schemas";

export interface JobRecord {
  readonly id: string;
  readonly productId: string;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly provider: string | null;
  readonly locale: Locale | null;
  readonly attempt: number;
  readonly progress: number;
  readonly errorCode: string | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
}

interface JobRow {
  readonly id: string;
  readonly product_id: string;
  readonly kind: string;
  readonly status: string;
  readonly provider: string | null;
  readonly locale: string | null;
  readonly attempt: number;
  readonly progress: number;
  readonly error_code: string | null;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly completed_at: number | null;
}

const JOB_COLUMNS =
  "id, product_id, kind, status, provider, locale, attempt, progress, error_code, created_at, started_at, completed_at";

/**
 * Pekerjaan satu produk, terbaru lebih dulu.
 *
 * Dipanggil setiap 2 detik selama ada pekerjaan berjalan (kontrak API
 * bagian 7). Karena itu ia satu kueri, bukan satu kueri per pekerjaan:
 * polling yang mahal akan menghabiskan jatah D1 justru saat demo
 * berlangsung.
 */
export async function d1ListJobs(
  db: D1Database,
  productId: string,
): Promise<readonly JobRecord[]> {
  const rows = await db
    .prepare(
      `SELECT ${JOB_COLUMNS} FROM jobs
       WHERE product_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(productId)
    .all<JobRow>();

  return rows.results.map((row) => ({
    id: row.id,
    productId: row.product_id,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    provider: row.provider,
    locale: row.locale as Locale | null,
    attempt: row.attempt,
    progress: row.progress,
    errorCode: row.error_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }));
}

/**
 * Pekerjaan terbaru per jenis dan bahasa.
 *
 * Setiap percobaan ulang ("Coba lagi") menulis baris pekerjaan BARU, bukan
 * menimpa yang lama — riwayat itu berguna untuk diagnosis, tetapi layar
 * proses hanya boleh menampilkan status terkini. Tanpa penyaringan ini,
 * satu produk yang dicoba 14 kali menampilkan 42 baris dan angka
 * "Tahap 3 dari 42" yang tidak berarti apa-apa bagi pengrajin.
 *
 * Masukan sudah terurut terbaru-lebih-dulu (lihat `d1ListJobs`), jadi
 * kemunculan pertama per kunci adalah yang terbaru.
 */
export function latestJobs(
  jobs: readonly JobRecord[],
): readonly JobRecord[] {
  const seen = new Set<string>();
  const latest: JobRecord[] = [];

  for (const job of jobs) {
    const key = `${job.kind}:${job.locale ?? "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(job);
  }

  return latest;
}

/**
 * Kemajuan keseluruhan satu produk.
 *
 * Rata-rata sederhana dari kemajuan setiap pekerjaan. Pekerjaan yang gagal
 * dihitung seratus persen selesai: ia tidak akan maju lagi, dan menahannya
 * di bawah seratus akan membuat bilah kemajuan berhenti selamanya pada
 * pekerjaan yang sudah tidak berjalan.
 */
export function overallProgress(jobs: readonly JobRecord[]): number {
  if (jobs.length === 0) return 0;

  const total = jobs.reduce(
    (sum, job) => sum + (job.status === "failed" ? 100 : job.progress),
    0,
  );

  return Math.round(total / jobs.length);
}
