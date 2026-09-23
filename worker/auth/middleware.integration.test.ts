/**
 * Uji integrasi `verifyToken` — workerd dengan D1 sungguhan.
 *
 * Berkas ini ada karena satu cacat nyata: token yang tanda tangan, masa
 * berlaku, jenis, dan `tokenVersion`-nya semuanya sah tetap ditolak di
 * setiap rute bertanda `session`, sementara `POST /auth/refresh` — yang
 * melewati `verifyToken` dan memakai `d1FindUserById` — berhasil.
 *
 * Uji unit `middleware.test.ts` tidak dapat menangkapnya: ia menyuntikkan
 * pencarian versi tiruan, jadi satu-satunya bagian yang benar-benar berbeda
 * di produksi (kueri D1-nya) justru yang tidak pernah dijalankan.
 *
 * Dijalankan dengan: pnpm run test:integration
 */

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { d1SessionLookup } from "./d1-stores";
import { verifyToken } from "./middleware";
import { issueTokens } from "./token";

const NOW_MS = 1_700_000_000_000;
const SIGNING_KEY = "kunci-uji-integrasi";

const ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDV012";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function seedUser(id: string, phone: string, tokenVersion: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, phone, display_name, role, token_version, created_at)
     VALUES (?, ?, ?, 'artisan', ?, ?)`,
  )
    .bind(id, phone, "Irsyad", tokenVersion, NOW_MS)
    .run();
}

function requestWith(token: string): Request {
  return new Request("https://katavis.test/api/v1/consent", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("verifyToken terhadap D1 sungguhan", () => {
  it("menerima token yang baru diterbitkan untuk pengguna yang ada", async () => {
    await seedUser(ARTISAN_ID, "+628110000101", 0);

    const pair = await issueTokens(
      { subject: ARTISAN_ID, role: "artisan", tokenVersion: 0 },
      SIGNING_KEY,
      NOW_MS,
    );

    const result = await verifyToken(
      requestWith(pair.accessToken),
      d1SessionLookup(env.DB),
      SIGNING_KEY,
      NOW_MS,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.userId).toBe(ARTISAN_ID);
    expect(result.session.role).toBe("artisan");
    expect(result.session.sessionTokenVersion).toBe(0);
    expect(result.session.currentTokenVersion).toBe(0);
  });

  it("membaca token_version sebagai bilangan dari D1, bukan teks", async () => {
    // Perbandingan di `isTokenVersionCurrent` memakai kesamaan ketat. Bila
    // driver mengembalikan kolom INTEGER sebagai string, `0 === "0"` gagal
    // dan setiap permintaan ditolak tanpa jejak yang terlihat dari luar.
    await seedUser("01J8ZQFX9K7YWVTN3MABCDV023", "+628110000102", 3);

    const version = await d1SessionLookup(env.DB).findTokenVersion(
      "01J8ZQFX9K7YWVTN3MABCDV023",
    );

    expect(version).toBe(3);
    expect(typeof version).toBe("number");
  });

  it("menolak token yang token_version-nya sudah tidak cocok", async () => {
    await seedUser("01J8ZQFX9K7YWVTN3MABCDV034", "+628110000103", 5);

    const pair = await issueTokens(
      { subject: "01J8ZQFX9K7YWVTN3MABCDV034", role: "artisan", tokenVersion: 4 },
      SIGNING_KEY,
      NOW_MS,
    );

    const result = await verifyToken(
      requestWith(pair.accessToken),
      d1SessionLookup(env.DB),
      SIGNING_KEY,
      NOW_MS,
    );

    expect(result.ok).toBe(false);
  });

  it("menolak token untuk pengguna yang tidak ada di D1", async () => {
    const pair = await issueTokens(
      { subject: "01J8ZQFX9K7YWVTN3MABCDV99A", role: "artisan", tokenVersion: 0 },
      SIGNING_KEY,
      NOW_MS,
    );

    const result = await verifyToken(
      requestWith(pair.accessToken),
      d1SessionLookup(env.DB),
      SIGNING_KEY,
      NOW_MS,
    );

    expect(result.ok).toBe(false);
  });
});
