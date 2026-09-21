/**
 * TC-E2E-06 — pembeli membuka katalog publik.
 *
 * ==== Mengapa berkas ini tipis ====
 *
 * Kasus ujinya **dijalankan di `create-catalog.spec.ts`**, yang sudah memuat
 * pembantu `openStep`, penyadapan `GET /public/catalog/:slug`, dan data uji
 * kriya yang dipakai bersama. Memindahkannya ke sini berarti menyalin
 * keduanya.
 *
 * ==== Yang diuji di sana ====
 *
 *   - Talking-Catalog berjalan: putar, jeda, ulang (F3-02)
 *   - Subtitle tampil sebagai teks nyata yang dapat disalin (F3-07,
 *     TC-A11Y-28)
 *   - Produk yang tidak terbit menghasilkan 404, bukan 403 — `403`
 *     membocorkan keberadaan produk (kontrak API bagian 10)
 *
 * ==== Yang tidak dapat diuji di E2E, dan alasannya ====
 *
 * Kontrak API bagian 10 menyatakan `narration.audioUrl` dan `captions` datang
 * dari server, dan `worker/index.ts` baris 979 hari ini **selalu** mengirim
 * `audioUrl: null` dengan `captions: []`. Penyedia TTS final belum ditetapkan
 * (ADR-005 "Keputusan terbuka", O4). Karena itu:
 *
 *   - Sinkronisasi subtitle ±200 ms (TC-A11Y-24, F3-01) hanya dapat diukur
 *     pada data yang benar-benar berwaktu dari server. Selama server belum
 *     pernah mengirim `captions` yang tidak kosong, tidak ada yang dapat
 *     diukur, dan mengukur data yang disadap di pengujian akan mengukur
 *     pengujian itu sendiri.
 *   - TC-A11Y-28 (memilih dan menyalin subtitle) diuji terhadap data sadapan
 *     di `create-catalog.spec.ts`, dan itu menyatakan kebenaran yang
 *     terbatas: komponennya bekerja bila datanya ada.
 *
 * Pengukuran sinkronisasi yang sesungguhnya menunggu ADR-005 diputuskan.
 * Menulisnya sekarang berarti mengukir angka ke dalam pengujian yang tidak
 * berasal dari sistem nyata, dan angka itu akan bertahan jauh lebih lama
 * daripada keputusan yang melatarbelakanginya.
 *
 * **Yang perlu diputuskan (jangan dikarang sendiri):** penyedia TTS mana yang
 * dipakai, dan dari mana berkas suaranya dilayani. Keduanya menentukan apakah
 * `audioUrl` berisi, dan seluruh pengukuran sinkronisasi bergantung padanya.
 */

import { expect, test } from "@playwright/test";

import { LIVE_WORKER_REASON, NEEDS_LIVE_WORKER } from "./support/flow";

test.describe("TC-E2E-06 katalog publik dapat diakses tanpa autentikasi", () => {
  // Halaman katalog diambil di sisi server; stub peramban tidak menjangkaunya.
  // Karena itu kasus di sini dijalankan terhadap Worker yang benar-benar
  // berjalan dan data yang benar-benar tersemai — lihat
  // `e2e/fixtures/seed-local-d1.sql`.
  test.skip(NEEDS_LIVE_WORKER, LIVE_WORKER_REASON);

  test("halaman publik tidak menuntut token", async ({ page }) => {
    // Kontrak API bagian 10: `GET /public/catalog/:slug` — tanpa autentikasi.
    // Halaman ini satu-satunya layar yang dilihat pembeli, dan pembeli tidak
    // punya akun.
    //
    // Yang diperiksa adalah keadaannya, bukan kepala permintaannya: halaman
    // dimuat tanpa satu pun token di penyimpanan, dan isinya tetap dirender.
    // Menyadap kepala permintaan tidak mungkin di sini — permintaannya
    // dijalankan server Next.js, di luar jangkauan `page.route`.
    await page.goto("/catalog/tas-kulit-nusantara");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tas Kulit Nusantara");
    await expect(page.getByText("Dibuat oleh Irsyad")).toBeVisible();

    const storedToken = await page.evaluate(() => window.localStorage.getItem("katavis.accessToken"));
    expect(storedToken, "Halaman publik menyimpan token").toBeNull();
  });

  test("identitas pengrajin yang dibagikan hanya nama tampilan", async ({ page }) => {
    // Kontrak API bagian 10: "`artisan` hanya memuat nama tampilan. Nomor
    // telepon dan identitas lain tidak pernah dikirim ke titik akhir publik."
    //
    // Baris `users` di basis data MEMUAT nomor telepon (wajib, `UNIQUE NOT
    // NULL`); yang diuji adalah nomor itu tidak pernah sampai ke layar.
    await page.goto("/catalog/tas-kulit-nusantara");
    await expect(page.getByText("Dibuat oleh Irsyad")).toBeVisible();

    // Tidak ada nomor telepon yang bocor ke halaman.
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, "Nomor telepon terlihat di halaman publik").not.toMatch(/\+62\d{8,}/);
  });
});
