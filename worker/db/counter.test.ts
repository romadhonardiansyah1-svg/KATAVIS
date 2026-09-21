/**
 * Uji penghitung kueri — TC-PERF-04.
 *
 * Penghitung ini adalah satu-satunya alasan TC-PERF-04 dapat dipercaya.
 * Kalau ia salah menghitung, uji integrasi yang memakainya akan lulus
 * tanpa membuktikan apa pun. Karena itu aritmetikanya diuji terpisah, dan
 * perilaku ambangnya diuji pada batas yang tepat.
 *
 * Penghitungan terhadap D1 sungguhan ada di `queries.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { LIMITS } from "../../lib/schemas";

import {
  QUERY_BUDGET,
  QueryBudgetExceeded,
  assertWithinBudget,
  createQueryCounter,
} from "./counter";

describe("db — penghitung kueri", () => {
  it("menghitung setiap pernyataan yang dicatat", () => {
    const counter = createQueryCounter();

    expect(counter.total()).toBe(0);

    counter.record("SELECT 1");
    counter.record("SELECT 2");
    counter.record("SELECT 3");

    expect(counter.total()).toBe(3);
    expect(counter.log()).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
  });

  it("mengosongkan hitungan dan catatan saat reset", () => {
    const counter = createQueryCounter();
    counter.record("SELECT 1");
    counter.reset();

    expect(counter.total()).toBe(0);
    expect(counter.log()).toEqual([]);
  });

  it("mengembalikan salinan catatan, bukan larik di dalamnya", () => {
    // Kalau catatan dikembalikan apa adanya, pemanggil dapat menambah atau
    // menghapus isinya dan angka yang dilaporkan tidak lagi dapat dipercaya.
    const counter = createQueryCounter();
    counter.record("SELECT 1");

    const snapshot = counter.log();
    expect(snapshot).toHaveLength(1);

    counter.record("SELECT 2");
    expect(snapshot).toHaveLength(1);
    expect(counter.total()).toBe(2);
  });

  it("menetapkan anggaran dari LIMITS, bukan angka yang diketik ulang", () => {
    expect(QUERY_BUDGET).toBe(LIMITS.MAX_D1_QUERIES_PER_REQUEST);
    expect(QUERY_BUDGET).toBe(25);
    // Batas D1 paket gratis adalah 50 (ADR-006). Anggaran harus menyisakan
    // ruang, bukan menyamainya.
    expect(QUERY_BUDGET).toBeLessThan(50);
  });

  it("menerima jumlah kueri tepat di bawah anggaran", () => {
    const counter = createQueryCounter();
    for (let index = 0; index < QUERY_BUDGET - 1; index += 1) {
      counter.record(`SELECT ${index}`);
    }

    expect(counter.total()).toBe(QUERY_BUDGET - 1);
    expect(() => assertWithinBudget(counter)).not.toThrow();
  });

  it("menolak jumlah kueri tepat pada anggaran", () => {
    // TC-PERF-04 menulis "< 25", jadi 25 itu sendiri sudah gagal. Ambangnya
    // batas atas eksklusif.
    const counter = createQueryCounter();
    for (let index = 0; index < QUERY_BUDGET; index += 1) {
      counter.record(`SELECT ${index}`);
    }

    expect(counter.total()).toBe(QUERY_BUDGET);
    expect(() => assertWithinBudget(counter)).toThrow(QueryBudgetExceeded);
  });

  it("membawa daftar kueri saat anggaran terlampaui", () => {
    // Uji yang gagal harus dapat menunjukkan kueri mana yang berulang.
    const counter = createQueryCounter();
    for (let index = 0; index < QUERY_BUDGET; index += 1) {
      counter.record("SELECT * FROM products WHERE id = ?");
    }

    try {
      assertWithinBudget(counter);
      expect.unreachable("anggaran seharusnya terlampaui");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryBudgetExceeded);
      if (!(error instanceof QueryBudgetExceeded)) return;

      expect(error.total).toBe(QUERY_BUDGET);
      expect(error.budget).toBe(QUERY_BUDGET);
      // Pola berulangnya terlihat langsung dari pesannya.
      expect(error.queries).toHaveLength(QUERY_BUDGET);
      expect(new Set(error.queries).size).toBe(1);
    }
  });

  it("menerima anggaran khusus untuk uji yang lebih ketat", () => {
    const counter = createQueryCounter();
    counter.record("SELECT 1");

    expect(() => assertWithinBudget(counter, 5)).not.toThrow();
    expect(() => assertWithinBudget(counter, 1)).toThrow(QueryBudgetExceeded);
  });
});
