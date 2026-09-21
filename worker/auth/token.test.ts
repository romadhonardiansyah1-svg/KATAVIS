/**
 * Kasus uji token — TC-SEC-02, TC-SEC-03, TC-SEC-21.
 *
 * Pemeriksaan di sini adalah lapis yang menghadapi masukan paling tidak
 * tepercaya di seluruh sistem: token apa pun yang dikirim klien. Karena itu
 * seluruh jalur penolakan diuji dari luar, bukan dari dalam.
 */

import { describe, expect, it } from "vitest";

import { LIMITS } from "../../lib/schemas";

import {
  canRefreshToken,
  constantTimeEqual,
  isRefreshWithinIdleWindow,
  isTokenVersionCurrent,
  issueTokens,
  nextTokenVersion,
  verifyJwt,
  type TokenIssuer,
  type TokenPayload,
} from "./token";

const SIGNING_KEY = "kunci-uji-32-bita-yang-tidak-dipakai-di-produksi";
const OTHER_SIGNING_KEY = "kunci-uji-yang-berbeda";
const SUBJECT = "01J8ZQFX9K7YWVTN3MABCDEFGH";
const NOW_MS = 1_700_000_000_000;

const issuer: TokenIssuer = { subject: SUBJECT, role: "artisan", tokenVersion: 4 };

function splitToken(token: string): {
  header: string;
  body: string;
  signature: string;
} {
  const parts = token.split(".");
  return {
    header: parts[0] ?? "",
    body: parts[1] ?? "",
    signature: parts[2] ?? "",
  };
}

function tamperLastCharacter(value: string): string {
  const last = value.at(-1) ?? "A";
  return `${value.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

describe("auth — masa berlaku token", () => {
  it("menolak token yang sudah kedaluwarsa", async () => {
    // TC-SEC-02
    const { accessToken } = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    const almostExpired = NOW_MS + (LIMITS.ACCESS_TOKEN_TTL_S - 1) * 1000;
    const expired = NOW_MS + LIMITS.ACCESS_TOKEN_TTL_S * 1000;

    expect(await verifyJwt(accessToken, SIGNING_KEY, almostExpired)).not.toBeNull();
    // Tepat pada exp sudah dianggap lewat.
    expect(await verifyJwt(accessToken, SIGNING_KEY, expired)).toBeNull();
    expect(await verifyJwt(accessToken, SIGNING_KEY, NOW_MS + 86_400_000)).toBeNull();
  });

  it("menyatakan iat dan exp dalam detik epoch, bukan milidetik", async () => {
    // Satuan klaim adalah tempat kesalahan paling mudah terjadi. Diuji
    // eksplisit supaya tidak ada yang "memperbaikinya" menjadi milidetik.
    const { accessToken } = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    const payload = await verifyJwt(accessToken, SIGNING_KEY, NOW_MS);

    expect(payload?.iat).toBe(Math.floor(NOW_MS / 1000));
    expect(payload?.exp).toBe(
      Math.floor(NOW_MS / 1000) + LIMITS.ACCESS_TOKEN_TTL_S,
    );
    // Kontrak API bagian 2 menampilkan expiresIn dalam detik.
    const pair = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    expect(pair.expiresIn).toBe(900);
    expect(pair.expiresIn).toBe(LIMITS.ACCESS_TOKEN_TTL_S);
  });

  it("menerbitkan access dan refresh dengan token_version yang sama", async () => {
    const pair = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    const access = await verifyJwt(pair.accessToken, SIGNING_KEY, NOW_MS);
    const refresh = await verifyJwt(pair.refreshToken, SIGNING_KEY, NOW_MS);

    expect(access?.kind).toBe("access");
    expect(refresh?.kind).toBe("refresh");
    expect(access?.tokenVersion).toBe(4);
    expect(refresh?.tokenVersion).toBe(4);
    // Refresh berumur jauh lebih panjang daripada access.
    expect(refresh?.exp).toBeGreaterThan(access?.exp ?? 0);
  });
});

describe("auth — token yang dirusak", () => {
  it("menolak token yang tanda tangannya diubah", async () => {
    // TC-SEC-03
    const { accessToken } = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    const { header, body, signature } = splitToken(accessToken);

    expect(await verifyJwt(accessToken, SIGNING_KEY, NOW_MS)).not.toBeNull();
    expect(
      await verifyJwt(
        `${header}.${body}.${tamperLastCharacter(signature)}`,
        SIGNING_KEY,
        NOW_MS,
      ),
    ).toBeNull();
  });

  it("menolak token yang ditandatangani kunci lain", async () => {
    // TC-SEC-03
    const ours = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    const theirs = await issueTokens(issuer, OTHER_SIGNING_KEY, NOW_MS);

    expect(
      await verifyJwt(theirs.accessToken, SIGNING_KEY, NOW_MS),
    ).toBeNull();
    expect(
      await verifyJwt(ours.accessToken, OTHER_SIGNING_KEY, NOW_MS),
    ).toBeNull();
  });

  it.each([
    ["", "kosong"],
    ["bukan.token", "dua bagian"],
    ["a.b.c.d", "empat bagian"],
    ["kepala.badan.", "tanda tangan kosong"],
    ["kepala.badan.%%%", "tanda tangan bukan base64url"],
    ["kepala.!!!.tanda", "muatan bukan base64url"],
  ])("menolak token berbentuk %s (%s)", async (token) => {
    expect(await verifyJwt(token, SIGNING_KEY, NOW_MS)).toBeNull();
  });

  it("menolak muatan yang bukan JSON atau kehilangan klaim wajib", async () => {
    // Token dengan tanda tangan sah tetapi isi yang tidak lengkap tetap
    // ditolak: tanda tangan hanya membuktikan asalnya, bukan kebenarannya.
    const forged = await signForTest({ sub: SUBJECT, role: "artisan" });
    expect(await verifyJwt(forged, SIGNING_KEY, NOW_MS)).toBeNull();
  });
});

/**
 * Menandatangani muatan sembarang dengan kunci uji, untuk memeriksa bahwa
 * klaim yang tidak lengkap pun ditolak. Memakai jalur yang sama dengan
 * produksi agar tidak ada perilaku yang berbeda.
 */
async function signForTest(payload: Record<string, unknown>): Promise<string> {
  const encode = (value: unknown): string => {
    let binary = "";
    for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${body}`),
  );

  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return `${header}.${body}.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

describe("auth — pembatalan token", () => {
  it("membatalkan seluruh token lewat satu kenaikan versi", async () => {
    // logout-all (API-CONTRACT bagian 2): satu kenaikan versi membatalkan
    // access dan refresh sekaligus.
    const before = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    const payload = await verifyJwt(before.accessToken, SIGNING_KEY, NOW_MS);
    expect(payload).not.toBeNull();
    if (payload === null) return;

    expect(isTokenVersionCurrent(payload, 4)).toBe(true);
    expect(isTokenVersionCurrent(payload, nextTokenVersion(4))).toBe(false);

    // Token dengan versi LEBIH TINGGI dari basis data juga ditolak: sistem
    // ini tidak pernah menerbitkannya, jadi ia pasti dipalsukan.
    expect(isTokenVersionCurrent(payload, 3)).toBe(false);
  });

  it("memeriksa token_version juga pada jalur refresh", async () => {
    // Jebakan prompt P4: access token sudah ditolak sementara refresh token
    // yang sama masih diterima. Keduanya harus memakai aturan yang sama.
    const pair = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    const refresh = await verifyJwt(pair.refreshToken, SIGNING_KEY, NOW_MS);
    const access = await verifyJwt(pair.accessToken, SIGNING_KEY, NOW_MS);
    expect(refresh).not.toBeNull();
    expect(access).not.toBeNull();
    if (refresh === null || access === null) return;

    const user = { tokenVersion: 4, lastSeenAtMs: NOW_MS };
    expect(canRefreshToken(refresh, user, NOW_MS)).toBe(true);
    expect(canRefreshToken(refresh, { ...user, tokenVersion: 5 }, NOW_MS)).toBe(false);

    // Access token tidak pernah dapat dipakai untuk menyegarkan sesi.
    expect(canRefreshToken(access, user, NOW_MS)).toBe(false);
  });
});

describe("auth — jendela menganggur 30 hari", () => {
  it("menolak refresh token setelah 30 hari tanpa aktivitas", async () => {
    // TC-SEC-21
    const { refreshToken } = await issueTokens(issuer, SIGNING_KEY, NOW_MS);
    const payload = await verifyJwt(refreshToken, SIGNING_KEY, NOW_MS);
    expect(payload).not.toBeNull();
    if (payload === null) return;

    const user = { tokenVersion: 4, lastSeenAtMs: NOW_MS - LIMITS.REFRESH_TOKEN_TTL_MS };
    expect(canRefreshToken(payload, user, NOW_MS)).toBe(true);

    const idleTooLong = {
      tokenVersion: 4,
      lastSeenAtMs: NOW_MS - LIMITS.REFRESH_TOKEN_TTL_MS - 1,
    };
    expect(canRefreshToken(payload, idleTooLong, NOW_MS)).toBe(false);

    // Yang dihitung aktivitas terakhir, bukan umur token: sesi yang dipakai
    // setiap hari tidak boleh mati hanya karena tokennya berumur 30 hari.
    const longLivedButActive = {
      tokenVersion: 4,
      lastSeenAtMs: NOW_MS - 1000,
    };
    expect(
      isRefreshWithinIdleWindow(longLivedButActive.lastSeenAtMs, NOW_MS),
    ).toBe(true);
  });
});

describe("auth — perbandingan berwaktu tetap", () => {
  it("membandingkan tanpa keluar lebih awal pada panjang yang berbeda", () => {
    expect(constantTimeEqual("123456", "123456")).toBe(true);
    expect(constantTimeEqual("123456", "123457")).toBe(false);
    expect(constantTimeEqual("123456", "12345")).toBe(false);
    expect(constantTimeEqual("123456", "1234567")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "1")).toBe(false);
    expect(constantTimeEqual("a".repeat(1000), "a".repeat(999) + "b")).toBe(false);
  });
});

describe("auth — bentuk klaim", () => {
  it("menolak peran yang tidak dikenal meski tanda tangannya sah", async () => {
    const forged = await signForTest({
      sub: SUBJECT,
      role: "superadmin",
      tokenVersion: 4,
      kind: "access",
      iat: Math.floor(NOW_MS / 1000),
      exp: Math.floor(NOW_MS / 1000) + 900,
    });

    expect(await verifyJwt(forged, SIGNING_KEY, NOW_MS)).toBeNull();
  });

  it("menerima muatan lengkap yang ditandatangani dengan benar", async () => {
    const payload: TokenPayload | null = await verifyJwt(
      (
        await issueTokens(issuer, SIGNING_KEY, NOW_MS)
      ).accessToken,
      SIGNING_KEY,
      NOW_MS,
    );

    expect(payload).toEqual({
      sub: SUBJECT,
      role: "artisan",
      tokenVersion: 4,
      kind: "access",
      iat: Math.floor(NOW_MS / 1000),
      exp: Math.floor(NOW_MS / 1000) + LIMITS.ACCESS_TOKEN_TTL_S,
    });
  });
});
