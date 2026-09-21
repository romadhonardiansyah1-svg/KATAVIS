/**
 * Menyambungkan tipe uji integrasi ke binding milik Worker.
 *
 * Dua hal yang dikerjakan berkas ini, keduanya hanya demi `tsc`:
 *
 *   1. Memuat deklarasi modul `cloudflare:test`. Paketnya menyediakannya di
 *      subpath `./types`, dan `types` di tsconfig.json hanya menerima nama
 *      paket — bukan subpath. Tanpa impor ini, setiap uji integrasi gagal
 *      dengan "Cannot find module 'cloudflare:test'" meski ujinya sendiri
 *      berjalan benar di workerd.
 *
 *   2. Menambahkan binding uji ke `Cloudflare.Env`, tipe yang dipakai
 *      `env` dari `cloudflare:test`. Tanpa ini, `env.DB` tidak dikenali.
 *
 * Berkas ini tidak menghasilkan kode apa pun saat dijalankan.
 */

import "@cloudflare/vitest-pool-workers/types";

import type { Env as WorkerEnv } from "./index";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      /**
       * Migrasi yang dibaca vitest.config.ts dan diserahkan sebagai binding.
       * Hanya ada saat uji integrasi, tidak pernah ada di produksi.
       */
      readonly TEST_MIGRATIONS: { name: string; queries: string[] }[];
    }
  }
}
