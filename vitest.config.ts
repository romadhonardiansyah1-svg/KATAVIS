import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Migrasi dibaca di sini, bukan di dalam uji.
 *
 * Berkas konfigurasi berjalan di Node dan boleh menyentuh sistem berkas;
 * uji integrasi berjalan di workerd dan tidak. Membacanya di sini membuat
 * uji memakai berkas migrasi yang sebenarnya, bukan salinan SQL yang
 * ditulis ulang di dalam uji — salinan akan menyimpang cepat atau lambat.
 */
const MIGRATIONS = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    queries: readFileSync(join("migrations", name), "utf8")
      // Baris komentar penuh dibuang lebih dulu. Tanpa ini, potongan
      // terakhir sebuah berkas yang hanya berisi komentar tetap dianggap
      // sebagai pernyataan dan D1 menolaknya dengan "SQL code did not
      // contain a statement".
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0)
      .map((statement) => `${statement};`),
  }));

/**
 * Dua proyek dengan runtime berbeda:
 *
 *   unit   -> Node. Logika murni tanpa I/O. Cepat.
 *   worker -> workerd asli dengan D1 dan R2 Miniflare.
 *
 * Integrasi TIDAK memakai tiruan D1. Menirukan D1 akan menyembunyikan
 * justru masalah yang paling mungkin terjadi: batas 50 kueri per
 * invocation pada paket gratis (ADR-006, TC-PERF-04).
 *
 * Coverage diatur di level root karena Vitest 4 tidak menerimanya
 * per-project.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["worker/**/*.ts", "lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/types.ts", "**/index.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        // Ambang lebih ketat untuk modul jalur kritis.
        // Lihat docs/testing/TEST-PLAN.md bagian 3.
        "worker/rbac/**": { lines: 95, functions: 95, branches: 90 },
        "worker/jobs/**": { lines: 90, functions: 90, branches: 85 },
      },
    },
    projects: [
      {
        resolve: { alias: { "@": process.cwd() } },
        test: {
          name: "unit",
          environment: "node",
          include: [
            "worker/**/*.test.ts",
            "lib/**/*.test.ts",
            // Jam narasi Talking-Catalog menentukan F3-01, F3-03, dan F3-04
            // sekaligus. Ia fungsi murni, jadi ketiganya dapat dibuktikan
            // tanpa peramban — dan uji yang butuh peramban adalah uji yang
            // pertama dilewati saat waktu menipis. Komponennya sendiri tetap
            // diuji di Playwright, tempat DOM-nya nyata.
            "components/**/*.test.ts",
            "agent/**/*.test.ts",
            // Alur enam langkah memuat aturan penjagaan yang murni dan
            // menentukan keenam halaman; ia layak diuji seperti modul lain.
            "app/**/*.test.ts",
          ],
          exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              compatibilityDate: "2026-08-22",
              compatibilityFlags: ["nodejs_compat"],
              bindings: { TEST_MIGRATIONS: MIGRATIONS },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["worker/**/*.integration.test.ts"],
        },
      },
    ],
  },
});
