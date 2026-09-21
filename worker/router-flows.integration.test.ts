/**
 * Uji integrasi router — kelengkapan rute, alur media, alur agen, dan
 * pencabutan akses pendamping (TC-I-04).
 *
 * TC-I-04 adalah pengujian keamanan terpenting di sistem. `Fitur
 * pendukung.pdf` halaman 5 menyatakan pengrajin dapat mencabut akses kapan
 * saja; pencabutan yang hanya mengubah baris basis data sementara token lama
 * masih sah bukanlah pencabutan.
 *
 * Dijalankan dengan: pnpm run test:integration
 */

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { ROUTES } from "./index";
import worker from "./index";

const ARTISAN_PHONE = "+628110000501";
const CAREGIVER_PHONE = "+628110000502";
const NOW_MS = Date.now();

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

/** Seluruh endpoint di docs/spec/API-CONTRACT.md, apa adanya. */
const CONTRACT_ENDPOINTS: readonly (readonly [string, string])[] = [
  ["POST", "/api/v1/auth/otp/request"],
  ["POST", "/api/v1/auth/otp/verify"],
  ["POST", "/api/v1/auth/pin/set"],
  ["POST", "/api/v1/auth/pin/verify"],
  ["POST", "/api/v1/auth/refresh"],
  ["POST", "/api/v1/auth/logout"],
  ["POST", "/api/v1/auth/logout-all"],
  ["POST", "/api/v1/consent"],
  ["GET", "/api/v1/consent"],
  ["POST", "/api/v1/products"],
  ["GET", "/api/v1/products"],
  ["GET", "/api/v1/products/:id"],
  ["PATCH", "/api/v1/products/:id/content/:locale"],
  ["POST", "/api/v1/products/:id/publish"],
  ["DELETE", "/api/v1/products/:id"],
  ["POST", "/api/v1/products/:id/media/upload-url"],
  ["POST", "/api/v1/products/:id/media/:mediaId/confirm"],
  ["PATCH", "/api/v1/products/:id/media/:mediaId"],
  ["POST", "/api/v1/products/:id/audio"],
  ["GET", "/api/v1/products/:id/transcript"],
  ["PUT", "/api/v1/products/:id/transcript"],
  ["POST", "/api/v1/products/:id/generate"],
  ["GET", "/api/v1/products/:id/jobs"],
  ["POST", "/api/v1/products/:id/jobs/:jobId/retry"],
  ["POST", "/api/v1/agent/heartbeat"],
  ["POST", "/api/v1/agent/jobs/claim"],
  ["POST", "/api/v1/agent/jobs/:jobId/complete"],
  ["POST", "/api/v1/agent/jobs/:jobId/fail"],
  ["POST", "/api/v1/caregivers/invite"],
  ["POST", "/api/v1/caregivers/accept"],
  ["GET", "/api/v1/caregivers"],
  ["DELETE", "/api/v1/caregivers/:linkId"],
  ["POST", "/api/v1/products/:id/export"],
  ["GET", "/api/v1/public/catalog/:slug"],
  ["PUT", "/api/v1/me/a11y-profile"],
];

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`https://api.example${path}`, init), env);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function login(phone: string): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO otp_codes (phone, code_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash,
       expires_at = excluded.expires_at`,
  )
    .bind(phone, await sha256Hex("123456"), NOW_MS, NOW_MS + 300_000)
    .run();

  const response = await call("/api/v1/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code: "123456" }),
  });

  const body = (await json(response)) as { data: { accessToken: string } };
  return body.data.accessToken;
}

function auth(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
}

async function createProduct(token: string): Promise<string> {
  const response = await call(
    "/api/v1/products",
    auth(token, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase() },
    }),
  );

  const body = (await json(response)) as { data: { id: string } };
  return body.data.id;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("router — kelengkapan rute", () => {
  it("melayani setiap endpoint di kontrak API", () => {
    // Uji struktural: endpoint yang hilang tidak akan ketahuan sampai ada
    // yang mencoba memanggilnya, dan itu terjadi saat demo.
    const registered = new Set(ROUTES.map((entry) => `${entry.method} ${entry.pattern}`));

    for (const [method, pattern] of CONTRACT_ENDPOINTS) {
      expect(registered.has(`${method} ${pattern}`)).toBe(true);
    }
  });

  it("tidak menambahkan endpoint yang tidak ada di kontrak", () => {
    // Endpoint karangan adalah endpoint yang tidak punya bentuk respons
    // yang disepakati.
    const documented = new Set(CONTRACT_ENDPOINTS.map(([method, pattern]) => `${method} ${pattern}`));

    for (const entry of ROUTES) {
      // Rute unggah bertanda tangan adalah mekanisme, bukan endpoint yang
      // didokumentasikan: kontrak hanya menulis uploadUrl sebagai "https://...".
      if (entry.pattern.endsWith("/media/upload/:token")) continue;
      expect(documented.has(`${entry.method} ${entry.pattern}`)).toBe(true);
    }
  });

  it("memisahkan akses publik, sesi, dan agen", () => {
    const byPattern = new Map(ROUTES.map((entry) => [entry.pattern, entry]));

    expect(byPattern.get("/api/v1/public/catalog/:slug")?.access).toBe("public");
    expect(byPattern.get("/api/v1/auth/otp/request")?.access).toBe("public");
    expect(byPattern.get("/api/v1/products")?.access).toBe("session");
    expect(byPattern.get("/api/v1/agent/heartbeat")?.access).toBe("agent");
    expect(byPattern.get("/api/v1/agent/jobs/claim")?.access).toBe("agent");
  });
});

describe("router — alur media", () => {
  it("menerbitkan URL, menerima berkas, lalu mengonfirmasinya", async () => {
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);

    const requested = await call(
      `/api/v1/products/${productId}/media/upload-url`,
      auth(token, {
        method: "POST",
        body: JSON.stringify({ kind: "photo_original", mimeType: "image/jpeg", bytes: JPEG_BYTES.length }),
      }),
    );

    expect(requested.status).toBe(200);
    const upload = (await json(requested)) as {
      data: { mediaId: string; uploadUrl: string; expiresAt: number };
    };
    expect(upload.data.expiresAt).toBeGreaterThan(NOW_MS);

    // Klien mengunggah langsung ke URL bertanda tangan, tanpa header apa pun.
    const put = await call(upload.data.uploadUrl.replace("https://api.example", ""), {
      method: "PUT",
      body: JPEG_BYTES,
      headers: { "Content-Length": String(JPEG_BYTES.length) },
    });
    expect(put.status).toBe(200);

    const confirmed = await call(
      `/api/v1/products/${productId}/media/${upload.data.mediaId}/confirm`,
      auth(token, { method: "POST" }),
    );
    expect(confirmed.status).toBe(200);
    expect((await json(confirmed)) as { data: { uploadStatus: string } }).toMatchObject({
      data: { uploadStatus: "confirmed" },
    });
  });

  it("menolak berkas yang isinya bukan gambar meski namanya .jpg", async () => {
    // TC-U-CAT-06, lewat router.
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);

    const requested = await call(
      `/api/v1/products/${productId}/media/upload-url`,
      auth(token, {
        method: "POST",
        body: JSON.stringify({ kind: "photo_original", mimeType: "image/jpeg", bytes: 64 }),
      }),
    );
    const upload = (await json(requested)) as { data: { mediaId: string; uploadUrl: string } };

    const html = new TextEncoder().encode("<!DOCTYPE html><html><body>halo</body></html>");
    await call(upload.data.uploadUrl.replace("https://api.example", ""), {
      method: "PUT",
      body: html,
      headers: { "Content-Length": String(html.length) },
    });

    const confirmed = await call(
      `/api/v1/products/${productId}/media/${upload.data.mediaId}/confirm`,
      auth(token, { method: "POST" }),
    );

    expect(confirmed.status).toBe(400);
    expect((await json(confirmed)) as { error: { code: string } }).toMatchObject({
      error: { code: "CONTENT_MISMATCH" },
    });
  });

  it("menolak SVG sebelum URL diterbitkan", async () => {
    // TC-SEC-09, lewat router.
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);

    const response = await call(
      `/api/v1/products/${productId}/media/upload-url`,
      auth(token, {
        method: "POST",
        body: JSON.stringify({ kind: "photo_original", mimeType: "image/svg+xml", bytes: 1024 }),
      }),
    );

    expect(response.status).toBe(415);
    expect((await json(response)) as { error: { code: string } }).toMatchObject({
      error: { code: "UNSUPPORTED_FORMAT" },
    });
  });
});

describe("router — antrian Studio Agent", () => {
  it("menolak tanpa kunci agen", async () => {
    const response = await call("/api/v1/agent/heartbeat", {
      method: "POST",
      body: JSON.stringify({ agentId: "laptop-01", healthy: true, selectorsOk: true, chromeSessionOk: true }),
    });

    expect(response.status).toBe(403);
  });

  it("menolak kunci agen yang salah", async () => {
    const response = await call("/api/v1/agent/heartbeat", {
      method: "POST",
      headers: { "X-Agent-Key": "kunci-palsu" },
      body: JSON.stringify({ agentId: "laptop-01", healthy: true, selectorsOk: true, chromeSessionOk: true }),
    });

    expect(response.status).toBe(403);
  });

  it("menerima heartbeat dan klaim pekerjaan", async () => {
    // Kunci diambil dari lingkungan, bukan ditulis di uji: `.dev.vars`
    // sudah memuatnya, dan menimpa env dari pool tidak berpengaruh.
    const agentKey = env.AGENT_SHARED_KEY ?? "";

    const heartbeat = await call("/api/v1/agent/heartbeat", {
      method: "POST",
      headers: { "X-Agent-Key": agentKey, "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "laptop-01", healthy: true, selectorsOk: true, chromeSessionOk: true }),
    });
    expect(heartbeat.status).toBe(200);

    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);

    await env.DB.prepare(
      `INSERT INTO jobs (id, product_id, kind, status, attempt, progress, created_at)
       VALUES (?, ?, 'image', 'queued', 0, 0, ?)`,
    )
      .bind("01J8ZQFX9K7YWVTN3MABCDJ900", productId, NOW_MS)
      .run();

    const claimed = await call("/api/v1/agent/jobs/claim", {
      method: "POST",
      headers: { "X-Agent-Key": agentKey, "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "laptop-01", max: 1 }),
    });

    expect(claimed.status).toBe(200);
    const body = (await json(claimed)) as { data: { jobs: { id: string }[] } };
    // `max` dibatasi 1 oleh AgentClaimSchema: satu peramban tidak
    // menjalankan dua pekerjaan bersamaan (TC-SA-05).
    expect(body.data.jobs).toHaveLength(1);
    expect(body.data.jobs[0]?.id).toBe("01J8ZQFX9K7YWVTN3MABCDJ900");

  });

  it("mengembalikan pekerjaan ke antrian saat agen gagal", async () => {
    const agentKey = env.AGENT_SHARED_KEY ?? "";

    const failed = await call("/api/v1/agent/jobs/01J8ZQFX9K7YWVTN3MABCDJ900/fail", {
      method: "POST",
      headers: { "X-Agent-Key": agentKey, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "selector_not_found", durationMs: 45_000 }),
    });

    expect(failed.status).toBe(200);

    const row = await env.DB.prepare(
      "SELECT status, provider, error_code FROM jobs WHERE id = ?",
    )
      .bind("01J8ZQFX9K7YWVTN3MABCDJ900")
      .first<{ status: string; provider: string; error_code: string }>();

    // Bukan `failed`: penyedia cadangannya belum pernah dicoba.
    expect(row?.status).toBe("queued");
    expect(row?.provider).toBe("workers_ai");
    expect(row?.error_code).toBe("IMAGE_GENERATE_FAILED");

  });
});

describe("router — pencabutan akses pendamping", () => {
  it("mematikan token pendamping seketika, bukan hanya mengubah statusnya", async () => {
    // TC-I-04. Pengujian keamanan terpenting di sistem.
    const artisanToken = await login(ARTISAN_PHONE);
    const productId = await createProduct(artisanToken);

    const invited = await call(
      "/api/v1/caregivers/invite",
      auth(artisanToken, {
        method: "POST",
        body: JSON.stringify({ phone: CAREGIVER_PHONE, permissions: ["edit_draft"] }),
      }),
    );
    expect(invited.status).toBe(200);
    const invite = (await json(invited)) as { data: { linkId: string; inviteToken: string } };

    const caregiverToken = await login(CAREGIVER_PHONE);
    const accepted = await call(
      "/api/v1/caregivers/accept",
      auth(caregiverToken, {
        method: "POST",
        body: JSON.stringify({ token: invite.data.inviteToken }),
      }),
    );
    expect(accepted.status).toBe(200);
    const caregiverSession = (await json(accepted)) as { data: { accessToken: string } };
    const caregiverAccess = caregiverSession.data.accessToken;

    // Sebelum dicabut, pendamping dapat menyunting draf.
    const before = await call(
      `/api/v1/products/${productId}/content/id`,
      auth(caregiverAccess, { method: "PATCH", body: JSON.stringify({ name: "Tas Kulit" }) }),
    );
    expect(before.status).toBe(200);

    // Undangan sekali pakai (TC-SEC-15). Memakai token yang BARU: token
    // lama sudah mati sejak peran berubah, dan permintaannya akan ditolak
    // middleware sebelum sampai ke handler ini.
    const replayed = await call(
      "/api/v1/caregivers/accept",
      auth(caregiverAccess, {
        method: "POST",
        body: JSON.stringify({ token: invite.data.inviteToken }),
      }),
    );
    expect(replayed.status).toBe(409);
    expect((await json(replayed)) as { error: { code: string } }).toMatchObject({
      error: { code: "INVITE_ALREADY_USED" },
    });

    const revoked = await call(
      `/api/v1/caregivers/${invite.data.linkId}`,
      auth(artisanToken, { method: "DELETE" }),
    );
    expect(revoked.status).toBe(200);

    // Sesudah dicabut, token yang sama ditolak — bukan pada permintaan
    // berikutnya setelah kedaluwarsa, melainkan sekarang juga.
    const after = await call(
      `/api/v1/products/${productId}/content/id`,
      auth(caregiverAccess, { method: "PATCH", body: JSON.stringify({ name: "Tas Lain" }) }),
    );
    expect(after.status).toBe(401);
  });

  it("menolak pencabutan oleh pendamping lain", async () => {
    const artisanToken = await login(ARTISAN_PHONE);

    const invited = await call(
      "/api/v1/caregivers/invite",
      auth(artisanToken, {
        method: "POST",
        body: JSON.stringify({ phone: "+628110000503", permissions: ["edit_draft"] }),
      }),
    );
    const invite = (await json(invited)) as { data: { linkId: string } };

    const otherToken = await login(CAREGIVER_PHONE);
    const response = await call(
      `/api/v1/caregivers/${invite.data.linkId}`,
      auth(otherToken, { method: "DELETE" }),
    );

    expect(response.status).toBe(403);
  });
});
