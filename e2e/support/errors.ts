/**
 * Tangkapan permintaan untuk pemeriksaan anti-slop pesan galat.
 *
 * TC-E2E-20 sampai TC-E2E-22 memeriksa teks yang **terlihat pengguna**, bukan
 * nilai yang dikembalikan API. Karena itu yang dibaca adalah DOM yang sudah
 * dirender — termasuk setiap `role="alert"` dan `role="status"` yang muncul —
 * bukan badan respons.
 *
 * Pemeriksaannya sengaja tidak menafsirkan pesan galat sebagai kalimat biasa:
 * satu galat yang menyebut "500" di dalam banner adalah kegagalan, dan itu
 * tepat yang ditemukan cara ini dan terlewat oleh tinjauan manual.
 */

import { expect, type Locator, type Page } from "@playwright/test";

// Dibaca dari katalog, bukan disalin: daftar yang disalin ke dua tempat
// adalah daftar yang cepat atau lambat berbeda pendapat.
import { FORBIDDEN_MESSAGE_TERMS } from "../../lib/errors";

export { FORBIDDEN_MESSAGE_TERMS };


/**
 * Wilayah tempat pesan galat muncul di `StepShell`.
 *
 * Bukan `getByRole("alert")` polos: Next.js menanam `#__next-route-announcer__`
 * dengan `role="alert"` di setiap halaman, sehingga lokator polos selalu
 * menemukan dua elemen dan strict mode menggagalkan pengujian sebelum
 * pesannya sempat diperiksa.
 */
export function errorBanner(page: Page): Locator {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

/**
 * Setiap teks yang terlihat pengguna pada halaman.
 *
 * `innerText` dipakai, bukan `textContent`: yang diperiksa adalah apa yang
 * benar-benar terbaca di layar, dan simpul tersembunyi tidak terlihat
 * pengguna. Itu juga yang membuat pemeriksaan ini tidak gagal karena
 * `display:none` yang memang disengaja.
 */
export async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

/**
 * Memeriksa tidak ada istilah teknis yang bocor ke layar.
 *
 * Pencocokan dilakukan per kata, bukan per potongan huruf. "null" yang dicari
 * adalah kata "null", bukan "nulla" di dalam kalimat berbahasa Italia — dan
 * "500" dicari sebagai angka sendiri, bukan sebagai bagian dari "5000".
 */
export async function expectNoTechnicalTerms(page: Page, context: string): Promise<void> {
  const text = await visibleText(page);
  const words = text
    .toLocaleLowerCase("id-ID")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);

  const found = FORBIDDEN_MESSAGE_TERMS.filter((term) => words.includes(term));

  expect(found, `${context}: istilah teknis terlihat pengguna — ${found.join(", ")}`).toEqual([]);
}

/**
 * Memeriksa pesan galat menyatakan pekerjaan pengguna aman (S5-05).
 *
 * Kalimatnya berasal dari katalog `lib/errors.ts`, dan yang dicari adalah
 * salah satu penandanya. Tidak ada satu kata yang wajib: setiap pesan
 * menyatakannya dengan caranya sendiri, dan mengunci satu kata akan membuat
 * pengujian ini menolak pesan yang benar.
 */
const WORK_SAFE_MARKERS = [
  "tersimpan",
  "tetap tersimpan",
  "tidak hilang",
  "aman",
  "utuh",
] as const;

export function statesWorkIsSafe(message: string): boolean {
  const normalized = message.toLocaleLowerCase("id-ID");
  return WORK_SAFE_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Memeriksa pesan galat memuat langkah berikutnya (S5-04).
 *
 * `StepShell` menampilkan `action` sebagai baris terpisah di bawah pesannya
 * (`app/create/StepShell.tsx` baris 129). Yang diperiksa bukan nama aksinya,
 * melainkan bahwa ada sesuatu untuk dikerjakan pengguna setelah membaca
 * pesannya — kalimat perintah, bukan sekadar pernyataan.
 */
const NEXT_STEP_MARKERS = [
  "coba lagi",
  "rekam lagi",
  "silakan",
  "pilih",
  "tambahkan",
  "lengkapi",
  "masuk lagi",
  "minta",
  "periksa",
  "gunakan",
  "tunggu",
  "kembali",
  "lanjutkan",
  "pakai foto asli",
  "coba beberapa menit",
] as const;

export function tellsNextStep(message: string): boolean {
  const normalized = message.toLocaleLowerCase("id-ID");
  return NEXT_STEP_MARKERS.some((marker) => normalized.includes(marker));
}
