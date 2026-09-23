/**
 * Akses D1 untuk pekerjaan AI — pemetaan baris dan kemajuan.
 *
 * TC-PERF-04 — polling setiap 2 detik harus tetap satu kueri. Batas D1 paket
 *              gratis adalah 50 kueri per invocation (ADR-006), dan polling
 *              yang mahal menghabiskannya justru saat demo berlangsung.
 * TC-I-08    — pekerjaan masuk antrian dan dikonsumsi; status serta
 *              hasilnya terbaca kembali dengan bentuk yang benar.
 */

import { describe, expect, it } from "vitest";

import { d1ListJobs, overallProgress, type JobRecord } from "./d1-jobs";

interface Recorded {
  readonly sql: string;
  readonly values: readonly unknown[];
}

function fakeD1(rows: readonly unknown[]): { readonly db: D1Database; readonly recorded: Recorded[] } {
  const recorded: Recorded[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: readonly unknown[]) {
          recorded.push({ sql, values });
          return {
            async all() {
              return { results: [...rows] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, recorded };
}

const JOB_ROW = {
  id: "01J8ZQFX9K7YWVTN3MABCDJ012",
  product_id: "01J8ZQFX9K7YWVTN3MABCDP012",
  kind: "image",
  status: "running",
  provider: "gemini_web",
  locale: "id",
  attempt: 1,
  progress: 45,
  error_code: null,
  created_at: 1_759_000_000_000,
  started_at: 1_759_000_001_000,
  completed_at: null,
};

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "01J8ZQFX9K7YWVTN3MABCDJ012",
    productId: "01J8ZQFX9K7YWVTN3MABCDP012",
    kind: "image",
    status: "running",
    provider: "gemini_web",
    locale: "id",
    attempt: 1,
    progress: 45,
    errorCode: null,
    createdAt: 1_759_000_000_000,
    startedAt: 1_759_000_001_000,
    completedAt: null,
    ...overrides,
  };
}

describe("jobs/d1-jobs — d1ListJobs", () => {
  it("memetakan kolom snake_case ke bentuk yang dipakai antarmuka", async () => {
    // TC-I-08. Bentuk inilah yang dikirim ke `GET /products/:id/jobs` dan
    // yang dibaca bilah kemajuan di layar proses.
    const { db } = fakeD1([JOB_ROW]);

    const jobs = await d1ListJobs(db, "01J8ZQFX9K7YWVTN3MABCDP012");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      id: JOB_ROW.id,
      productId: JOB_ROW.product_id,
      kind: "image",
      status: "running",
      provider: "gemini_web",
      locale: "id",
      attempt: 1,
      progress: 45,
      errorCode: null,
      createdAt: JOB_ROW.created_at,
      startedAt: JOB_ROW.started_at,
      completedAt: null,
    });
  });

  it("memakai SATU kueri untuk seluruh pekerjaan produk", async () => {
    // TC-PERF-04. Satu kueri per pekerjaan akan menembus batas 50 kueri
    // begitu satu produk punya banyak tahap.
    const { db, recorded } = fakeD1([JOB_ROW, JOB_ROW, JOB_ROW]);

    await d1ListJobs(db, "01J8ZQFX9K7YWVTN3MABCDP012");

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.sql).toContain("WHERE product_id = ?");
    expect(recorded[0]?.sql).toContain("ORDER BY created_at DESC");
  });

  it("mengembalikan larik kosong saat produk belum punya pekerjaan", async () => {
    const { db } = fakeD1([]);

    expect(await d1ListJobs(db, "01J8ZQFX9K7YWVTN3MABCDP012")).toEqual([]);
  });

  it("meneruskan locale null apa adanya", async () => {
    // Pekerjaan ASR tidak punya bahasa: rekaman pengrajin satu bahasa.
    const { db } = fakeD1([{ ...JOB_ROW, locale: null, kind: "asr" }]);

    const jobs = await d1ListJobs(db, "01J8ZQFX9K7YWVTN3MABCDP012");

    expect(jobs[0]?.locale).toBeNull();
    expect(jobs[0]?.kind).toBe("asr");
  });
});

describe("jobs/d1-jobs — overallProgress", () => {
  it("nol saat belum ada pekerjaan", () => {
    // Layar proses menampilkan 0%, bukan NaN.
    expect(overallProgress([])).toBe(0);
  });

  it("merata-ratakan kemajuan seluruh pekerjaan", () => {
    const jobs = [job({ progress: 100 }), job({ progress: 50 })];

    expect(overallProgress(jobs)).toBe(75);
  });

  it("menghitung pekerjaan gagal sebagai selesai", () => {
    // Pekerjaan yang gagal tidak akan maju lagi. Menahannya di bawah seratus
    // akan membuat bilah kemajuan berhenti selamanya pada pekerjaan yang
    // sudah tidak berjalan — dan pengrajin menunggu sesuatu yang tidak
    // akan terjadi.
    const jobs = [job({ status: "failed", progress: 20 }), job({ status: "succeeded", progress: 100 })];

    expect(overallProgress(jobs)).toBe(100);
  });

  it("membulatkan ke bilangan bulat terdekat", () => {
    // Persentase pecahan tidak dapat ditampilkan pada bilah kemajuan.
    const jobs = [job({ progress: 33 }), job({ progress: 33 }), job({ progress: 33 })];

    expect(overallProgress(jobs)).toBe(33);
  });
});
