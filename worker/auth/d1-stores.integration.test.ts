/**
 * Uji integrasi adapter D1 — dijalankan di workerd dengan D1 sungguhan.
 *
 * Ini satu-satunya lapis modul auth yang tidak dapat diuji di Node: berkas
 * `d1-stores.ts` menulis SQL, dan SQL hanya terbukti benar bila dijalankan
 * terhadap basis data yang sesungguhnya. Tiruan D1 akan menyembunyikan
 * justru kesalahan yang paling mungkin terjadi — nama kolom yang salah,
 * `ON CONFLICT` yang tidak cocok dengan kunci utama, dan urutan argumen
 * `bind` yang tertukar.
 *
 * Dijalankan dengan: pnpm run test:integration
 */

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  d1OtpStore,
  d1PinAttemptStore,
  d1RateLimitStore,
  d1SavePinHash,
  d1SessionLookup,
} from "./d1-stores";
import { INITIAL_PIN_ATTEMPTS } from "./pin";

const NOW_MS = 1_700_000_000_000;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** Pengguna dengan ULID yang berbeda setiap uji, supaya uji tidak saling mengganggu. */
async function seedUser(id: string, phone: string, tokenVersion = 0): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, phone, display_name, role, token_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, phone, "Pengrajin Uji", "artisan", tokenVersion, NOW_MS)
    .run();
}

describe("auth D1 — otp_codes", () => {
  it("menyimpan, membaca, dan menghapus kode", async () => {
    const store = d1OtpStore(env.DB);
    const phone = "+628110000001";

    await store.save({
      phone,
      codeHash: "a".repeat(64),
      createdAt: NOW_MS,
      expiresAt: NOW_MS + 300_000,
    });

    const found = await store.find(phone);
    expect(found).toEqual({
      phone,
      codeHash: "a".repeat(64),
      createdAt: NOW_MS,
      expiresAt: NOW_MS + 300_000,
    });

    await store.remove(phone);
    expect(await store.find(phone)).toBeNull();
  });

  it("menimpa kode lama untuk nomor yang sama, bukan menumpuk", async () => {
    // Kunci utama `phone` yang membuat ini benar. Tanpa ON CONFLICT, tiga
    // permintaan berturut-turut meninggalkan tiga kode yang semuanya sah.
    const store = d1OtpStore(env.DB);
    const phone = "+628110000002";

    await store.save({
      phone,
      codeHash: "b".repeat(64),
      createdAt: NOW_MS,
      expiresAt: NOW_MS + 300_000,
    });
    await store.save({
      phone,
      codeHash: "c".repeat(64),
      createdAt: NOW_MS + 1000,
      expiresAt: NOW_MS + 301_000,
    });

    const found = await store.find(phone);
    expect(found?.codeHash).toBe("c".repeat(64));

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM otp_codes WHERE phone = ?",
    )
      .bind(phone)
      .first<{ total: number }>();
    expect(rows?.total).toBe(1);
  });

  it("mengembalikan null untuk nomor yang tidak pernah meminta", async () => {
    expect(await d1OtpStore(env.DB).find("+628119999999")).toBeNull();
  });
});

describe("auth D1 — auth_rate_limits", () => {
  it("menghitung kejadian di dalam jendela dan membuang yang lama", async () => {
    const store = d1RateLimitStore(env.DB);
    const key = "otp:phone:+628110000003";

    await store.record(key, NOW_MS - 7_200_000);
    await store.record(key, NOW_MS - 60_000);
    await store.record(key, NOW_MS);

    expect(await store.countSince(key, NOW_MS - 3_600_000)).toBe(2);
    expect(await store.countSince(key, NOW_MS - 1000)).toBe(1);
    expect(await store.countSince("otp:phone:+628119999998", NOW_MS - 3_600_000)).toBe(0);

    await store.prune(NOW_MS - 3_600_000);
    expect(await store.countSince(key, NOW_MS - 7_200_000)).toBe(2);
  });
});

describe("auth D1 — token_version", () => {
  it("membaca versi terkini dan mengembalikan null untuk pengguna yang tidak ada", async () => {
    const lookup = d1SessionLookup(env.DB);
    await seedUser("01J8ZQFX9K7YWVTN3MABCDEF01", "+628110000004", 7);

    expect(await lookup.findTokenVersion("01J8ZQFX9K7YWVTN3MABCDEF01")).toBe(7);
    expect(await lookup.findTokenVersion("01J8ZQFX9K7YWVTN3MABCDEF99")).toBeNull();
  });
});

describe("auth D1 — penguncian PIN", () => {
  it("mengembalikan keadaan awal untuk pengguna yang tidak ada", async () => {
    const store = d1PinAttemptStore(env.DB);
    expect(await store.load("01J8ZQFX9K7YWVTN3MABCDEF98")).toEqual(INITIAL_PIN_ATTEMPTS);
  });

  it("menyimpan dan membaca kembali keadaan percobaan gagal", async () => {
    const userId = "01J8ZQFX9K7YWVTN3MABCDEF02";
    await seedUser(userId, "+628110000005");

    const store = d1PinAttemptStore(env.DB);
    expect(await store.load(userId)).toEqual(INITIAL_PIN_ATTEMPTS);

    await store.save(userId, {
      failedAttempts: 3,
      lockedUntil: NOW_MS + 900_000,
    });
    expect(await store.load(userId)).toEqual({
      failedAttempts: 3,
      lockedUntil: NOW_MS + 900_000,
    });

    await store.save(userId, { failedAttempts: 0, lockedUntil: null });
    expect(await store.load(userId)).toEqual(INITIAL_PIN_ATTEMPTS);
  });

  it("menetapkan PIN baru sekaligus membuka kunci", async () => {
    // Pengrajin yang baru mengganti PIN tidak boleh mendapati dirinya masih
    // terkunci karena kesalahan sebelum ia menggantinya.
    const userId = "01J8ZQFX9K7YWVTN3MABCDEF03";
    await seedUser(userId, "+628110000006");

    const store = d1PinAttemptStore(env.DB);
    await store.save(userId, {
      failedAttempts: 5,
      lockedUntil: NOW_MS + 900_000,
    });

    await d1SavePinHash(env.DB, userId, "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA");

    expect(await store.load(userId)).toEqual(INITIAL_PIN_ATTEMPTS);

    const row = await env.DB.prepare("SELECT pin_hash FROM users WHERE id = ?")
      .bind(userId)
      .first<{ pin_hash: string }>();
    expect(row?.pin_hash).toBe("$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA");
  });
});
