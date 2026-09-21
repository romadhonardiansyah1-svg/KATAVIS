/**
 * Penghitung kueri D1 per invocation.
 *
 * D1 pada paket gratis mengizinkan **50 kueri per invocation Worker**, bukan
 * 1000 seperti paket berbayar (ADR-006). Satu pola N+1 di dalam perulangan
 * menembus batas itu, dan galatnya baru muncul di produksi — bukan di mesin
 * pengembangan yang trafiknya satu orang.
 *
 * Karena itu batas ini tidak diserahkan pada disiplin. Setiap pernyataan
 * yang dieksekusi lewat `Db` di berkas ini dicatat, dan pengujian integrasi
 * memeriksa jumlah NYATA terhadap D1 Miniflare, bukan menghitung tiruan.
 * Tiruan akan menyembunyikan justru masalah yang dicari (TC-PERF-04).
 *
 * `Db` sengaja sempit. Lapisan kueri tidak dapat memanggil `prepare`,
 * `withSession`, atau apa pun dari `D1Database` selain empat operasi di
 * bawah — sehingga tidak ada jalan menghitung kueri secara tidak sengaja
 * terlewat.
 */

import { LIMITS } from "../../lib/schemas";

/**
 * Anggaran kueri per invocation.
 *
 * Batas sesungguhnya 50. Ambang 25 memberi ruang aman selebar dua kali
 * lipat, karena jumlah kueri pada rute nyata bergantung pada data yang
 * ditemukan, bukan hanya pada kode.
 */
export const QUERY_BUDGET = LIMITS.MAX_D1_QUERIES_PER_REQUEST;

export interface QueryCounter {
  /** Jumlah pernyataan yang dieksekusi sejak reset terakhir. */
  total(): number;
  /** Kueri yang dicatat, berurutan. Dipakai saat uji gagal untuk melihat polanya. */
  log(): readonly string[];
  record(query: string): void;
  reset(): void;
}

export function createQueryCounter(): QueryCounter {
  let count = 0;
  let queries: string[] = [];

  return {
    total: () => count,
    log: () => [...queries],
    record: (query) => {
      count += 1;
      queries.push(query);
    },
    reset: () => {
      count = 0;
      queries = [];
    },
  };
}

/**
 * Anggaran terlampaui.
 *
 * Membawa serta daftar kuerinya: uji yang gagal harus dapat menunjukkan
 * kueri mana yang berulang, bukan hanya berapa jumlahnya. Tanpa itu,
 * memperbaiki pola N+1 menjadi pekerjaan menebak.
 */
export class QueryBudgetExceeded extends Error {
  readonly total: number;
  readonly budget: number;
  readonly queries: readonly string[];

  constructor(total: number, budget: number, queries: readonly string[]) {
    super(`Anggaran kueri D1 terlampaui: ${total} dari ${budget}`);
    this.name = "QueryBudgetExceeded";
    this.total = total;
    this.budget = budget;
    this.queries = queries;
  }
}

/**
 * Memastikan anggaran belum terlampaui.
 *
 * Ambangnya diperlakukan sebagai batas atas **eksklusif**: TC-PERF-04
 * menulis "< 25", jadi 25 itu sendiri sudah dianggap gagal. Bersikap lebih
 * ketat tidak merugikan apa pun — batas D1 sesungguhnya 50.
 *
 * Fungsi ini untuk pengujian, bukan untuk produksi. Melempar pada kueri
 * ke-26 akan mengubah rute yang masih berfungsi menjadi 500, sementara
 * anggarannya sendiri masih separuh batas D1.
 */
export function assertWithinBudget(
  counter: QueryCounter,
  budget: number = QUERY_BUDGET,
): void {
  const total = counter.total();
  if (total >= budget) {
    throw new QueryBudgetExceeded(total, budget, counter.log());
  }
}

// --- Handle basis data ---

export interface DbStatement {
  readonly query: string;
  readonly params: readonly unknown[];
}

/**
 * Empat operasi, tidak lebih.
 *
 * `batch` adalah satu-satunya cara menjalankan banyak pernyataan, dan ia
 * memang yang dibutuhkan: satu putaran jaringan untuk lima tabel, bukan
 * lima putaran. Setiap pernyataan di dalamnya tetap dihitung satu kueri,
 * karena D1 menghitungnya begitu.
 */
export interface Db {
  first<TValue>(statement: DbStatement): Promise<TValue | null>;
  all<TValue>(statement: DbStatement): Promise<TValue[]>;
  run(statement: DbStatement): Promise<void>;
  /**
   * Menjalankan banyak pernyataan dalam satu putaran. Hasilnya berurutan
   * sesuai pernyataannya, masing-masing berupa baris mentah.
   */
  batch(statements: readonly DbStatement[]): Promise<readonly (readonly unknown[])[]>;
}

/**
 * Membungkus `D1Database` menjadi `Db` yang menghitung.
 *
 * Yang dihitung adalah pernyataan yang **dieksekusi**, bukan yang disiapkan.
 * `prepare()` yang tidak pernah dijalankan tidak menghabiskan kuota D1, jadi
 * ia tidak boleh dihitung — kalau dihitung, penghitungnya akan melaporkan
 * angka yang lebih besar dari kenyataan dan ambang 25 kehilangan artinya.
 */
export function createDb(database: D1Database, counter: QueryCounter): Db {
  return {
    async first<TValue>(statement: DbStatement): Promise<TValue | null> {
      counter.record(statement.query);
      return database
        .prepare(statement.query)
        .bind(...statement.params)
        .first<TValue>();
    },

    async all<TValue>(statement: DbStatement): Promise<TValue[]> {
      counter.record(statement.query);
      const result = await database
        .prepare(statement.query)
        .bind(...statement.params)
        .all<TValue>();
      return result.results;
    },

    async run(statement: DbStatement): Promise<void> {
      counter.record(statement.query);
      await database
        .prepare(statement.query)
        .bind(...statement.params)
        .run();
    },

    async batch(
      statements: readonly DbStatement[],
    ): Promise<readonly (readonly unknown[])[]> {
      if (statements.length === 0) return [];

      for (const statement of statements) counter.record(statement.query);

      const results = await database.batch(
        statements.map((statement) =>
          database.prepare(statement.query).bind(...statement.params),
        ),
      );

      return results.map((result) => result.results);
    },
  };
}
