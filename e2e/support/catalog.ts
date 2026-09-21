/**
 * Katalog galat untuk pengujian.
 *
 * Sebelum ini isinya adalah **salinan** `lib/errors.ts`, dengan alasan bahwa
 * pengujian E2E "tidak dapat membaca berkas itu tanpa membangun proyek lebih
 * dulu". Alasan itu keliru, dan salinannya sempat menyimpang: setelah pesan di
 * `lib/errors.ts` diperbaiki agar menyatakan pekerjaan pengguna aman,
 * salinan di sini masih memuat teks lama — sehingga yang gagal adalah
 * pengujiannya, bukan aplikasinya.
 *
 * Salinan yang menyimpang menguji hal yang salah. `vitest.config.ts` sudah
 * menyatakan prinsip yang sama untuk migrasi: "uji memakai berkas migrasi yang
 * sebenarnya, bukan salinan SQL yang ditulis ulang di dalam uji — salinan akan
 * menyimpang cepat atau lambat".
 *
 * Karena itu berkas ini sekarang **menurunkan** seluruh barisnya dari
 * `lib/errors.ts`, yang merupakan cerminan kontrak API bagian 12. Tidak ada
 * kode, pesan, atau `action` yang dikarang di sini, dan tidak ada yang dapat
 * menyimpang.
 */

import { ERROR_CATALOG, type ErrorCode } from "../../lib/errors";

export interface ErrorCase {
  readonly code: string;
  readonly status: number;
  readonly action: string;
  readonly message: string;
}

/** Seluruh 23 kode, urutan sesuai katalognya. */
export const ERROR_CASES: readonly ErrorCase[] = (Object.keys(ERROR_CATALOG) as ErrorCode[]).map(
  (code) => ({
    code,
    status: ERROR_CATALOG[code].status,
    action: ERROR_CATALOG[code].action,
    message: ERROR_CATALOG[code].message,
  }),
);

export function errorCaseFor(code: string): ErrorCase {
  const found = ERROR_CASES.find((errorCase) => errorCase.code === code);
  if (found === undefined) throw new Error(`Kode galat tidak ada di katalog: ${code}`);
  return found;
}
