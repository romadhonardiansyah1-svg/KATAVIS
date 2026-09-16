import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

/**
 * Menegakkan aturan yang tidak bisa diserahkan pada disiplin.
 *
 * Dua yang terpenting:
 *   1. Batas modul Worker (ADR-001). Modul hanya boleh saling memanggil
 *      lewat index.ts, tidak pernah menembus ke bagian dalam.
 *   2. Larangan `any` dan `@ts-ignore`. Keduanya adalah cara menghindari
 *      masalah tipe, bukan menyelesaikannya.
 */
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".wrangler/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".stryker-tmp/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      // `partialMatch: false` mencocokkan seluruh jalur berkas, bukan
      // hanya folder induknya. Tanpa ini, impor ke berkas dalam seperti
      // worker/rbac/internal/x.ts tidak terdeteksi sebagai pelanggaran.
      "boundaries/elements": [
        { type: "auth", pattern: "worker/auth/**", partialMatch: false },
        { type: "rbac", pattern: "worker/rbac/**", partialMatch: false },
        { type: "catalog", pattern: "worker/catalog/**", partialMatch: false },
        { type: "media", pattern: "worker/media/**", partialMatch: false },
        { type: "jobs", pattern: "worker/jobs/**", partialMatch: false },
        { type: "export", pattern: "worker/export/**", partialMatch: false },
        { type: "audit", pattern: "worker/audit/**", partialMatch: false },
        { type: "lib", pattern: "lib/**", partialMatch: false },
        { type: "app", pattern: "app/**", partialMatch: false },
        { type: "agent", pattern: "agent/**", partialMatch: false },
      ],
      "boundaries/ignore": ["**/*.test.ts", "**/*.integration.test.ts"],
      // Resolver TypeScript wajib agar impor tanpa ekstensi (.ts)
      // ter-resolve dengan benar. Tanpa ini, pemeriksaan batas
      // dilewati secara diam-diam untuk impor yang gagal di-resolve.
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      // Satu aturan menegakkan dua hal sekaligus:
      //   1. Modul mana boleh memanggil modul mana
      //   2. Modul hanya dapat diakses lewat index.ts-nya
      //
      // ADR-001: batas ini yang memungkinkan pemecahan menjadi layanan
      // terpisah kelak tanpa penulisan ulang.
      //
      // Urutan penting: policy berikutnya menimpa yang sebelumnya.
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            // Seluruh modul boleh memakai utilitas bersama.
            {
              from: { element: { type: "*" } },
              allow: { to: { element: { type: "lib" } } },
            },
            // Modul bisnis memeriksa izin dan mencatat aktivitas.
            {
              from: { element: { type: ["catalog", "media", "jobs", "export"] } },
              allow: { to: { element: { type: ["rbac", "audit"] } } },
            },
            { from: { element: { type: "auth" } },
              allow: { to: { element: { type: "audit" } } } },
            // rbac adalah fondasi: ia tidak mengimpor modul Worker lain.
            // Ini yang membuat 13 kasus ujinya berjalan tanpa basis data.
            {
              from: { element: { type: "rbac" } },
              disallow: {
                to: {
                  element: {
                    type: ["auth", "catalog", "media", "jobs", "export", "audit"],
                  },
                },
              },
            },
            { from: { element: { type: "app" } },
              allow: { to: { element: { type: "app" } } } },
            { from: { element: { type: "agent" } },
              allow: { to: { element: { type: "agent" } } } },
            // Menembus ke bagian dalam modul Worker selalu dilarang,
            // menimpa seluruh izin di atas.
            {
              from: { element: { type: "*" } },
              disallow: {
                to: {
                  element: {
                    type: ["auth", "rbac", "catalog", "media", "jobs", "export", "audit"],
                    fileInternalPath: "!index.ts",
                  },
                },
              },
            },
          ],
        },
      ],

      // Tanpa `any`, tanpa penekanan galat tipe.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": "allow-with-description" },
      ],

      // Variabel tak terpakai menandakan kode mati atau logika terlewat.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // `catch` yang menelan galat tanpa penanganan dilarang (AGENTS.md).
      "no-empty": ["error", { allowEmptyCatch: false }],

      // Nama generik menyembunyikan maksud kode (AGENTS.md).
      //
      // `data` dan `result` sengaja TIDAK dilarang: `data` adalah bidang
      // wajib pada bentuk respons di kontrak API bagian 1, dan `result`
      // adalah nama baku untuk hasil `safeParse` Zod. Melarang keduanya
      // berarti melarang hal yang benar.
      "id-denylist": ["error", "temp", "obj", "val", "foo", "bar", "stuff", "thing"],

      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
    },
  },

  {
    // worker/index.ts merakit seluruh modul; ia bukan bagian modul mana pun
    // sehingga aturan batas tidak berlaku padanya.
    files: ["worker/index.ts"],
    rules: { "boundaries/dependencies": "off" },
  },

  {
    // Studio Agent berjalan di Node, bukan Workers. Ia butuh console
    // untuk diagnostik saat selector pecah di laptop.
    files: ["agent/**/*.{ts,js}"],
    rules: { "no-console": "off" },
  },

  {
    // Berkas konfigurasi memakai nama yang terdaftar di id-denylist.
    files: ["*.config.{ts,js}", "tools/**"],
    rules: { "id-denylist": "off" },
  },
);
