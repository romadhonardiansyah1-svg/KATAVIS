/**
 * Uji integrasi router — TC-SEC-19, TC-SEC-20, dan jalur end-to-end.
 *
 * Dijalankan di workerd dengan D1 dan R2 Miniflare. Yang diuji di sini hanya
 * dapat diuji di sini: apakah seluruh modul benar-benar tersambung. Setiap
 * modul sudah punya ujinya sendiri; yang belum terbukti sampai sekarang
 * adalah bahwa mereka saling bicara.
 *
 * Dijalankan dengan: pnpm run test:integration
 */

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "./index";

const PHONE = "+628110000401";
const NOW_MS = Date.now();

const ALLOWED_ORIGIN = "https://katavis.example";

function api(path: string, init: RequestInit = {}): Request {
  return new Request(`https://api.example/api/v1${path}`, init);
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(api(path, init), env);
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

/** Menyemai tantangan OTP langsung, karena kodenya dibangkitkan di dalam handler. */
async function seedOtpChallenge(phone: string, code: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO otp_codes (phone, code_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       code_hash = excluded.code_hash,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
  )
    .bind(phone, await sha256Hex(code), NOW_MS, NOW_MS + 300_000)
    .run();
}

async function login(): Promise<string> {
  await seedOtpChallenge(PHONE, "123456");

  const response = await call("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone: PHONE, code: "123456" }),
  });

  const body = (await json(response)) as {
    ok: boolean;
    data: { accessToken: string };
  };

  expect(body.ok).toBe(true);
  return body.data.accessToken;
}

function authorized(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("router — header keamanan", () => {
  it("memasang header keamanan pada setiap respons", async () => {
    // TC-SEC-19
    const responses = [
      await call("/health"),
      await call("/produk-tidak-ada"),
      await call("/products", { method: "POST" }),
    ];

    for (const response of responses) {
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
  });
});

describe("router — CORS", () => {
  it("mengizinkan asal yang terdaftar", async () => {
    // TC-SEC-20
    const previous = env.ALLOWED_ORIGINS ?? "";
    env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;

    const response = await call("/health", { headers: { Origin: ALLOWED_ORIGIN } });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);

    env.ALLOWED_ORIGINS = previous;
  });

  it("tidak memberi header apa pun untuk asal yang tidak terdaftar", async () => {
    // TC-SEC-20
    const previous = env.ALLOWED_ORIGINS ?? "";
    env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;

    const response = await call("/health", { headers: { Origin: "https://penyerang.example" } });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();

    env.ALLOWED_ORIGINS = previous;
  });

  it("menjawab praperiksa tanpa menuntut autentikasi", async () => {
    // Peramban mengirim OPTIONS tanpa kredensial; menolaknya berarti setiap
    // permintaan lintas asal gagal sebelum sempat dicoba.
    const previous = env.ALLOWED_ORIGINS ?? "";
    env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;

    const response = await call("/products", {
      method: "OPTIONS",
      headers: { Origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");

    env.ALLOWED_ORIGINS = previous;
  });
});

describe("router — pencocokan rute", () => {
  it("mengembalikan 404 untuk rute yang tidak ada", async () => {
    const response = await call("/tidak-ada");
    expect(response.status).toBe(404);
    expect((await json(response)).ok).toBe(false);
  });

  it("menolak metode yang tidak dilayani pada rute yang ada", async () => {
    const response = await call("/products", { method: "PUT" });
    expect(response.status).toBe(403);
  });

  it("membedakan ULID yang tidak sah sebagai tidak ditemukan", async () => {
    const token = await login();
    const response = await call("/products/bukan-ulid", authorized(token));
    expect(response.status).toBe(404);
  });
});

describe("router — sesi", () => {
  it("menolak rute bersesi tanpa token", async () => {
    const response = await call("/products");
    expect(response.status).toBe(401);
  });

  it("menolak token yang ditandatangani kunci lain", async () => {
    const response = await call("/products", authorized("a.b.c"));
    expect(response.status).toBe(401);
  });

  it("menerima sesi yang sah", async () => {
    const token = await login();
    const response = await call("/products", authorized(token));
    expect(response.status).toBe(200);
  });
});

describe("router — alur inti", () => {
  it("membuat, membaca, dan menerbitkan produk", async () => {
    const token = await login();

    const created = await call(
      "/products",
      authorized(token, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase() } }),
    );

    expect(created.status).toBe(200);
    const createdBody = (await json(created)) as { data: { id: string; status: string } };
    expect(createdBody.data.status).toBe("draft");
    const productId = createdBody.data.id;

    const read = await call(`/products/${productId}`, authorized(token));
    expect(read.status).toBe(200);
    const readBody = (await json(read)) as { data: { id: string; status: string } };
    expect(readBody.data.id).toBe(productId);

    // Tanpa transkrip yang ditinjau, pemrosesan ditolak — ADR-008 di
    // tingkat server, lewat router.
    const generate = await call(
      `/products/${productId}/generate`,
      authorized(token, {
        method: "POST",
        body: JSON.stringify({ tasks: ["copy"], locales: ["id"] }),
      }),
    );
    expect(generate.status).toBe(409);
    expect((await json(generate)) as { error: { code: string } }).toMatchObject({
      error: { code: "TRANSCRIPT_NOT_REVIEWED" },
    });

    // Menerbitkan tanpa persetujuan ditolak.
    const publish = await call(
      `/products/${productId}/publish`,
      authorized(token, { method: "POST", body: JSON.stringify({ consentConfirmed: true }) }),
    );
    expect((await json(publish)) as { error: { code: string } }).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("mencatat setiap aksi ke activity_log", async () => {
    const token = await login();

    await call(
      "/products",
      authorized(token, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID().replace(/-/g, "").slice(0, 26).toUpperCase() },
      }),
    );

    const rows = await env.DB.prepare(
      "SELECT action, on_behalf_of FROM activity_log WHERE action = 'create_product'",
    ).all<{ action: string; on_behalf_of: string | null }>();

    expect(rows.results.length).toBeGreaterThan(0);
    // Pengrajin bertindak atas namanya sendiri (TC-I-10).
    expect(rows.results[0]?.on_behalf_of).toBeNull();
  });

  it("menyimpan dan membaca kembali preferensi aksesibilitas", async () => {
    const token = await login();
    const profile = { visual: true, hearing: false, motor: true, cognitive: false, voice: false };

    const written = await call(
      "/me/a11y-profile",
      authorized(token, { method: "PUT", body: JSON.stringify(profile) }),
    );
    expect(written.status).toBe(200);

    const row = await env.DB.prepare(
      "SELECT a11y_profile FROM users WHERE phone = ?",
    )
      .bind(PHONE)
      .first<{ a11y_profile: string | null }>();

    expect(JSON.parse(row?.a11y_profile ?? "null")).toEqual(profile);
  });
});

describe("router — katalog publik", () => {
  it("mengembalikan 404 untuk produk yang belum terbit", async () => {
    // 403 akan membocorkan keberadaan produk (kontrak API bagian 10).
    const response = await call("/public/catalog/tidak-ada");
    expect(response.status).toBe(404);
    expect((await json(response)) as { error: { code: string } }).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("tidak menuntut autentikasi", async () => {
    const response = await call("/public/catalog/tidak-ada");
    expect(response.status).toBe(404);
    // Bukan 401: titik akhir publik memang tidak bersesi.
    expect(response.status).not.toBe(401);
  });

  it("memperlakukan ?locale= kosong seperti tanpa parameter", async () => {
    // Kontrak bagian 10 menjanjikan versi bawaan `id` untuk permintaan tanpa
    // bahasa. `searchParams.get()` mengembalikan "" untuk `?locale=`, bukan
    // null — jadi `?? "id"` tidak menyentuhnya, dan "" ditolak sebagai
    // bahasa yang tidak dikenal. Yang salah bukan 404-nya, melainkan bahwa
    // 404 itu bertentangan dengan kontraknya sendiri.
    const bare = await call("/public/catalog/tidak-ada");
    const empty = await call("/public/catalog/tidak-ada?locale=");

    // Keduanya harus sampai ke cabang yang sama: produknya yang tidak ada,
    // bukan bahasanya.
    expect(empty.status).toBe(bare.status);
    expect((await json(empty)) as unknown).toEqual((await json(bare)) as unknown);
  });

  it("menjawab 404 untuk bahasa di luar daftar, sama seperti produk yang tidak ada", async () => {
    // Penebak tidak boleh dapat membedakan "slug benar, bahasa salah" dari
    // "slug salah" — perbedaan itu memberi tahu bahwa slug-nya ada.
    const unknownLocale = await call("/public/catalog/tidak-ada?locale=fr");
    const unknownSlug = await call("/public/catalog/tidak-ada?locale=id");

    expect(unknownLocale.status).toBe(404);
    expect(unknownLocale.status).toBe(unknownSlug.status);
    expect((await json(unknownLocale)) as unknown).toEqual((await json(unknownSlug)) as unknown);
  });
});

describe("router — bentuk respons seragam", () => {
  it("selalu memakai amplop { ok, data } atau { ok, error }", async () => {
    const token = await login();

    const responses = [
      await call("/health"),
      await call("/products", authorized(token)),
      await call("/tidak-ada"),
    ];

    for (const response of responses) {
      const body = await json(response);
      expect(body).toHaveProperty("ok");
      if (body.ok === true) {
        expect(body).toHaveProperty("data");
      } else {
        expect(body).toHaveProperty("error");
        const error = body.error as Record<string, unknown>;
        // Tiga bidang wajib, dan workSafe selalu true (AGENTS.md aturan 2).
        expect(error).toHaveProperty("code");
        expect(error).toHaveProperty("message");
        expect(error).toHaveProperty("action");
        expect(error.workSafe).toBe(true);
      }
    }
  });
});
