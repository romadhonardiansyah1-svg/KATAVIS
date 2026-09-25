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
import { ulid } from "ulid";
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
  ["POST", "/api/v1/products/:id/submit"],
  ["DELETE", "/api/v1/products/:id"],
  ["POST", "/api/v1/products/:id/media/upload-url"],
  ["POST", "/api/v1/products/:id/media/:mediaId/confirm"],
  ["PATCH", "/api/v1/products/:id/media/:mediaId"],
  ["POST", "/api/v1/products/:id/audio"],
  ["GET", "/api/v1/products/:id/transcript"],
  ["PUT", "/api/v1/products/:id/transcript"],
  ["POST", "/api/v1/products/:id/generate"],
  ["POST", "/api/v1/products/:id/image-prompt"],
  ["GET", "/api/v1/products/:id/jobs"],
  ["POST", "/api/v1/products/:id/jobs/:jobId/retry"],
  ["POST", "/api/v1/agent/heartbeat"],
  ["POST", "/api/v1/agent/jobs/claim"],
  ["POST", "/api/v1/agent/jobs/:jobId/complete"],
  ["POST", "/api/v1/agent/jobs/:jobId/fail"],
  ["POST", "/api/v1/agent/jobs/:jobId/upload-url"],
  ["POST", "/api/v1/agent/jobs/:jobId/confirm-upload"],
  ["GET", "/api/v1/agent/jobs/:jobId/source-image"],
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
      // Hal yang sama berlaku untuk pasangan bacanya. Kontrak menyatakan
      // `media[].url` sebagai URL yang dapat dimuat peramban, tanpa pernah
      // menamai rutenya — dan itu disengaja: bentuk tokennya adalah urusan
      // dalam, bukan janji kepada klien. Keduanya muncul dan hilang bersama.
      if (entry.pattern.endsWith("/media/:token")) continue;
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

    // TC-I-16: foto asli pertama siap dipakai saat layanan foto AI gagal.
    const detail = await call(`/api/v1/products/${productId}`, auth(token));
    const detailBody = (await json(detail)) as {
      data: { media: { id: string; isPrimary: boolean }[] };
    };
    expect(detailBody.data.media.find((media) => media.id === upload.data.mediaId)?.isPrimary).toBe(true);
  });

  it("menyajikan byte media lewat URL bertanda tangan, bukan kunci R2", async () => {
    // TC-I-16, TC-I-18.
    //
    // Cacat yang dijaga di sini pernah lolos ke setiap demo: `media[].url`
    // berisi kunci R2 mentah, dan tidak ada rute yang menyajikan byte-nya.
    // Setiap <img src> menunjuk alamat relatif terhadap origin aplikasi dan
    // gagal 404 — seluruh katalog tampil tanpa foto.
    //
    // Dua hal yang membuatnya sulit terlihat, dan keduanya diuji di bawah:
    // kunci R2 mentah adalah teks yang sah, sehingga tidak ada skema yang
    // menolaknya; dan jawabannya 200, bukan galat.
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);

    const requested = await call(
      `/api/v1/products/${productId}/media/upload-url`,
      auth(token, {
        method: "POST",
        body: JSON.stringify({
          kind: "photo_original",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES.length,
        }),
      }),
    );
    const upload = (await json(requested)) as { data: { mediaId: string; uploadUrl: string } };

    await call(upload.data.uploadUrl.replace("https://api.example", ""), {
      method: "PUT",
      body: JPEG_BYTES,
      headers: { "Content-Length": String(JPEG_BYTES.length) },
    });
    await call(
      `/api/v1/products/${productId}/media/${upload.data.mediaId}/confirm`,
      auth(token, { method: "POST" }),
    );

    const detail = await call(`/api/v1/products/${productId}`, auth(token));
    const body = (await json(detail)) as { data: { media: { url: string | null }[] } };

    expect(body.data.media.length).toBeGreaterThan(0);
    const url = body.data.media[0]?.url ?? "";

    // Bukan kunci R2 mentah — inilah yang lolos selama ini.
    expect(url.startsWith("products/")).toBe(false);
    expect(url.startsWith("https://")).toBe(true);

    // Dan yang paling penting: URL-nya benar-benar mengembalikan gambarnya.
    const served = await call(url.replace("https://api.example", ""));
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/jpeg");
    expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG_BYTES);
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

describe("router — persaingan antrean gambar dan Studio Agent", () => {
  it("memberi agen sehat kesempatan mengambil pekerjaan sebelum fallback gambar", async () => {
    // TC-SA-02: konsumen Queue dan agen menerima pekerjaan hampir bersamaan.
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);
    const jobId = ulid();
    await env.DB.prepare(
      "INSERT INTO jobs (id, product_id, kind, status, attempt, progress, created_at) VALUES (?, ?, 'image', 'queued', 0, 0, ?)",
    ).bind(jobId, productId, Date.now()).run();
    await env.DB.prepare(
      "INSERT INTO agent_heartbeats (agent_id, healthy, selectors_ok, chrome_session_ok, last_seen_at) VALUES (?, 1, 1, 1, ?)",
    ).bind("laptop-01", Date.now()).run();

    let retried = false;
    let acknowledged = false;
    const batch = {
      messages: [{
        body: { jobId, productId, kind: "image" }, attempts: 1,
        retry: () => { retried = true; },
        ack: () => { acknowledged = true; },
      }],
    } as unknown as MessageBatch<unknown>;
    await worker.queue(batch, env);

    const job = await env.DB.prepare("SELECT status FROM jobs WHERE id = ?")
      .bind(jobId).first<{ status: string }>();
    expect(retried).toBe(true);
    expect(acknowledged).toBe(false);
    expect(job?.status).toBe("queued");
  });
});

describe("router — prompt studio", () => {
  it("menyusun prompt otomatis dari transkrip dan gaya", async () => {
    // F2-10, lewat router.
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);

    await call(
      `/api/v1/products/${productId}/transcript`,
      auth(token, {
        method: "PUT",
        body: JSON.stringify({ text: "Tas anyaman pandan dari pengrajin." }),
      }),
    );

    const response = await call(
      `/api/v1/products/${productId}/image-prompt`,
      auth(token, {
        method: "POST",
        body: JSON.stringify({ style: "wood_warm" }),
      }),
    );
    const body = (await json(response)) as {
      data: { prompt: string; mode: string; style: string };
    };

    expect(response.status).toBe(200);
    expect(body.data.mode).toBe("auto");
    expect(body.data.style).toBe("wood_warm");
    expect(body.data.prompt).toContain("Tas anyaman pandan");
    // Prompt server adalah arah kreatif murni; aturan pelestarian
    // ditambahkan agen, bukan di sini.
    expect(body.data.prompt).not.toContain("saya lampirkan");
  });

  it("menolak gaya yang tidak dikenal", async () => {
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);

    const response = await call(
      `/api/v1/products/${productId}/image-prompt`,
      auth(token, {
        method: "POST",
        body: JSON.stringify({ style: "neon_cyberpunk" }),
      }),
    );

    expect(response.status).toBe(409);
    expect((await json(response)) as { error: { code: string } }).toMatchObject({
      error: { code: "CONTENT_INCOMPLETE" },
    });
  });

  it("menolak tanpa token", async () => {
    const response = await call("/api/v1/products/01J00000000000000000000000/image-prompt", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
  });
});

describe("router — mengulang pekerjaan gagal", () => {
  it("mengirim kembali pekerjaan teks ke antrean setelah statusnya dipulihkan", async () => {
    // TC-I-14: tombol coba lagi harus benar-benar memicu konsumen, bukan hanya mengubah D1.
    const token = await login("+628110000599");
    const productId = await createProduct(token);
    const jobId = ulid();
    await env.DB.prepare(
      `INSERT INTO jobs (id, product_id, kind, status, locale, attempt, progress, error_code, created_at)
       VALUES (?, ?, 'copy', 'failed', 'id', 1, 0, 'COPY_GENERATE_FAILED', ?)`,
    ).bind(jobId, productId, NOW_MS).run();

    const enqueued: unknown[] = [];
    const queueEnv = {
      ...env,
      JOBS: {
        sendBatch: async (messages: readonly { readonly body: unknown }[]) => {
          enqueued.push(...messages.map((message) => message.body));
        },
      } as unknown as typeof env.JOBS,
    };
    const response = await worker.fetch(
      new Request(`https://api.example/api/v1/products/${productId}/jobs/${jobId}/retry`,
        auth(token, { method: "POST" })),
      queueEnv,
    );

    expect(response.status).toBe(200);
    expect(enqueued).toEqual([{ jobId, productId, kind: "copy" }]);
    const job = await env.DB.prepare("SELECT status, attempt FROM jobs WHERE id = ?")
      .bind(jobId).first<{ status: string; attempt: number }>();
    expect(job).toEqual({ status: "queued", attempt: 1 });
  });
});

describe("router — pengajuan tinjauan", () => {
  it("memajukan processing menjadi review agar publish dapat berjalan", async () => {
    // TC-I-19. Tanpa endpoint ini tidak ada penggerak transisi
    // processing → review, dan publish selalu menjawab FORBIDDEN.
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);
    await env.DB.prepare("UPDATE products SET status = 'processing' WHERE id = ?")
      .bind(productId)
      .run();

    const submitted = await call(`/api/v1/products/${productId}/submit`, auth(token, { method: "POST" }));
    expect(submitted.status).toBe(200);
    expect((await json(submitted)) as { data: { status: string } }).toMatchObject({
      data: { status: "review" },
    });

    const row = await env.DB.prepare("SELECT status FROM products WHERE id = ?")
      .bind(productId)
      .first<{ status: string }>();
    expect(row?.status).toBe("review");
  });

  it("menolak pengajuan kedua karena status sudah review", async () => {
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);
    await env.DB.prepare("UPDATE products SET status = 'processing' WHERE id = ?")
      .bind(productId)
      .run();

    await call(`/api/v1/products/${productId}/submit`, auth(token, { method: "POST" }));
    const repeated = await call(`/api/v1/products/${productId}/submit`, auth(token, { method: "POST" }));

    expect(repeated.status).toBe(403);
  });

  it("menolak publish langsung dari processing", async () => {
    // Mengunci penjagaan mesin status: publish hanya dari review.
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);
    await env.DB.prepare("UPDATE products SET status = 'processing' WHERE id = ?")
      .bind(productId)
      .run();

    const response = await call(
      `/api/v1/products/${productId}/publish`,
      auth(token, {
        method: "POST",
        body: JSON.stringify({ consentConfirmed: true }),
      }),
    );

    expect(response.status).toBe(403);
  });
});

describe("router — alur terbit sampai katalog publik", () => {
  it("menyimpan foto, menerbitkan hasil tinjauan, lalu menyajikannya kepada pembeli", async () => {
    // TC-I-01, TC-I-05, TC-I-15, TC-I-18, TC-I-19.
    // Konten AI disemai setelah foto; penyedia eksternal diuji terpisah.
    const token = await login("+628110000503");
    const productId = await createProduct(token);

    const ticketResponse = await call(
      `/api/v1/products/${productId}/media/upload-url`,
      auth(token, {
        method: "POST",
        body: JSON.stringify({ kind: "photo_original", mimeType: "image/jpeg", bytes: JPEG_BYTES.length }),
      }),
    );
    expect(ticketResponse.status).toBe(200);
    const ticket = (await json(ticketResponse)) as { data: { mediaId: string; uploadUrl: string } };

    const uploaded = await call(ticket.data.uploadUrl.replace("https://api.example", ""), {
      method: "PUT",
      body: JPEG_BYTES,
      headers: { "Content-Length": String(JPEG_BYTES.length) },
    });
    expect(uploaded.status).toBe(200);
    const confirmed = await call(
      `/api/v1/products/${productId}/media/${ticket.data.mediaId}/confirm`,
      auth(token, { method: "POST" }),
    );
    expect(confirmed.status).toBe(200);

    const primary = await call(
      `/api/v1/products/${productId}/media/${ticket.data.mediaId}`,
      auth(token, { method: "PATCH", body: JSON.stringify({ isPrimary: true, altText: "Tas kulit buatan tangan" }) }),
    );
    expect(primary.status).toBe(200);

    await env.DB.prepare(
      `INSERT INTO product_content
         (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
       VALUES (?, ?, 'id', ?, ?, ?, ?, ?, 'ai', ?)`,
    )
      .bind(
        ulid(),
        productId,
        "Tas Kulit Uji",
        "Tas kulit ini dijahit tangan oleh pengrajin selama tiga hari.",
        JSON.stringify(["Kulit sapi nabati", "Jahitan tangan"]),
        "Tas kulit buatan tangan.",
        JSON.stringify(["tas kulit"]),
        NOW_MS,
      )
      .run();
    await env.DB.prepare("UPDATE products SET status = 'processing' WHERE id = ?")
      .bind(productId)
      .run();

    const submitted = await call(`/api/v1/products/${productId}/submit`, auth(token, { method: "POST" }));
    expect(submitted.status).toBe(200);
    const consented = await call(
      "/api/v1/consent",
      auth(token, { method: "POST", body: JSON.stringify({ kind: "publication", granted: true }) }),
    );
    expect(consented.status).toBe(200);

    const published = await call(
      `/api/v1/products/${productId}/publish`,
      auth(token, { method: "POST", body: JSON.stringify({ consentConfirmed: true }) }),
    );
    expect(published.status).toBe(200);
    const publishedBody = (await json(published)) as { data: { slug: string } };
    expect(publishedBody.data.slug).toMatch(/^tas-kulit-uji-[a-z0-9]+$/);

    const buyerResponse = await call(`/api/v1/public/catalog/${publishedBody.data.slug}`);
    expect(buyerResponse.status).toBe(200);
    const buyerCatalog = (await json(buyerResponse)) as {
      data: { name: string; artisan: { displayName: string | null }; media: { url: string }[] };
    };
    expect(buyerCatalog.data.name).toBe("Tas Kulit Uji");
    expect(buyerCatalog.data.artisan.displayName).toBe("Pengrajin");
    expect(buyerCatalog.data.media[0]?.url).toMatch(/^https:\/\/api\.example\/api\/v1\/media\//);
    const photoUrl = buyerCatalog.data.media[0]?.url;
    if (photoUrl === undefined) throw new Error("Katalog publik tidak mengembalikan URL foto");
    const photoResponse = await call(new URL(photoUrl).pathname);
    expect(photoResponse.status).toBe(200);
    expect(photoResponse.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await photoResponse.arrayBuffer())).toEqual(JPEG_BYTES);
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
    // Kunci berasal dari binding lingkungan: konfigurasi uji menyediakan
    // nilai tetap, sementara pengembangan lokal boleh memakai `.dev.vars`.
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

describe("router — unggahan hasil Studio Agent", () => {
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  async function runningImageJob(productId: string, jobId: string): Promise<string> {
    await env.DB.prepare(
      `INSERT INTO jobs (id, product_id, kind, status, attempt, progress, created_at)
       VALUES (?, ?, 'image', 'running', 1, 0, ?)`,
    )
      .bind(jobId, productId, NOW_MS)
      .run();
    return jobId;
  }

  function agentHeaders(agentKey: string): Record<string, string> {
    return { "X-Agent-Key": agentKey, "Content-Type": "application/json" };
  }

  it("menerbitkan URL, menerima berkas, lalu mengonfirmasi hasilnya", async () => {
    // TC-SA-08. Sebelum rute ini ada, agen memakai rute sesi dan selalu
    // ditolak 401 — keberhasilan Gemini tidak pernah tercatat.
    const agentKey = env.AGENT_SHARED_KEY ?? "";
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);
    const jobId = await runningImageJob(productId, "01J8ZQFX9K7YWVTN3MABCDJ910");

    const requested = await call(`/api/v1/agent/jobs/${jobId}/upload-url`, {
      method: "POST",
      headers: agentHeaders(agentKey),
      body: JSON.stringify({ mimeType: "image/png", bytes: PNG_BYTES.length }),
    });
    expect(requested.status).toBe(200);
    const ticket = (await json(requested)) as { data: { mediaId: string; uploadUrl: string } };

    await call(ticket.data.uploadUrl.replace("https://api.example", ""), {
      method: "PUT",
      body: PNG_BYTES,
      headers: { "Content-Length": String(PNG_BYTES.length) },
    });

    const confirmed = await call(`/api/v1/agent/jobs/${jobId}/confirm-upload`, {
      method: "POST",
      headers: agentHeaders(agentKey),
      body: JSON.stringify({ mediaId: ticket.data.mediaId }),
    });
    const confirmedBody = (await json(confirmed)) as { data: { mediaId: string; r2Key: string } };

    expect(confirmed.status).toBe(200);
    expect(confirmedBody.data.mediaId).toBe(ticket.data.mediaId);
    // Kunci hasil selalu berawalan studio-, tidak pernah menimpa foto asli.
    expect(confirmedBody.data.r2Key).toContain("/studio-");

    await env.DB.prepare(
      `INSERT INTO media_assets (id, product_id, kind, r2_key, mime_type, bytes, is_primary, upload_status, created_at)
       VALUES (?, ?, 'photo_original', ?, 'image/png', ?, 1, 'confirmed', ?)`,
    ).bind(ulid(), productId, `products/${productId}/original-smoke.png`, PNG_BYTES.length, NOW_MS).run();
    const completed = await call(`/api/v1/agent/jobs/${jobId}/complete`, {
      method: "POST",
      headers: agentHeaders(agentKey),
      body: JSON.stringify({ r2Key: confirmedBody.data.r2Key, durationMs: 12_000 }),
    });
    expect(completed.status).toBe(200);
    const media = await env.DB.prepare(
      "SELECT kind, is_primary FROM media_assets WHERE product_id = ? ORDER BY kind",
    ).bind(productId).all<{ kind: string; is_primary: number }>();
    expect(media.results).toEqual([
      { kind: "photo_original", is_primary: 0 },
      { kind: "photo_studio", is_primary: 1 },
    ]);
  });

  it("menolak tanpa kunci agen", async () => {
    const response = await call(
      "/api/v1/agent/jobs/01J8ZQFX9K7YWVTN3MABCDJ910/upload-url",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: "image/png", bytes: 8 }),
      },
    );

    expect(response.status).toBe(403);
  });

  it("menolak pekerjaan yang tidak ada", async () => {
    const agentKey = env.AGENT_SHARED_KEY ?? "";
    const response = await call(
      "/api/v1/agent/jobs/01J00000000000000000000000/upload-url",
      {
        method: "POST",
        headers: agentHeaders(agentKey),
        body: JSON.stringify({ mimeType: "image/png", bytes: 8 }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("menolak konfirmasi aset milik produk lain", async () => {
    // TC-SEC-10 untuk jalur agen: mediaId produk A tidak dapat dipakai
    // menyelesaikan pekerjaan produk B.
    const agentKey = env.AGENT_SHARED_KEY ?? "";
    const token = await login(ARTISAN_PHONE);
    const productId = await createProduct(token);
    const jobId = await runningImageJob(productId, "01J8ZQFX9K7YWVTN3MABCDJ912");
    const otherProductId = await createProduct(token);

    const requested = await call(`/api/v1/agent/jobs/${jobId}/upload-url`, {
      method: "POST",
      headers: agentHeaders(agentKey),
      body: JSON.stringify({ mimeType: "image/png", bytes: PNG_BYTES.length }),
    });
    const ticket = (await json(requested)) as { data: { mediaId: string; uploadUrl: string } };

    await call(ticket.data.uploadUrl.replace("https://api.example", ""), {
      method: "PUT",
      body: PNG_BYTES,
      headers: { "Content-Length": String(PNG_BYTES.length) },
    });

    // Asetnya milik produk pertama; pekerjaan palsu untuk produk kedua
    // dibuat langsung di basis data untuk menguji batasnya.
    const otherJobId = "01J8ZQFX9K7YWVTN3MABCDJ911";
    await env.DB.prepare(
      `INSERT INTO jobs (id, product_id, kind, status, attempt, progress, created_at)
       VALUES (?, ?, 'image', 'running', 1, 0, ?)`,
    )
      .bind(otherJobId, otherProductId, NOW_MS)
      .run();

    const confirmed = await call(`/api/v1/agent/jobs/${otherJobId}/confirm-upload`, {
      method: "POST",
      headers: agentHeaders(agentKey),
      body: JSON.stringify({ mediaId: ticket.data.mediaId }),
    });

    expect(confirmed.status).toBe(404);
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
