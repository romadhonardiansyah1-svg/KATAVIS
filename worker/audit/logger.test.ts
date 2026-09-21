/**
 * Kasus uji modul audit — TC-I-09 dan TC-I-10 pada tingkat keputusan.
 *
 * Yang diuji di sini adalah penerjemahan peran menjadi isi kolom
 * `on_behalf_of`, dan penolakan sebelum penulisan terjadi. Ganda `Db` adalah
 * antarmuka milik `worker/db`, bukan tiruan D1.
 *
 * Baris yang benar-benar tertulis diperiksa di `logger.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";

import type { Db, DbStatement } from "../db";

import { logActivity, resolveOnBehalfOf, type AuditActor } from "./logger";

const NOW_MS = 1_700_000_000_000;
const ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDE001";
const CAREGIVER_ID = "01J8ZQFX9K7YWVTN3MABCDE002";
const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDP001";

const artisan: AuditActor = { id: ARTISAN_ID, role: "artisan" };
const caregiver: AuditActor = { id: CAREGIVER_ID, role: "caregiver" };
const admin: AuditActor = { id: "01J8ZQFX9K7YWVTN3MABCDE003", role: "admin" };

const ENTITY = { type: "product", id: PRODUCT_ID };

interface FakeDb {
  readonly db: Db;
  readonly statements: DbStatement[];
}

function fakeDb(): FakeDb {
  const statements: DbStatement[] = [];

  return {
    statements,
    db: {
      async first<TValue>(statement: DbStatement): Promise<TValue | null> {
        statements.push(statement);
        return null;
      },
      async all<TValue>(statement: DbStatement): Promise<TValue[]> {
        statements.push(statement);
        return [];
      },
      async run(statement: DbStatement): Promise<void> {
        statements.push(statement);
      },
      async batch(
        batch: readonly DbStatement[],
      ): Promise<readonly (readonly unknown[])[]> {
        statements.push(...batch);
        return batch.map(() => []);
      },
    },
  };
}

describe("audit — on_behalf_of ditentukan oleh peran, bukan pemanggil", () => {
  it("mengisi on_behalf_of saat pendamping bertindak", () => {
    // TC-I-09
    expect(resolveOnBehalfOf(caregiver, ARTISAN_ID)).toEqual({
      ok: true,
      onBehalfOf: ARTISAN_ID,
    });
  });

  it("menolak pendamping yang bertindak tanpa menyebut pengrajinnya", () => {
    // Menulis baris dengan on_behalf_of kosong justru kesalahan yang
    // kolomnya ada untuk mencegah: karya pengrajin tampak dikerjakan
    // pendamping atas namanya sendiri.
    expect(resolveOnBehalfOf(caregiver, null)).toEqual({
      ok: false,
      reason: "CAREGIVER_WITHOUT_ARTISAN",
    });
    expect(resolveOnBehalfOf(caregiver, "   ")).toEqual({
      ok: false,
      reason: "CAREGIVER_WITHOUT_ARTISAN",
    });
  });

  it("mengosongkan on_behalf_of saat pengrajin bertindak sendiri", () => {
    // TC-I-10
    expect(resolveOnBehalfOf(artisan, null)).toEqual({ ok: true, onBehalfOf: null });
    expect(resolveOnBehalfOf(admin, null)).toEqual({ ok: true, onBehalfOf: null });
  });

  it("mengabaikan on_behalf_of yang dikirim untuk peran selain pendamping", () => {
    // Pengrajin yang bertindak atas namanya sendiri harus tercatat begitu.
    // Mengabaikan masukan yang salah lebih aman daripada mempercayainya:
    // catatan yang keliru lebih buruk daripada catatan yang kurang lengkap.
    expect(resolveOnBehalfOf(artisan, ARTISAN_ID)).toEqual({ ok: true, onBehalfOf: null });
    expect(resolveOnBehalfOf(admin, ARTISAN_ID)).toEqual({ ok: true, onBehalfOf: null });
    expect(resolveOnBehalfOf({ id: ARTISAN_ID, role: "wizard" }, ARTISAN_ID)).toEqual({
      ok: true,
      onBehalfOf: null,
    });
  });
});

describe("audit — penulisan", () => {
  it("menulis satu baris untuk aksi pengrajin", async () => {
    const fake = fakeDb();

    const result = await logActivity(
      fake.db,
      artisan,
      null,
      "publish_product",
      ENTITY,
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.onBehalfOf).toBeNull();
    expect(result.entry.actorId).toBe(ARTISAN_ID);
    expect(result.entry.createdAt).toBe(NOW_MS);

    // Modul ini hanya menulis: satu pernyataan, dan itu INSERT.
    expect(fake.statements).toHaveLength(1);
    expect(fake.statements[0]?.query).toContain("INSERT INTO activity_log");
    expect(fake.statements[0]?.params).toEqual([
      result.entry.id,
      ARTISAN_ID,
      null,
      "publish_product",
      "product",
      PRODUCT_ID,
      null,
      NOW_MS,
    ]);
  });

  it("menulis on_behalf_of saat pendamping bertindak", async () => {
    // TC-I-09
    const fake = fakeDb();

    const result = await logActivity(
      fake.db,
      caregiver,
      ARTISAN_ID,
      "patch_content",
      ENTITY,
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pelakunya pendamping, yang didampingi pengrajin — dua kolom berbeda.
    expect(result.entry.actorId).toBe(CAREGIVER_ID);
    expect(result.entry.onBehalfOf).toBe(ARTISAN_ID);
    expect(fake.statements[0]?.params[2]).toBe(ARTISAN_ID);
  });

  it("tidak menulis apa pun saat pendamping tidak menyebut pengrajinnya", async () => {
    const fake = fakeDb();

    const result = await logActivity(
      fake.db,
      caregiver,
      null,
      "patch_content",
      ENTITY,
      NOW_MS,
    );

    expect(result).toEqual({ ok: false, reason: "CAREGIVER_WITHOUT_ARTISAN" });
    expect(fake.statements).toEqual([]);
  });

  it.each([
    [{ id: "", role: "artisan" }, "publish_product", ENTITY, "INVALID_ACTOR"],
    [artisan, "", ENTITY, "INVALID_ACTION"],
    [artisan, "   ", ENTITY, "INVALID_ACTION"],
    [artisan, "publish_product", { type: "", id: PRODUCT_ID }, "INVALID_ENTITY"],
    [artisan, "publish_product", { type: "product", id: "" }, "INVALID_ENTITY"],
  ])("menolak catatan yang tidak lengkap", async (actor, action, entity, reason) => {
    const fake = fakeDb();

    const result = await logActivity(fake.db, actor, null, action, entity, NOW_MS);

    expect(result).toEqual({ ok: false, reason });
    // Baris dengan tindakan kosong tidak berguna untuk audit; lebih baik
    // ditolak di sini daripada ditemukan setahun kemudian.
    expect(fake.statements).toEqual([]);
  });

  it("menyimpan metadata sebagai JSON, dan null bila tidak ada", async () => {
    const fake = fakeDb();

    await logActivity(fake.db, artisan, null, "patch_content", ENTITY, NOW_MS, {
      fields: ["name", "story"],
    });
    await logActivity(fake.db, artisan, null, "publish_product", ENTITY, NOW_MS);

    expect(fake.statements[0]?.params[6]).toBe('{"fields":["name","story"]}');
    expect(fake.statements[1]?.params[6]).toBeNull();
  });

  it("memakai satu kueri untuk setiap catatan", async () => {
    // Anggaran 25 kueri per invocation berlaku untuk rute, dan audit
    // menambah satu kueri pada setiap aksi yang dicatat.
    const fake = fakeDb();

    await logActivity(fake.db, artisan, null, "publish_product", ENTITY, NOW_MS);

    expect(fake.statements).toHaveLength(1);
    expect(fake.statements[0]?.query).not.toContain("SELECT");
  });
});
