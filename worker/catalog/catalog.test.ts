/**
 * Kasus uji modul catalog — logika murni dan bentuk kueri.
 *
 * Ganda `Db` di sini adalah antarmuka milik `worker/db` sendiri, bukan
 * tiruan D1. Yang diuji adalah keputusan yang diambil sebelum kueri
 * dijalankan — transisi status mana yang sah, gerbang mana yang menolak,
 * pernyataan seperti apa yang disusun — dan itu dapat diperiksa tanpa basis
 * data.
 *
 * Perilaku terhadap D1 sungguhan ada di `catalog.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";

import type { Db, DbStatement } from "../db";
import type { Actor } from "../rbac";

import { isContentComplete, parseContentPatch, patchContent } from "./content";
import { NO_CONSENT, hasConsent, loadConsents, requireConsent, setConsent } from "./consent";
import {
  PRODUCT_STATUS_TRANSITIONS,
  canTransition,
  createProduct,
  deleteProduct,
  requestGeneration,
} from "./products";
import {
  requireReviewedTranscript,
  storeAsrTranscript,
  submitTranscript,
} from "./transcript";

const NOW_MS = 1_700_000_000_000;
const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDP001";
const ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDE001";
const CAREGIVER_ID = "01J8ZQFX9K7YWVTN3MABCDE002";
const IDEMPOTENCY_KEY = "01J8ZQFX9K7YWVTN3MABCDK001";

const artisan: Actor = {
  id: ARTISAN_ID,
  role: "artisan",
  sessionTokenVersion: 0,
  currentTokenVersion: 0,
};

const caregiver: Actor = {
  id: CAREGIVER_ID,
  role: "caregiver",
  sessionTokenVersion: 0,
  currentTokenVersion: 0,
};

const PRODUCT_ROW = {
  id: PRODUCT_ID,
  artisan_id: ARTISAN_ID,
  status: "draft",
  slug: null,
  progress: 0,
};

interface RecordedStatement {
  readonly query: string;
  readonly params: readonly unknown[];
}

interface FakeDb {
  readonly db: Db;
  readonly singles: RecordedStatement[];
  readonly batches: (readonly DbStatement[])[];
}

/**
 * Ganda `Db` yang menjawab menurut isi kuerinya.
 *
 * Routing per kueri, bukan antrean berurutan: satu fungsi seperti
 * `publishProduct` membaca tiga tabel berbeda, dan antrean akan membuat uji
 * bergantung pada urutan pembacaan — tepat pada hal yang tidak sedang diuji.
 */
function fakeDb(
  respond: {
    readonly first?: (query: string) => unknown;
    readonly all?: (query: string) => readonly unknown[];
    readonly batch?: (
      statements: readonly DbStatement[],
    ) => readonly (readonly unknown[])[];
  } = {},
): FakeDb {
  const singles: RecordedStatement[] = [];
  const batches: (readonly DbStatement[])[] = [];

  return {
    singles,
    batches,
    db: {
      async first<TValue>(statement: DbStatement): Promise<TValue | null> {
        singles.push(statement);
        return (respond.first?.(statement.query) ?? null) as TValue | null;
      },
      async all<TValue>(statement: DbStatement): Promise<TValue[]> {
        singles.push(statement);
        return [...(respond.all?.(statement.query) ?? [])] as TValue[];
      },
      async run(statement: DbStatement): Promise<void> {
        singles.push(statement);
      },
      async batch(
        statements: readonly DbStatement[],
      ): Promise<readonly (readonly unknown[])[]> {
        batches.push(statements);
        return respond.batch?.(statements) ?? statements.map(() => []);
      },
    },
  };
}

function statementsContaining(fake: FakeDb, fragment: string): DbStatement[] {
  return fake.batches.flat().filter((statement) => statement.query.includes(fragment));
}

describe("catalog — transisi status produk", () => {
  it("hanya maju, satu langkah demi satu langkah", () => {
    expect(canTransition("draft", "processing")).toBe(true);
    expect(canTransition("processing", "review")).toBe(true);
    expect(canTransition("review", "published")).toBe(true);
    expect(canTransition("published", "archived")).toBe(true);
  });

  it.each([
    ["processing", "draft"],
    ["review", "processing"],
    ["published", "review"],
    ["archived", "published"],
    ["published", "draft"],
    ["draft", "published"],
    ["draft", "review"],
    ["processing", "published"],
  ] as const)("menolak %s ke %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("menjadikan archived sebagai keadaan akhir", () => {
    expect(PRODUCT_STATUS_TRANSITIONS.archived).toEqual([]);
    for (const target of ["draft", "processing", "review", "published"] as const) {
      expect(canTransition("archived", target)).toBe(false);
    }
  });

  it("tidak pernah mengizinkan status menuju dirinya sendiri", () => {
    for (const status of Object.keys(PRODUCT_STATUS_TRANSITIONS) as (
      keyof typeof PRODUCT_STATUS_TRANSITIONS
    )[]) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe("catalog — pembuatan produk", () => {
  it("menolak permintaan tanpa Idempotency-Key yang sah", async () => {
    const fake = fakeDb();

    for (const key of [null, "", "bukan-ulid", "01j8zqfx9k7ywvtn3mabcdk001"]) {
      const result = await createProduct(fake.db, ARTISAN_ID, key, NOW_MS);
      expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    }

    // Tidak ada kueri sama sekali: kunci yang tidak sah tidak perlu
    // ditanyakan ke basis data.
    expect(fake.singles).toEqual([]);
  });

  it("membuat produk dan menyimpan kuncinya dalam satu putaran", async () => {
    const fake = fakeDb({ first: () => null });

    const result = await createProduct(fake.db, ARTISAN_ID, IDEMPOTENCY_KEY, NOW_MS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replayed).toBe(false);
    expect(result.product.status).toBe("draft");
    expect(result.product.progress).toBe(0);

    // Produk dan kuncinya harus lahir bersama: produk tanpa kunci akan
    // dibuat dua kali saat jaringan buruk.
    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(2);
    expect(fake.batches[0]?.[0]?.query).toContain("INSERT INTO products");
    expect(fake.batches[0]?.[1]?.query).toContain("INSERT INTO idempotency_keys");
  });

  it("mengembalikan respons pertama untuk kunci yang sama", async () => {
    const stored = {
      id: PRODUCT_ID,
      status: "draft",
      progress: 0,
      createdAt: NOW_MS - 1000,
    };
    const fake = fakeDb({ first: () => ({ response_body: JSON.stringify(stored), created_at: NOW_MS - 1000 }) });

    const result = await createProduct(fake.db, ARTISAN_ID, IDEMPOTENCY_KEY, NOW_MS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replayed).toBe(true);
    expect(result.product).toEqual(stored);
    // Tidak ada penulisan baru.
    expect(fake.batches).toEqual([]);
  });

  it("membuat produk baru bila kuncinya sudah lewat 24 jam", async () => {
    const stored = { id: PRODUCT_ID, status: "draft", progress: 0, createdAt: NOW_MS };
    const stale = NOW_MS - 24 * 60 * 60 * 1000 - 1;
    const fake = fakeDb({
      first: () => ({ response_body: JSON.stringify(stored), created_at: stale }),
    });

    const result = await createProduct(fake.db, ARTISAN_ID, IDEMPOTENCY_KEY, NOW_MS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replayed).toBe(false);
    expect(fake.batches).toHaveLength(1);
  });

  it("mencari kunci bersama user_id, bukan hanya kuncinya", async () => {
    // Tanpa syarat user_id, pengguna yang menebak kunci milik orang lain
    // akan menerima isi respons pertama orang tersebut.
    const fake = fakeDb({ first: () => null });
    await createProduct(fake.db, ARTISAN_ID, IDEMPOTENCY_KEY, NOW_MS);

    const lookup = fake.singles[0];
    expect(lookup?.query).toContain("user_id = ?");
    expect(lookup?.params).toEqual([IDEMPOTENCY_KEY, ARTISAN_ID]);
  });
});

describe("catalog — permintaan pemrosesan", () => {
  function generationDb(transcriptReviewed: boolean): FakeDb {
    return fakeDb({
      first: (query) => {
        if (query.includes("FROM products")) return PRODUCT_ROW;
        if (query.includes("FROM transcripts")) {
          return {
            text: "Saya membuat tas dari kulit kerbau.",
            locale: "id",
            reviewed: transcriptReviewed ? 1 : 0,
            edited: 0,
            provider: "groq",
            duration_ms: 28_400,
          };
        }
        return null;
      },
    });
  }

  it("menolak pemrosesan sebelum transkrip ditinjau", async () => {
    // Gerbang ADR-008. Satu nama produk yang salah dengar akan muncul di
    // cerita, spesifikasi, caption, kata kunci, dan lima bahasa terjemahan.
    const fake = generationDb(false);

    const result = await requestGeneration(
      fake.db,
      artisan,
      PRODUCT_ID,
      { tasks: ["copy"], locales: ["id"] },
      NOW_MS,
    );

    expect(result).toEqual({ ok: false, code: "TRANSCRIPT_NOT_REVIEWED" });
    // Tidak ada pekerjaan yang dibuat: penolakan terjadi sebelum penulisan.
    expect(fake.batches).toEqual([]);
  });

  it("menerima pemrosesan setelah transkrip ditinjau", async () => {
    const fake = generationDb(true);

    const result = await requestGeneration(
      fake.db,
      artisan,
      PRODUCT_ID,
      { tasks: ["copy"], locales: ["id"] },
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.kind).toBe("copy");
  });

  it("memisahkan pekerjaan per bahasa, dan hanya satu pekerjaan gambar", async () => {
    // F1-07: kegagalan satu bahasa tidak menggagalkan bahasa lain. Pekerjaan
    // gambar tidak per bahasa — satu foto melayani semuanya.
    const fake = generationDb(true);

    const result = await requestGeneration(
      fake.db,
      artisan,
      PRODUCT_ID,
      { tasks: ["copy", "image", "tts"], locales: ["id", "en"] },
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs.map((job) => job.kind)).toEqual([
      "copy",
      "copy",
      "image",
      "tts",
      "tts",
    ]);

    const inserts = statementsContaining(fake, "INSERT INTO jobs");
    expect(inserts.map((statement) => statement.params[3])).toEqual([
      "id",
      "en",
      null,
      "id",
      "en",
    ]);
  });

  it("memakai prompt eksplisit pengrajin apa adanya untuk pekerjaan gambar", async () => {
    // F2-12: pilihan eksplisit tidak ditimpa server.
    const fake = generationDb(true);

    const result = await requestGeneration(
      fake.db,
      artisan,
      PRODUCT_ID,
      {
        tasks: ["image"],
        locales: ["id"],
        imageStyle: "wood_warm",
        imagePrompt: "Foto produk di atas meja kayu jati yang hangat",
      },
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    const inserts = statementsContaining(fake, "INSERT INTO jobs");
    expect(inserts).toHaveLength(1);
    const payload = JSON.parse(inserts[0]?.params[4] as string) as {
      style: string;
      prompt: string;
    };
    expect(payload.style).toBe("wood_warm");
    expect(payload.prompt).toBe("Foto produk di atas meja kayu jati yang hangat");
  });

  it("menyusun prompt otomatis dari transkrip bila tidak ada prompt eksplisit", async () => {
    // F2-10: prompt menyesuaikan produk.
    const fake = generationDb(true);

    const result = await requestGeneration(
      fake.db,
      artisan,
      PRODUCT_ID,
      { tasks: ["image"], locales: ["id"], imageStyle: "dark_gradient" },
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    const inserts = statementsContaining(fake, "INSERT INTO jobs");
    const payload = JSON.parse(inserts[0]?.params[4] as string) as {
      style: string;
      prompt: string;
    };
    expect(payload.style).toBe("dark_gradient");
    expect(payload.prompt).toContain("kulit kerbau");
    // Prompt server adalah arah kreatif murni; bingkai "edit lampiran" dan
    // aturan pelestarian ditambahkan agen (satu sumber, anti prompt ganda).
    expect(payload.prompt).not.toContain("saya lampirkan");
    expect(payload.prompt).not.toContain("SATU-SATUNYA objek");
  });

  it("memajukan draft menjadi processing dalam putaran yang sama", async () => {
    const fake = generationDb(true);

    await requestGeneration(
      fake.db,
      artisan,
      PRODUCT_ID,
      { tasks: ["image"], locales: ["id"] },
      NOW_MS,
    );

    const updates = statementsContaining(fake, "UPDATE products");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.query).toContain("status = 'processing'");
    // Satu putaran untuk seluruh pekerjaan dan perubahan status.
    expect(fake.batches).toHaveLength(1);
  });

  it("menolak pendamping yang tautannya sudah dicabut", async () => {
    const fake = fakeDb({
      first: (query) => {
        if (query.includes("FROM products")) return PRODUCT_ROW;
        if (query.includes("FROM caregiver_links")) {
          return {
            id: "01J8ZQFX9K7YWVTN3MABCD1001",
            artisan_id: ARTISAN_ID,
            caregiver_id: CAREGIVER_ID,
            permissions: '["edit_draft"]',
            status: "revoked",
            expires_at: NOW_MS + 60_000,
          };
        }
        return null;
      },
    });

    const result = await requestGeneration(
      fake.db,
      caregiver,
      PRODUCT_ID,
      { tasks: ["copy"], locales: ["id"] },
      NOW_MS,
    );

    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("menolak muatan yang tidak sesuai skema", async () => {
    const fake = generationDb(true);

    for (const input of [
      { tasks: [], locales: ["id"] },
      { tasks: ["video"], locales: ["id"] },
      { tasks: ["copy"], locales: [] },
      { tasks: ["copy"], locales: ["id", "en", "ja", "zh", "ar", "id"] },
    ]) {
      const result = await requestGeneration(fake.db, artisan, PRODUCT_ID, input, NOW_MS);
      expect(result.ok).toBe(false);
    }
  });
});

describe("catalog — penghapusan produk", () => {
  it("menolak penghapusan tanpa konfirmasi", async () => {
    const fake = fakeDb();

    expect(await deleteProduct(fake.db, artisan, PRODUCT_ID, false)).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(fake.singles).toEqual([]);
  });

  it("menolak penghapusan produk milik pengrajin lain", async () => {
    const fake = fakeDb({ first: () => ({ ...PRODUCT_ROW, artisan_id: "01J8ZQFX9K7YWVTN3MABCDE009" }) });

    expect(await deleteProduct(fake.db, artisan, PRODUCT_ID, true)).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(fake.singles.some((statement) => statement.query.includes("DELETE"))).toBe(false);
  });

  it("menghapus produk milik sendiri", async () => {
    const fake = fakeDb({ first: () => PRODUCT_ROW });

    expect(await deleteProduct(fake.db, artisan, PRODUCT_ID, true)).toEqual({ ok: true });
    // Baris anak ikut terhapus lewat ON DELETE CASCADE di migrations/0001.
    expect(fake.singles.some((statement) => statement.query.includes("DELETE FROM products"))).toBe(
      true,
    );
  });
});

describe("catalog — konten per bahasa", () => {
  it("menolak suntingan kosong", () => {
    // Muatan kosong tidak mengubah apa pun tetapi tetap akan menaikkan
    // updated_at dan mengubah source menjadi ai_edited.
    expect(parseContentPatch({})).toEqual({ ok: false, code: "CONTENT_INCOMPLETE" });
    expect(parseContentPatch({ name: "" }).ok).toBe(false);
    expect(parseContentPatch({ name: "a".repeat(121) }).ok).toBe(false);
    expect(parseContentPatch({ specs: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"] }).ok).toBe(false);
  });

  it("menerima sebagian bidang", () => {
    const result = parseContentPatch({ name: "Tas Kulit Nusantara" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.name).toBe("Tas Kulit Nusantara");
  });

  it("menilai kelengkapan dari nama dan cerita", () => {
    expect(isContentComplete({ name: "Tas", story: "Cerita" })).toBe(true);
    expect(isContentComplete({ name: "Tas", story: "   " })).toBe(false);
    expect(isContentComplete({ name: null, story: "Cerita" })).toBe(false);
    expect(isContentComplete({ name: "Tas" })).toBe(false);
    expect(isContentComplete(null)).toBe(false);
  });

  it("selalu menandai sumber sebagai ai_edited", async () => {
    const fake = fakeDb();

    await patchContent(fake.db, PRODUCT_ID, "id", { name: "Tas" }, NOW_MS);

    const statement = fake.singles[0];
    expect(statement?.query).toContain("'ai_edited'");
    // Dua kali: sekali pada INSERT, sekali pada cabang ON CONFLICT.
    expect(statement?.query.match(/'ai_edited'/g)).toHaveLength(2);
  });

  it("mempertahankan bidang yang tidak dikirim", async () => {
    const fake = fakeDb();

    await patchContent(fake.db, PRODUCT_ID, "id", { name: "Tas" }, NOW_MS);

    const statement = fake.singles[0];
    // COALESCE adalah yang membuat "hanya yang dikirim diperbarui" berlaku.
    // Tanpa itu, menyunting nama akan menghapus cerita.
    for (const column of ["name", "story", "specs", "social_copy", "seo_keywords"]) {
      expect(statement?.query).toContain(
        `${column} = COALESCE(excluded.${column}, product_content.${column})`,
      );
    }

    // Bidang yang tidak dikirim masuk sebagai null, bukan sebagai string kosong.
    // Indeks 0 adalah id baris, yang diisi ULID baru setiap kali.
    expect(statement?.params.slice(1)).toEqual([
      PRODUCT_ID,
      "id",
      "Tas",
      null,
      null,
      null,
      null,
      NOW_MS,
    ]);
  });

  it("menyimpan larik sebagai JSON dan membedakan kosong dari tidak dikirim", async () => {
    const fake = fakeDb();

    await patchContent(fake.db, PRODUCT_ID, "id", { specs: [] }, NOW_MS);
    await patchContent(fake.db, PRODUCT_ID, "id", { name: "Tas" }, NOW_MS);

    // Disaring menurut pernyataannya, bukan menurut urutan: setiap
    // penyuntingan juga membaca kembali barisnya.
    const inserts = fake.singles.filter((statement) =>
      statement.query.includes("INSERT INTO product_content"),
    );
    // Larik kosong tetap tersimpan sebagai "[]", sedangkan bidang yang tidak
    // dikirim menjadi null — dan null itulah yang mempertahankan nilai lama
    // lewat COALESCE.
    expect(inserts[0]?.params[5]).toBe("[]");
    expect(inserts[1]?.params[5]).toBeNull();
  });
});

describe("catalog — transkrip", () => {
  it("menyimpan hasil ASR dengan reviewed = 0", async () => {
    const fake = fakeDb();

    await storeAsrTranscript(
      fake.db,
      PRODUCT_ID,
      { text: "Saya membuat tas.", locale: "id", provider: "groq", durationMs: 28_400 },
      NOW_MS,
    );

    const statement = fake.singles[0];
    expect(statement?.query).toContain("0, 0");
    // Merekam ulang menghasilkan teks baru yang belum pernah dibaca siapa pun.
    expect(statement?.query).toContain("reviewed = 0");
    expect(statement?.query).toContain("edited = 0");
    expect(statement?.query).toContain("reviewed_at = NULL");
  });

  it("menyalakan reviewed saat pengrajin menyetujuinya", async () => {
    const fake = fakeDb({
      first: () => ({
        text: "Saya membuat tas.",
        locale: "id",
        reviewed: 0,
        edited: 0,
        provider: "groq",
        duration_ms: 28_400,
      }),
    });

    const result = await submitTranscript(fake.db, PRODUCT_ID, "Saya membuat tas.", NOW_MS);

    expect(result.ok).toBe(true);
    const update = fake.singles.find((statement) => statement.query.includes("UPDATE transcripts"));
    expect(update?.query).toContain("reviewed = 1");
    // params: [teks, edited, reviewed_at, product_id]
    expect(update?.params[0]).toBe("Saya membuat tas.");
    // Teksnya tidak berubah, jadi edited tetap 0.
    expect(update?.params[1]).toBe(0);
    expect(update?.params[3]).toBe(PRODUCT_ID);
  });

  it("menandai edited begitu teksnya disentuh manusia, dan tidak memadamkannya", async () => {
    const fake = fakeDb({
      first: () => ({
        text: "Tas dari kulit kerbau.",
        locale: "id",
        reviewed: 0,
        edited: 1,
        provider: "groq",
        duration_ms: 28_400,
      }),
    });

    await submitTranscript(fake.db, PRODUCT_ID, "Tas dari kulit kerbau.", NOW_MS);

    const update = fake.singles.find((statement) => statement.query.includes("UPDATE transcripts"));
    // Teks sama dengan yang tersimpan, tetapi penanda edited tetap menyala:
    // yang ditandai adalah "pernah disentuh manusia".
    expect(update?.params[1]).toBe(1);
  });

  it("membuat transkrip baru bertanda manual jika pengrajin mengetik langsung", async () => {
    let called = 0;
    const fake = fakeDb({
      first: () => {
        called++;
        if (called === 1) return null;
        return {
          text: "Teks langsung",
          locale: "id",
          reviewed: 1,
          edited: 1,
          provider: "manual",
          duration_ms: 0,
        };
      },
    });

    const result = await submitTranscript(fake.db, PRODUCT_ID, "Teks langsung", NOW_MS);
    expect(result.ok).toBe(true);
    const insert = fake.singles.find((stmt) => stmt.query.includes("INSERT INTO transcripts"));
    expect(insert).toBeDefined();
  });

  it.each([
    [{ reviewed: 0 }, "TRANSCRIPT_NOT_REVIEWED"],
    [{ reviewed: 1 }, null],
  ])("gerbang ADR-008 untuk reviewed=%o", async (row, expected) => {
    const fake = fakeDb({
      first: () => ({
        text: "Saya membuat tas.",
        locale: "id",
        edited: 0,
        provider: "groq",
        duration_ms: 28_400,
        ...row,
      }),
    });

    expect(await requireReviewedTranscript(fake.db, PRODUCT_ID)).toBe(expected);
  });

  it("memperlakukan transkrip yang tidak ada sebagai belum ditinjau", async () => {
    // Jalur "belum ada datanya" adalah tempat gerbang yang gagal-terbuka
    // paling mudah lolos.
    const fake = fakeDb({ first: () => null });

    expect(await requireReviewedTranscript(fake.db, PRODUCT_ID)).toBe("TRANSCRIPT_NOT_REVIEWED");
  });
});

describe("catalog — persetujuan", () => {
  it("mati secara bawaan", () => {
    expect(hasConsent(NO_CONSENT, "audio_processing")).toBe(false);
    expect(hasConsent(NO_CONSENT, "publication")).toBe(false);
  });

  it("membaca kedua persetujuan dalam satu kueri", async () => {
    const fake = fakeDb({
      all: () => [
        { kind: "audio_processing", granted: 1 },
        { kind: "publication", granted: 0 },
      ],
    });

    const state = await loadConsents(fake.db, ARTISAN_ID);

    expect(state).toEqual({ audioProcessing: true, publication: false });
    expect(fake.singles).toHaveLength(1);
  });

  it("menganggap baris yang belum ada sebagai belum disetujui", async () => {
    const fake = fakeDb({ all: () => [] });

    expect(await loadConsents(fake.db, ARTISAN_ID)).toEqual(NO_CONSENT);
  });

  it("menolak dengan CONSENT_REQUIRED selama persetujuannya belum ada", async () => {
    const fake = fakeDb({ all: () => [] });

    expect(await requireConsent(fake.db, ARTISAN_ID, "audio_processing")).toBe(
      "CONSENT_REQUIRED",
    );
    expect(await requireConsent(fake.db, ARTISAN_ID, "publication")).toBe("CONSENT_REQUIRED");
  });

  it("mengembalikan null saat persetujuannya sudah ada", async () => {
    const fake = fakeDb({ all: () => [{ kind: "publication", granted: 1 }] });

    expect(await requireConsent(fake.db, ARTISAN_ID, "publication")).toBeNull();
    expect(await requireConsent(fake.db, ARTISAN_ID, "audio_processing")).toBe(
      "CONSENT_REQUIRED",
    );
  });

  it("menyimpan persetujuan sebagai upsert pada pasangan user dan jenis", async () => {
    const fake = fakeDb({ all: () => [{ kind: "publication", granted: 1 }] });

    const result = await setConsent(
      fake.db,
      ARTISAN_ID,
      { kind: "publication", granted: true },
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    const insert = fake.singles[0];
    expect(insert?.query).toContain("ON CONFLICT(user_id, kind)");
    // granted_at terisi saat disetujui, revoked_at dikosongkan.
    expect(insert?.params[3]).toBe(1);
    expect(insert?.params[4]).toBe(NOW_MS);
    expect(insert?.params[5]).toBeNull();
  });

  it("mencatat waktu pencabutan, bukan menghapus barisnya", async () => {
    const fake = fakeDb({ all: () => [{ kind: "publication", granted: 0 }] });

    await setConsent(fake.db, ARTISAN_ID, { kind: "publication", granted: false }, NOW_MS);

    const insert = fake.singles[0];
    expect(insert?.params[3]).toBe(0);
    expect(insert?.params[4]).toBeNull();
    expect(insert?.params[5]).toBe(NOW_MS);
  });
});
