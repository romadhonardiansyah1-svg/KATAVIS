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
    ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "e2e-results.json" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
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
      name: "reduced-motion",
      use: {
        ...devices["Pixel 7"],
        reducedMotion: "reduce",
      },
      testMatch: /.*\.a11y\.spec\.ts/,
    },
  ],

  // Di CI, server sudah berjalan sebelum Playwright dipanggil.
  // `exactOptionalPropertyTypes` menolak `undefined` di sini, jadi
  // properti dihilangkan sepenuhnya alih-alih diberi nilai undefined.
  ...(CI
    ? {}
    : {
        webServer: {
          command: "pnpm run dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),

  expect: {
    // Pekerjaan AI berjalan 15-70 detik (ADR-007). Timeout bawaan
    // 5 detik akan menggagalkan uji alur yang sah.
    timeout: 10_000,
  },
  timeout: 120_000,
});
