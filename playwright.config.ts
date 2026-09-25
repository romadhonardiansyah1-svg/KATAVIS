import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,

  // Mesin pengembangan punya 1,7 GB RAM bebas. Paralel penuh akan
  // menyebabkan swap. Lihat docs/ARCHITECTURE.md bagian 1.
  workers: CI ? 2 : 1,

  reporter: CI
    ? [["github"], ["html", { open: "never", outputFolder: "test-output/html" }], ["json", { outputFile: "test-output/results.json" }]]
    : [["list"], ["html", { open: "never", outputFolder: "test-output/html" }]],

  // Direktori keluaran dipusatkan di bawah `test-output/`.
  //
  // Bawaan Playwright adalah `test-results/` yang ditulis ulang setiap
  // dijalankan. Pada mesin ini, penulisan ulang itu melewati pembersih
  // berkas yang menjaga direktori pengguna, dan pembersih itu menghentikan
  // proses sebelum satu pun kasus uji berjalan. Satu direktori yang
  // dinyatakan di sini membuat pembersihannya terkendali dan hasilnya
  // mudah ditemukan sesudahnya.
  outputDir: "test-output/artifacts",

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    // Perekaman video dan jejak diredam di lokal, tetap penuh di CI.
    //
    // Mesin pengembangan hanya menyisakan 1,7 GB RAM (AGENTS.md, kendala
    // keras). "retain-on-failure" merekam video SEMUA kasus uji dulu baru
    // menghapus yang lulus — dikalikan empat proyek peramban, itu yang membuat
    // mesin swap, proses terkunci, dan satu kali menjalankan menghasilkan
    // 3.600 berkas artefak. Tangkapan layar kegagalan tetap aktif; itu cukup
    // untuk mendiagnosis di lokal. Jejak dan video lengkap diambil di CI
    // yang memorinya memadai.
    trace: CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
    video: CI ? "retain-on-failure" : "off",
    // Pengguna sasaran memakai Android kelas menengah ke bawah.
    // Menguji pada koneksi cepat menyembunyikan masalah nyata.
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },

  projects: [
    {
      // Viewport utama: Android kelas menengah, bukan desktop.
      // DESIGN.md menyebut layar 5-6 inci sebagai target utama.
      name: "android-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
    {
      // Menguji perilaku di bawah prefers-reduced-motion (TC-A11Y-08).
      //
      // Pola lama `/.*\.a11y\.spec\.ts/` menuntut titik tepat sebelum "a11y",
      // sedangkan berkasnya `e2e/a11y.spec.ts` — pemisahnya garis miring,
      // bukan titik. Akibatnya proyek ini menjalankan NOL kasus uji tanpa
      // satu pun peringatan. Pola berjangkar akhir cocok untuk kedua
      // pemisah jalur.
      name: "reduced-motion",
      use: {
        ...devices["Pixel 7"],
        reducedMotion: "reduce",
      },
      testMatch: /a11y\.spec\.ts$/,
    },
  ],

  // Build dijalankan oleh langkah CI sebelumnya, tetapi proses Next belum
  // berjalan. Playwright harus menyalakannya sebelum membuka halaman.
  //
  // Pengujian dijalankan terhadap build PRODUKSI, bukan `next dev`, karena
  // dua alasan yang diukur, bukan preferensi:
  //
  //   1. Turbopack dev tidak pernah menyelesaikan hidrasi di WebKit:
  //      chunk HMR-nya diminta berulang tanpa satu pun galat JS, dan
  //      halaman berhenti di "Memuat..." selamanya. Seluruh proyek
  //      mobile-safari gagal karenanya — bukan karena aplikasi.
  //   2. Kompilasi per-rute di mode dev lambat dan tidak stabil di bawah
  //      beban beberapa proyek peramban (rute yang sama dikompilasi ulang
  //      untuk target Chromium dan WebKit).
  //
  // Build produksi juga yang dinilai juri saat demo. Harganya satu build
  // di awal (~1-3 menit di mesin ini); sesudahnya setiap rute instan.
  webServer: {
    command: CI ? "pnpm exec next start" : "pnpm run build && pnpm exec next start",
    url: "http://localhost:3000",
    reuseExistingServer: !CI,
    timeout: 360_000,
  },

  expect: {
    // Pekerjaan AI berjalan 15-70 detik (ADR-007). Timeout bawaan
    // 5 detik akan menggagalkan uji alur yang sah.
    timeout: 10_000,
  },
  timeout: 120_000,
});
