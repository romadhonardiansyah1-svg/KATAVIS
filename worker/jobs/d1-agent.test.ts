/**
 * Akses D1 untuk antrian Studio Agent.
 *
 * Berkas ini 0% tercakup sebelum ini. Yang diuji di sini adalah aturan yang
 * membuat rantai penyedia tetap benar saat agen gagal:
 *
 *   TC-SA-02 — agen tidak sehat: pekerjaan langsung ke Workers AI, bukan
 *              menunggu 45 detik lebih dulu.
 *   TC-SA-04 — sesi Chrome kehilangan status login: terdeteksi dan
 *              dilaporkan sebagai tidak sehat.
 *   TC-E2E-11 — agen menggantung melewati 45 detik: dibatalkan, pekerjaan
 *              kembali ke antrian, tidak ada layar yang membeku.
 *   TC-SA-06 — agen dimatikan di tengah pekerjaan: pekerjaan kembali ke
 *              antrian, tidak hilang.
 *
 * D1 nyata diuji `*.integration.test.ts` di workerd. Di sini yang diperiksa
 * adalah SQL dan pemetaan hasilnya — terutama syarat yang ADA DI DALAM
 * WHERE, karena syarat itu yang membuat dua laporan bersamaan tidak
 * sama-sama dianggap berhasil.
 */

import { describe, expect, it } from "vitest";

import {
  d1ClaimImageJobs,
  d1CompleteJob,
  d1FindJob,
  d1InsertJob,
  d1LatestHeartbeat,
  d1RetryJob,
  d1ReturnJobToQueue,
  d1UpsertHeartbeat,
} from "./d1-agent";

interface Recorded {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface Scripted {
  readonly first?: unknown;
  readonly all?: readonly unknown[];
  readonly changes?: number;
}

/**
 * Tiruan `D1Database` dengan jawaban berurutan.
 *
 * `d1ClaimImageJobs` menjalankan dua kueri berurutan (klaim, lalu kunci
 * foto), jadi jawabannya harus dapat ditentukan per pemanggilan — bukan
 * satu jawaban untuk seluruh tiruan.
 *
 * `bind()` tidak selalu dipanggil: `d1LatestHeartbeat` memakai kueri tanpa
 * parameter dan memanggil `first()` langsung dari hasil `prepare()`. Tiruan
 * yang hanya menyediakan `first()` di dalam `bind()` akan melewati kueri itu
 * dan menyembunyikan kesalahannya.
 */
function fakeD1(script: readonly Scripted[]): {
  readonly db: D1Database;
  readonly recorded: Recorded[];
} {
  const recorded: { sql: string; values: readonly unknown[] }[] = [];
  let cursor = 0;

  const db = {
    prepare(sql: string) {
      const response = script[cursor] ?? {};
      cursor += 1;

      const entry = { sql, values: [] as readonly unknown[] };
      recorded.push(entry);

      const statement = {
        bind(...values: readonly unknown[]) {
          entry.values = values;
          return statement;
        },
        async run() {
          return { meta: { changes: response.changes ?? 0 } };
        },
        async first() {
          return response.first ?? null;
        },
        async all() {
          return { results: [...(response.all ?? [])] };
        },
      };

      return statement;
    },
  } as unknown as D1Database;

  return { db, recorded };
}

describe("jobs/d1-agent — heartbeat", () => {
  it("menyimpan status kesehatan sebagai bilangan, bukan boolean", async () => {
    // TC-SA-04. Kolomnya INTEGER; boolean yang diteruskan apa adanya akan
    // tersimpan sebagai 0 atau 1 secara kebetulan, bukan karena aturan.
    const { db, recorded } = fakeD1([{}]);

    await d1UpsertHeartbeat(
      db,
      { agentId: "laptop-01", healthy: false, selectorsOk: true, chromeSessionOk: false },
      1_759_000_000_000,
    );

    expect(recorded[0]?.sql).toContain("INSERT INTO agent_heartbeats");
    expect(recorded[0]?.sql).toContain("ON CONFLICT(agent_id) DO UPDATE");
    expect(recorded[0]?.values).toEqual(["laptop-01", 0, 1, 0, 1_759_000_000_000]);
  });

  it("menandai agen sehat sebagai 1", async () => {
    const { db, recorded } = fakeD1([{}]);

    await d1UpsertHeartbeat(
      db,
      { agentId: "laptop-01", healthy: true, selectorsOk: true, chromeSessionOk: true },
      1,
    );

    expect(recorded[0]?.values).toEqual(["laptop-01", 1, 1, 1, 1]);
  });

  it("mengembalikan null saat belum ada agen yang melapor", async () => {
    // TC-SA-02. Inilah keadaan yang membuat rantai tidak menunggu Gemini:
    // tanpa heartbeat, tidak ada yang dapat ditunggu.
    const { db } = fakeD1([{ first: null }]);

    expect(await d1LatestHeartbeat(db)).toBeNull();
  });

  it("membaca heartbeat terbaru dari agen mana pun", async () => {
    const { db, recorded } = fakeD1([
      { first: { agent_id: "laptop-01", healthy: 1, last_seen_at: 1_759_000_000_000 } },
    ]);

    const heartbeat = await d1LatestHeartbeat(db);

    expect(heartbeat).toEqual({
      agentId: "laptop-01",
      lastSeenAt: 1_759_000_000_000,
      healthy: true,
    });
    expect(recorded[0]?.sql).toContain("ORDER BY last_seen_at DESC LIMIT 1");
  });

  it("memperlakukan healthy = 0 sebagai tidak sehat", async () => {
    const { db } = fakeD1([
      { first: { agent_id: "laptop-01", healthy: 0, last_seen_at: 1_759_000_000_000 } },
    ]);

    expect((await d1LatestHeartbeat(db))?.healthy).toBe(false);
  });
});

describe("jobs/d1-agent — antrian", () => {
  it("menyiapkan pekerjaan baru berstatus queued dengan attempt nol", async () => {
    const { db, recorded } = fakeD1([{}]);

    await d1InsertJob(
      db,
      { id: "01J8ZQFX9K7YWVTN3MABCDJ012", productId: "01J8ZQFX9K7YWVTN3MABCDP012", kind: "asr" },
      1_759_000_000_000,
    );

    expect(recorded[0]?.sql).toContain("'queued'");
    expect(recorded[0]?.sql).toContain("attempt");
    expect(recorded[0]?.values).toEqual([
      "01J8ZQFX9K7YWVTN3MABCDJ012",
      "01J8ZQFX9K7YWVTN3MABCDP012",
      "asr",
      1_759_000_000_000,
    ]);
  });

  it("mengambil pekerjaan gambar dan kunci foto aslinya dalam DUA kueri", async () => {
    // TC-E2E-11 / TC-PERF-04. Pola N+1 di sini terasa tepat saat antriannya
    // panjang — yaitu saat demo.
    const { db, recorded } = fakeD1([
      {
        all: [
          {
            id: "01J8ZQFX9K7YWVTN3MABCDJ012",
            product_id: "01J8ZQFX9K7YWVTN3MABCDP012",
            payload: JSON.stringify({ prompt: "tas kulit di atas meja kayu" }),
            deadline_at: 1_759_000_045_000,
          },
        ],
      },
      { all: [{ product_id: "01J8ZQFX9K7YWVTN3MABCDP012", r2_key: "products/p/foto-asli.jpg" }] },
    ]);

    const claimed = await d1ClaimImageJobs(
      db,
      {
        agentId: "laptop-01",
        max: 1,
        deadlineAt: 1_759_000_045_000,
        provider: "gemini_web",
      },
      1_759_000_000_000,
    );

    expect(recorded).toHaveLength(2);
    expect(claimed).toEqual([
      {
        id: "01J8ZQFX9K7YWVTN3MABCDJ012",
        productId: "01J8ZQFX9K7YWVTN3MABCDP012",
        sourceImageUrl: "products/p/foto-asli.jpg",
        prompt: "tas kulit di atas meja kayu",
        deadlineAt: 1_759_000_045_000,
      },
    ]);
  });

  it("menyimpan tenggat sebagai waktu absolut, bukan durasi", async () => {
    // Agen yang jamnya bergeser tetap tahu kapan harus berhenti.
    const { db, recorded } = fakeD1([{ all: [] }]);

    await d1ClaimImageJobs(
      db,
      { agentId: "laptop-01", max: 1, deadlineAt: 1_759_000_045_000, provider: "gemini_web" },
      1_759_000_000_000,
    );

    expect(recorded[0]?.values).toContain(1_759_000_045_000);
    expect(recorded[0]?.sql).toContain("status = 'queued'");
    expect(recorded[0]?.sql).toContain("RETURNING");
  });

  it("tidak menjalankan kueri kedua saat tidak ada pekerjaan yang diambil", async () => {
    const { db, recorded } = fakeD1([{ all: [] }]);

    const claimed = await d1ClaimImageJobs(
      db,
      { agentId: "laptop-01", max: 1, deadlineAt: 1, provider: "gemini_web" },
      1,
    );

    expect(claimed).toEqual([]);
    expect(recorded).toHaveLength(1);
  });

  it("memberi prompt kosong saat muatan bukan JSON, bukan menggagalkan klaim", async () => {
    // Muatan rusak tidak boleh menahan pekerjaan: agen tetap dapat bekerja,
    // dan kegagalannya akan terlihat di sana.
    const { db } = fakeD1([
      { all: [{ id: "j1", product_id: "p1", payload: "{bukan json", deadline_at: null }] },
      { all: [] },
    ]);

    const claimed = await d1ClaimImageJobs(
      db,
      { agentId: "laptop-01", max: 1, deadlineAt: 999, provider: "gemini_web" },
      1,
    );

    expect(claimed[0]?.prompt).toBe("");
    expect(claimed[0]?.deadlineAt).toBe(999);
  });

  it("memakai kunci foto pertama bila ada lebih dari satu", async () => {
    const { db } = fakeD1([
      { all: [{ id: "j1", product_id: "p1", payload: null, deadline_at: null }] },
      {
        all: [
          { product_id: "p1", r2_key: "products/p1/pertama.jpg" },
          { product_id: "p1", r2_key: "products/p1/kedua.jpg" },
        ],
      },
    ]);

    const claimed = await d1ClaimImageJobs(
      db,
      { agentId: "laptop-01", max: 1, deadlineAt: 1, provider: "gemini_web" },
      1,
    );

    expect(claimed[0]?.sourceImageUrl).toBe("products/p1/pertama.jpg");
  });
});

describe("jobs/d1-agent — penyelesaian dan pengembalian", () => {
  it("menandai selesai hanya bila pekerjaannya masih berjalan", async () => {
    const { db, recorded } = fakeD1([{ changes: 1 }]);

    expect(await d1CompleteJob(db, "j1", 1_759_000_030_000)).toBe(true);
    expect(recorded[0]?.sql).toContain("status = 'succeeded'");
    expect(recorded[0]?.sql).toContain("WHERE id = ? AND status = 'running'");
  });

  it("melaporkan gagal saat pekerjaan sudah tidak berjalan", async () => {
    const { db } = fakeD1([{ changes: 0 }]);

    expect(await d1CompleteJob(db, "j1", 1)).toBe(false);
  });

  it("mengembalikan pekerjaan ke antrian, bukan menandainya gagal", async () => {
    // TC-E2E-10 / TC-E2E-11. Status `failed` akan menghentikan pekerjaan
    // padahal penyedia cadangannya belum pernah dicoba. Kontrak API bagian 8
    // menyatakan pekerjaan kembali ke antrian dengan penanda kegagalan
    // Gemini, lalu consumer Workers AI mengambilnya.
    const { db, recorded } = fakeD1([
      { first: { payload: JSON.stringify({ prompt: "tas kulit" }) } },
      { changes: 1 },
    ]);

    const returned = await d1ReturnJobToQueue(
      db,
      "j1",
      { reason: "timeout 45 detik", fallbackProvider: "workers_ai" },
      1_759_000_045_000,
    );

    expect(returned).toBe(true);
    const update = recorded[1];
    expect(update?.sql).toContain("SET status = 'queued'");
    expect(update?.sql).toContain("error_code = 'IMAGE_GENERATE_FAILED'");
    expect(update?.sql).toContain("WHERE id = ? AND status = 'running'");

    const payload = JSON.parse(String(update?.values[1])) as Record<string, unknown>;
    expect(payload["prompt"]).toBe("tas kulit");
    expect(payload["geminiFailure"]).toBe("timeout 45 detik");
    expect(payload["failedAt"]).toBe(1_759_000_045_000);
    expect(update?.values[0]).toBe("workers_ai");
  });

  it("mengganti muatan lama yang bukan JSON, bukan membiarkannya menggagalkan", async () => {
    const { db, recorded } = fakeD1([{ first: { payload: "rusak" } }, { changes: 1 }]);

    await d1ReturnJobToQueue(db, "j1", { reason: "gagal", fallbackProvider: "workers_ai" }, 5);

    const payload = JSON.parse(String(recorded[1]?.values[1])) as Record<string, unknown>;
    expect(payload["geminiFailure"]).toBe("gagal");
  });

  it("tidak melakukan apa pun saat pekerjaannya tidak ada", async () => {
    // TC-SA-06. Pekerjaan yang sudah tidak ada bukan alasan melempar galat;
    // yang dilaporkan adalah bahwa pengembaliannya tidak terjadi.
    const { db, recorded } = fakeD1([{ first: null }]);

    const returned = await d1ReturnJobToQueue(db, "j1", { reason: "gagal", fallbackProvider: "workers_ai" }, 5);

    expect(returned).toBe(false);
    expect(recorded).toHaveLength(1);
  });

  it("mengembalikan pekerjaan gagal ke antrian untuk dicoba ulang", async () => {
    const { db, recorded } = fakeD1([{ changes: 1 }]);

    expect(await d1RetryJob(db, "j1")).toBe(true);
    expect(recorded[0]?.sql).toContain("status = 'queued'");
    expect(recorded[0]?.sql).not.toContain("attempt = attempt + 1");
    expect(recorded[0]?.sql).toContain("WHERE id = ? AND status IN ('failed', 'cancelled')");
  });

  it("menolak mengulang pekerjaan yang sedang berjalan", async () => {
    // Pekerjaan yang masih berjalan dipegang agen; mengulangnya berarti dua
    // agen mengerjakan pekerjaan yang sama.
    const { db } = fakeD1([{ changes: 0 }]);

    expect(await d1RetryJob(db, "j1")).toBe(false);
  });

  it("memuat pekerjaan lewat produknya, bukan lewat tabel pekerjaan saja", async () => {
    const { db, recorded } = fakeD1([
      { first: { product_id: "p1" } },
      {
        all: [
          {
            id: "j1",
            product_id: "p1",
            kind: "image",
            status: "running",
            provider: "gemini_web",
            locale: "id",
            attempt: 1,
            progress: 10,
            error_code: null,
            created_at: 1,
            started_at: 2,
            completed_at: null,
          },
        ],
      },
    ]);

    const found = await d1FindJob(db, "j1");

    expect(found?.id).toBe("j1");
    expect(recorded[1]?.sql).toContain("WHERE product_id = ?");
  });

  it("mengembalikan null saat pekerjaannya tidak ada", async () => {
    const { db } = fakeD1([{ first: null }]);

    expect(await d1FindJob(db, "j1")).toBeNull();
  });
});
