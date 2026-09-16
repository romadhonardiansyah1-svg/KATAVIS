import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

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
        test: {
          name: "unit",
          environment: "node",
          include: ["worker/**/*.test.ts", "lib/**/*.test.ts", "agent/**/*.test.ts"],
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
