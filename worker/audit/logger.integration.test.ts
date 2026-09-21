/**
 * Uji integrasi modul audit — TC-I-09 dan TC-I-10.
 *
 * Dijalankan di workerd dengan D1 Miniflare yang sesungguhnya. Yang diuji di
 * sini hanya dapat diuji di sini: apakah barisnya benar-benar tertulis, dan
 * apakah `on_behalf_of` benar-benar NULL — bukan string kosong — saat
 * pengrajin bertindak sendiri. Perbedaan antara NULL dan `''` tidak terlihat
 * pada ganda, dan justru itulah yang membedakan catatan yang dapat
 * ditanyakan dari yang tidak.
 *
 * Dijalankan dengan: pnpm run test:integration
 */

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createDb, createQueryCounter } from "../db";

import { logActivity, type AuditActor } from "./logger";

const NOW_MS = 1_700_000_000_000;

const ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDE301";
const CAREGIVER_ID = "01J8ZQFX9K7YWVTN3MABCDE302";
const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDP301";

const artisan: AuditActor = { id: ARTISAN_ID, role: "artisan" };
const caregiver: AuditActor = { id: CAREGIVER_ID, role: "caregiver" };

const counter = createQueryCounter();
const db = createDb(env.DB, counter);

interface ActivityRow {
  readonly actor_id: string;
  readonly on_behalf_of: string | null;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly metadata: string | null;
}

async function entriesFor(entityId: string): Promise<readonly ActivityRow[]> {
  const rows = await env.DB.prepare(
    `SELECT actor_id, on_behalf_of, action, entity_type, entity_id, metadata
     FROM activity_log WHERE entity_id = ? ORDER BY created_at`,
  )
    .bind(entityId)
    .all<ActivityRow>();

  return rows.results;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

  const statements = [
    env.DB.prepare(
      `INSERT INTO users (id, phone, display_name, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(ARTISAN_ID, "+628110000301", "Pengrajin Uji", "artisan", NOW_MS),
    env.DB.prepare(
      `INSERT INTO users (id, phone, display_name, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(CAREGIVER_ID, "+628110000302", "Pendamping Uji", "caregiver", NOW_MS),
    env.DB.prepare(
      `INSERT INTO products (id, artisan_id, status, progress, created_at, updated_at)
       VALUES (?, ?, 'draft', 0, ?, ?)`,
    ).bind(PRODUCT_ID, ARTISAN_ID, NOW_MS, NOW_MS),
  ];

  await env.DB.batch(statements);
});

describe("audit — aksi pendamping tercatat atas nama pengrajin", () => {
  it("mengisi on_behalf_of saat pendamping bertindak", async () => {
    // TC-I-09
    const result = await logActivity(
      db,
      caregiver,
      ARTISAN_ID,
      "patch_content",
      { type: "product", id: PRODUCT_ID },
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await entriesFor(PRODUCT_ID);
    const entry = rows.find((row) => row.action === "patch_content");

    // Pelakunya pendamping, yang didampingi pengrajin — dua kolom berbeda.
    expect(entry?.actor_id).toBe(CAREGIVER_ID);
    expect(entry?.on_behalf_of).toBe(ARTISAN_ID);
  });

  it("membiarkan on_behalf_of kosong saat pengrajin bertindak sendiri", async () => {
    // TC-I-10
    const result = await logActivity(
      db,
      artisan,
      null,
      "publish_product",
      { type: "product", id: PRODUCT_ID },
      NOW_MS + 1000,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await entriesFor(PRODUCT_ID);
    const entry = rows.find((row) => row.action === "publish_product");

    expect(entry?.actor_id).toBe(ARTISAN_ID);
    // NULL, bukan string kosong: kueri `WHERE on_behalf_of IS NULL` adalah
    // cara pengrajin bertanya "apa saja yang saya kerjakan sendiri", dan
    // string kosong tidak akan terjawab olehnya.
    expect(entry?.on_behalf_of).toBeNull();
  });

  it("membedakan keduanya pada kueri yang sama", async () => {
    // Inilah gunanya kolom itu: satu kueri menjawab "siapa mengubah karya
    // saya, dan atas nama siapa". Tanpa pemisahan itu, keduanya tampak sama.
    const rows = await entriesFor(PRODUCT_ID);

    expect(rows.map((row) => [row.actor_id, row.on_behalf_of])).toEqual([
      [CAREGIVER_ID, ARTISAN_ID],
      [ARTISAN_ID, null],
    ]);

    const byCaregiver = rows.filter((row) => row.on_behalf_of !== null);
    expect(byCaregiver).toHaveLength(1);
    expect(byCaregiver[0]?.actor_id).toBe(CAREGIVER_ID);
  });

  it("tidak menulis apa pun saat pendamping tidak menyebut pengrajinnya", async () => {
    const before = await entriesFor(PRODUCT_ID);

    const result = await logActivity(
      db,
      caregiver,
      null,
      "delete_product",
      { type: "product", id: PRODUCT_ID },
      NOW_MS + 2000,
    );

    expect(result).toEqual({ ok: false, reason: "CAREGIVER_WITHOUT_ARTISAN" });
    expect(await entriesFor(PRODUCT_ID)).toHaveLength(before.length);
  });

  it("menyimpan metadata sebagai JSON yang dapat dibaca kembali", async () => {
    await logActivity(
      db,
      caregiver,
      ARTISAN_ID,
      "upload_media",
      { type: "product", id: PRODUCT_ID },
      NOW_MS + 3000,
      { kind: "photo_original", bytes: 2_400_000 },
    );

    const rows = await entriesFor(PRODUCT_ID);
    const entry = rows.find((row) => row.action === "upload_media");
    expect(entry).toBeDefined();
    if (entry === undefined) return;

    expect(JSON.parse(entry.metadata ?? "null")).toEqual({
      kind: "photo_original",
      bytes: 2_400_000,
    });
  });

  it("memakai indeks saat menelusuri riwayat satu entitas", async () => {
    // Riwayat per entitas adalah cara kolom ini dipakai, dan indeksnya ada
    // di migrations/0001. Kalau suatu saat indeksnya hilang, pemindaian
    // penuh akan tumbuh seiring umur basis data.
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT actor_id FROM activity_log WHERE entity_type = ? AND entity_id = ?`,
    )
      .bind("product", PRODUCT_ID)
      .all<{ detail: string }>();

    const detail = plan.results.map((row) => row.detail).join(" ").toLowerCase();
    expect(detail).toContain("idx_activity_entity");
    expect(detail).not.toContain("scan activity_log");
  });

  it("memakai satu kueri untuk setiap catatan", async () => {
    // Setiap aksi menambah satu kueri pada anggaran 25 per invocation.
    counter.reset();

    await logActivity(
      db,
      artisan,
      null,
      "archive_product",
      { type: "product", id: PRODUCT_ID },
      NOW_MS + 4000,
    );

    expect(counter.total()).toBe(1);
  });
});
