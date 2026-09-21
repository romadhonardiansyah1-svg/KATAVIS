/**
 * Siklus hidup pekerjaan AI.
 *
 * Status mengikuti CHECK pada `jobs.status` (migrations/0001) dan
 * JobStatusSchema di lib/schemas.ts. Tidak ada status baru di sini.
 *
 * Satu aturan yang menentukan seluruh berkas ini: **transisi hanya maju**.
 * Pekerjaan yang sudah selesai tidak pernah berjalan lagi, dan pekerjaan
 * yang sedang berjalan tidak pernah dianggap gagal hanya karena satu
 * lapisan penyedia melambat.
 */

import { LIMITS, type JobStatus } from "../../lib/schemas";

/**
 * Transisi yang sah.
 *
 * `failed → queued` adalah percobaan ulang, dan ia satu-satunya jalan
 * kembali. `succeeded` dan `cancelled` tidak punya tujuan sama sekali:
 * keduanya keadaan akhir.
 *
 * `queued → succeeded` sengaja tidak ada meski terlihat tidak berbahaya.
 * Pekerjaan yang selesai tanpa pernah tercatat `running` berarti ada
 * langkah yang terlewat, dan menyembunyikannya hanya memindahkan masalah
 * ke tempat yang lebih sulit ditemukan.
 */
export const JOB_STATUS_TRANSITIONS: Readonly<
  Record<JobStatus, readonly JobStatus[]>
> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["queued"],
  cancelled: [],
};

/** Transisi dari `from` ke `to` sah. Nilai tak dikenal ditolak. */
export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return (JOB_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Keadaan akhir: pekerjaan tidak akan berjalan lagi.
 *
 * Dipakai konsumen antrian untuk memastikan ia tidak mengambil pekerjaan
 * yang sudah selesai — "menganggap pekerjaan gagal saat sebenarnya masih
 * berjalan" adalah jebakan yang dilarang prompt P2, dan bentuk
 * kebalikannya sama merusaknya.
 */
export function isTerminal(status: JobStatus): boolean {
  return (JOB_STATUS_TRANSITIONS[status] ?? []).length === 0;
}

/**
 * Pekerjaan masih boleh dicoba ulang.
 *
 * Batasnya satu dan berlaku untuk semua: `LIMITS.MAX_JOB_ATTEMPTS`.
 * Tidak ada pengecualian untuk penyedia yang membalas 429 — justru di situ
 * percobaan ulang tanpa batas paling mudah terjadi, dan akibatnya jatah
 * gratis habis sekaligus waktu tunggu pengrajin memanjang tanpa ujung.
 */
export function canRetryJob(attempt: number): boolean {
  return attempt < LIMITS.MAX_JOB_ATTEMPTS;
}
