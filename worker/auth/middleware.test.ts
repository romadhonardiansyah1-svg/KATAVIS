/**
 * Kasus uji middleware — TC-SEC-01, TC-SEC-04, TC-SEC-05, TC-SEC-16.
 *
 * Semuanya diperiksa pada tingkat HTTP, karena harapannya memang berbentuk
 * status: 401 untuk sesi yang tidak sah, dan identitas yang tidak dapat
 * dipengaruhi klien.
 */

import { describe, expect, it } from "vitest";

import type { ApiErrorBody } from "../../lib/errors";
import { LIMITS } from "../../lib/schemas";

import { verifyToken, type UserSessionLookup } from "./middleware";
import { issueTokens, nextTokenVersion, type TokenIssuer } from "./token";

const SIGNING_KEY = "kunci-uji-32-bita-yang-tidak-dipakai-di-produksi";
const OTHER_SIGNING_KEY = "kunci-uji-yang-berbeda";

const ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDEFGH";
const OTHER_ID = "01J8ZQFX9K7YWVTN3MABCDEFGK";
const NOW_MS = 1_700_000_000_000;

function lookupOf(versions: Readonly<Record<string, number>>): UserSessionLookup {
  return {
    findTokenVersion: async (userId) => versions[userId] ?? null,
  };
}

async function tokenFor(issuer: TokenIssuer): Promise<string> {
  const pair = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
  return pair.accessToken;
}

function requestWith(headers: Record<string, string>, body?: string): Request {
  return new Request("https://api.example/api/v1/products", {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function errorCodeOf(response: Response): Promise<string> {
  const body = (await response.json()) as ApiErrorBody;
  return body.error.code;
}

describe("auth — permintaan tanpa sesi yang sah", () => {
  it("menolak permintaan tanpa token", async () => {
    // TC-SEC-01
    const lookup = lookupOf({ [ARTISAN_ID]: 0 });
    const verification = await verifyToken(
      requestWith({}),
      lookup,
      SIGNING_KEY,
      NOW_MS,
    );

    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.response.status).toBe(401);
    expect(await errorCodeOf(verification.response)).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["Bearer", "tanpa nilai"],
    ["Bearer   ", "hanya spasi"],
    ["Basic dXNlcjpwYXNz", "skema lain"],
    ["token-tanpa-skema", "tanpa skema"],
    ["", "header kosong"],
  ])("menolak header Authorization %s (%s)", async (header) => {
    // TC-SEC-01
    const lookup = lookupOf({ [ARTISAN_ID]: 0 });
    const verification = await verifyToken(
      requestWith(header === "" ? {} : { Authorization: header }),
      lookup,
      SIGNING_KEY,
      NOW_MS,
    );

    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.response.status).toBe(401);
  });

  it("menerima skema bearer tanpa peduli huruf besar-kecil", async () => {
    const lookup = lookupOf({ [ARTISAN_ID]: 4 });
    const token = await tokenFor({
      subject: ARTISAN_ID,
      role: "artisan",
      tokenVersion: 4,
    });

    const verification = await verifyToken(
      requestWith({ Authorization: `bearer ${token}` }),
      lookup,
      SIGNING_KEY,
      NOW_MS,
    );

    expect(verification.ok).toBe(true);
  });
});

describe("auth — identitas hanya dari token", () => {
  it("tidak membiarkan klien menentukan pengguna yang diakses", async () => {
    // TC-SEC-04
    // Separuh yang menjadi tanggung jawab auth: identitas diambil dari
    // token, tidak pernah dari badan permintaan atau header lain. Keputusan
    // 403-nya sendiri ada di worker/rbac (canViewProduct), yang memeriksa
    // kepemilikan produk terhadap identitas ini.
    const lookup = lookupOf({ [ARTISAN_ID]: 4, [OTHER_ID]: 0 });
    const token = await tokenFor({
      subject: ARTISAN_ID,
      role: "artisan",
      tokenVersion: 4,
    });

    const verification = await verifyToken(
      requestWith(
        {
          Authorization: `Bearer ${token}`,
          "X-User-Id": OTHER_ID,
          "X-Artisan-Id": OTHER_ID,
        },
        JSON.stringify({ userId: OTHER_ID, artisanId: OTHER_ID }),
      ),
      lookup,
      SIGNING_KEY,
      NOW_MS,
    );

    expect(verification.ok).toBe(true);
    if (!verification.ok) return;
    expect(verification.session.userId).toBe(ARTISAN_ID);
  });

  it("mengabaikan peran yang dikirim klien", async () => {
    // TC-SEC-05
    // Pemeriksaan di frontend adalah pengalaman pengguna, bukan keamanan.
    const lookup = lookupOf({ [OTHER_ID]: 0 });
    const token = await tokenFor({
      subject: OTHER_ID,
      role: "buyer",
      tokenVersion: 0,
    });

    const verification = await verifyToken(
      requestWith(
        { Authorization: `Bearer ${token}`, "X-Role": "admin" },
        JSON.stringify({ role: "admin", isAdmin: true }),
      ),
      lookup,
      SIGNING_KEY,
      NOW_MS,
    );

    expect(verification.ok).toBe(true);
    if (!verification.ok) return;
    expect(verification.session.role).toBe("buyer");
  });

  it("menolak refresh token pada rute biasa", async () => {
    const lookup = lookupOf({ [ARTISAN_ID]: 4 });
    const pair = await issueTokens(
      { subject: ARTISAN_ID, role: "artisan", tokenVersion: 4 },
      SIGNING_KEY,
      NOW_MS,
    );

    const verification = await verifyToken(
      requestWith({ Authorization: `Bearer ${pair.refreshToken}` }),
      lookup,
      SIGNING_KEY,
      NOW_MS,
    );

    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.response.status).toBe(401);
  });
});

describe("auth — pencabutan berlaku seketika", () => {
  it("menolak token pendamping setelah aksesnya dicabut", async () => {
    // TC-SEC-16
    // Pencabutan menaikkan users.token_version. Token lama masih membawa
    // versi lama, jadi permintaan berikutnya ditolak tanpa menunggu
    // kedaluwarsa.
    const issuedVersion = 7;
    const token = await tokenFor({
      subject: OTHER_ID,
      role: "caregiver",
      tokenVersion: issuedVersion,
    });

    const beforeRevocation = await verifyToken(
      requestWith({ Authorization: `Bearer ${token}` }),
      lookupOf({ [OTHER_ID]: issuedVersion }),
      SIGNING_KEY,
      NOW_MS,
    );
    expect(beforeRevocation.ok).toBe(true);

    const afterRevocation = await verifyToken(
      requestWith({ Authorization: `Bearer ${token}` }),
      lookupOf({ [OTHER_ID]: nextTokenVersion(issuedVersion) }),
      SIGNING_KEY,
      NOW_MS,
    );

    expect(afterRevocation.ok).toBe(false);
    if (afterRevocation.ok) return;
    expect(afterRevocation.response.status).toBe(401);
    expect(await errorCodeOf(afterRevocation.response)).toBe("UNAUTHENTICATED");
  });

  it("menolak token milik pengguna yang tidak ada lagi", async () => {
    const token = await tokenFor({
      subject: ARTISAN_ID,
      role: "artisan",
      tokenVersion: 0,
    });

    const verification = await verifyToken(
      requestWith({ Authorization: `Bearer ${token}` }),
      lookupOf({}),
      SIGNING_KEY,
      NOW_MS,
    );

    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.response.status).toBe(401);
  });

  it("menolak token yang ditandatangani kunci lain", async () => {
    const pair = await issueTokens(
      { subject: ARTISAN_ID, role: "artisan", tokenVersion: 0 },
      OTHER_SIGNING_KEY,
      NOW_MS,
    );

    const verification = await verifyToken(
      requestWith({ Authorization: `Bearer ${pair.accessToken}` }),
      lookupOf({ [ARTISAN_ID]: 0 }),
      SIGNING_KEY,
      NOW_MS,
    );

    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.response.status).toBe(401);
  });

  it("menolak token yang sudah melewati masa berlakunya", async () => {
    const token = await tokenFor({
      subject: ARTISAN_ID,
      role: "artisan",
      tokenVersion: 0,
    });
    const afterExpiry = NOW_MS + LIMITS.ACCESS_TOKEN_TTL_S * 1000;

    const verification = await verifyToken(
      requestWith({ Authorization: `Bearer ${token}` }),
      lookupOf({ [ARTISAN_ID]: 0 }),
      SIGNING_KEY,
      afterExpiry,
    );

    expect(verification.ok).toBe(false);
    if (verification.ok) return;
    expect(verification.response.status).toBe(401);
  });
});
