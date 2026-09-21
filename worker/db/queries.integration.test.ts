/**
 * Uji integrasi lapisan kueri — TC-PERF-04.
 *
 * Dijalankan di workerd dengan D1 Miniflare yang sesungguhnya, dan
 * **menghitung kueri nyata**. Tiruan D1 akan menyembunyikan justru masalah
 * yang dicari: jumlah kueri bergantung pada apa yang dilakukan SQLite,
 * bukan pada apa yang tampak di kode. Prompt P6 menyebutnya sebagai jebakan
 * yang harus dihindari, dan ADR-006 menegaskan batas 50 kueri ini tidak
 * dapat diserahkan pada disiplin.
 *
 * Dijalankan dengan: pnpm run test:integration
 */

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { LIMITS } from "../../lib/schemas";

import {
  QueryBudgetExceeded,
  assertWithinBudget,
  createDb,
  createQueryCounter,
} from "./counter";
import { listProducts, loadProductDetail } from "./queries";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    readonly TEST_MIGRATIONS: { name: string; queries: string[] }[];
  }
}

const NOW_MS = 1_700_000_000_000;
const PRODUCT_COUNT = 20;

const ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDE001";

function productId(index: number): string {
  return `01J8ZQFX9K7YWVTN3MABCDP${String(index).padStart(3, "0")}`;
}

function contentId(index: number): string {
  return `01J8ZQFX9K7YWVTN3MABCDK${String(index).padStart(3, "0")}`;
}

function mediaId(index: number): string {
  return `01J8ZQFX9K7YWVTN3MABCDM${String(index).padStart(3, "0")}`;
}

function jobId(index: number): string {
  return `01J8ZQFX9K7YWVTN3MABCDJ${String(index).padStart(3, "0")}`;
}

function statusOf(index: number): string {
  if (index === 1) return "review";
  return index % 2 === 0 ? "published" : "draft";
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO users (id, phone, display_name, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(ARTISAN_ID, "+628110000101", "Pengrajin Uji", "artisan", NOW_MS),
  ];

  for (let index = 1; index <= PRODUCT_COUNT; index += 1) {
    const id = productId(index);

    statements.push(
      env.DB.prepare(
        `INSERT INTO products (id, artisan_id, status, slug, progress, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        ARTISAN_ID,
        statusOf(index),
        `produk-${index}`,
        100,
        NOW_MS + index,
        NOW_MS + index,
      ),
    );

    statements.push(
      env.DB.prepare(
        `INSERT INTO product_content
           (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        contentId(index),
        id,
        "id",
        `Produk ${index}`,
        `Cerita produk ${index}`,
        '["Spesifikasi"]',
        null,
        null,
        "ai",
        NOW_MS + index,
      ),
    );

    statements.push(
      env.DB.prepare(
        `INSERT INTO media_assets
           (id, product_id, kind, r2_key, mime_type, bytes, alt_text, provider, is_primary, upload_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        mediaId(index),
        id,
        "photo_studio",
        `products/${id}/studio-1.webp`,
        "image/webp",
        184_320,
        `Foto produk ${index}`,
        "workers_ai",
        1,
        "confirmed",
        NOW_MS + index,
      ),
    );
  }

  // Produk pertama dilengkapi supaya kelima tabel benar-benar berisi.
  statements.push(
    env.DB.prepare(
      `INSERT INTO product_content
         (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "01J8ZQFX9K7YWVTN3MABCDK900",
      productId(1),
      "en",
      "Nusantara Bag",
      "Story in English",
      null,
      null,
      null,
      "ai",
      NOW_MS + 500,
    ),
  );

  // Unggahan yang belum dikonfirmasi tidak boleh muncul di layar produk.
  statements.push(
    env.DB.prepare(
      `INSERT INTO media_assets
         (id, product_id, kind, r2_key, mime_type, bytes, alt_text, provider, is_primary, upload_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      mediaId(900),
      productId(1),
      "photo_original",
      `products/${productId(1)}/asli.jpg`,
      "image/jpeg",
      900_000,
      null,
      null,
      0,
      "pending",
      NOW_MS + 600,
    ),
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO jobs (id, product_id, kind, status, provider, attempt, progress, error_code, created_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      jobId(901),
      productId(1),
      "image",
      "succeeded",
      "workers_ai",
      1,
      100,
      null,
      NOW_MS,
      NOW_MS + 1000,
      NOW_MS + 13_000,
    ),
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO jobs (id, product_id, kind, status, provider, attempt, progress, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      jobId(902),
      productId(1),
      "copy",
      "failed",
      "9router",
      3,
      0,
      "COPY_GENERATE_FAILED",
      NOW_MS + 2000,
    ),
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO transcripts (id, product_id, text, locale, reviewed, edited, provider, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "01J8ZQFX9K7YWVTN3MABCDT900",
      productId(1),
      "Saya membuat tas dari kulit kerbau.",
      "id",
      1,
      1,
      "groq",
      28_400,
      NOW_MS,
    ),
  );

  await env.DB.batch(statements);
});

describe("db — kueri nyata terhadap D1", () => {
  it("mengambil produk, konten, media, pekerjaan, dan transkrip dalam satu invocation", async () => {
    // TC-PERF-04
    const counter = createQueryCounter();
    const db = createDb(env.DB, counter);

    const detail = await loadProductDetail(db, productId(1));

    assertWithinBudget(counter);
    expect(counter.total()).toBe(5);
    expect(counter.total()).toBeLessThan(LIMITS.MAX_D1_QUERIES_PER_REQUEST);

    expect(detail?.id).toBe(productId(1));
    expect(detail?.artisanId).toBe(ARTISAN_ID);
    expect(detail?.status).toBe("review");
    expect(detail?.content.size).toBe(2);
    expect(detail?.content.get("id")?.specs).toEqual(["Spesifikasi"]);
    expect(detail?.content.get("en")?.name).toBe("Nusantara Bag");
    // Hanya unggahan yang dikonfirmasi yang muncul.
    expect(detail?.media).toHaveLength(1);
    expect(detail?.media[0]?.isPrimary).toBe(true);
    expect(detail?.jobs).toHaveLength(2);
    // Terbaru lebih dulu, jadi pekerjaan yang gagal ada di indeks 0.
    expect(detail?.jobs[0]?.errorCode).toBe("COPY_GENERATE_FAILED");
    expect(detail?.jobs[1]?.errorCode).toBeNull();
    expect(detail?.transcript?.text).toBe("Saya membuat tas dari kulit kerbau.");
    expect(detail?.transcript?.edited).toBe(true);
  });

  it("mendaftar 20 produk dengan satu kueri, bukan dua puluh", async () => {
    // TC-PERF-04
    // Inilah bentuk N+1 yang paling mudah terjadi pada daftar: satu kueri
    // untuk halaman, lalu satu kueri per baris untuk judul dan fotonya.
    const counter = createQueryCounter();
    const db = createDb(env.DB, counter);

    const page = await listProducts(db, {
      artisanId: ARTISAN_ID,
      locale: "id",
      limit: 20,
    });

    expect(page.items).toHaveLength(20);
    expect(counter.total()).toBe(1);
    assertWithinBudget(counter);

    // Judul dan foto utama ikut tanpa kueri susulan.
    for (const item of page.items) {
      expect(item.name).not.toBeNull();
      expect(item.primaryPhotoKey).not.toBeNull();
    }
  });

  it("membagi halaman dengan kursor tanpa tumpang tindih", async () => {
    const counter = createQueryCounter();
    const db = createDb(env.DB, counter);

    const first = await listProducts(db, {
      artisanId: ARTISAN_ID,
      locale: "id",
      limit: 5,
    });
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) return;

    const second = await listProducts(db, {
      artisanId: ARTISAN_ID,
      locale: "id",
      limit: 5,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(5);

    const firstIds = new Set(first.items.map((item) => item.id));
    for (const item of second.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }

    // Dua halaman, dua kueri — bukan dua halaman yang masing-masing
    // memindai seluruh tabel karena OFFSET.
    expect(counter.total()).toBe(2);
  });

  it("menyaring menurut status tanpa kueri tambahan", async () => {
    const counter = createQueryCounter();
    const db = createDb(env.DB, counter);

    const published = await listProducts(db, {
      artisanId: ARTISAN_ID,
      locale: "id",
      limit: 20,
      status: "published",
    });

    // 20 produk: 1 berstatus review, 10 terbit (indeks genap), 9 draf.
    expect(published.items).toHaveLength(10);
    for (const item of published.items) {
      expect(item.status).toBe("published");
    }
    expect(counter.total()).toBe(1);
  });

  it("tidak pernah mengulang kueri yang sama pada satu invocation", async () => {
    // Tanda tangan pola N+1: kueri yang sama dijalankan berkali-kali.
    const counter = createQueryCounter();
    const db = createDb(env.DB, counter);

    await loadProductDetail(db, productId(1));
    await listProducts(db, { artisanId: ARTISAN_ID, locale: "id", limit: 20 });

    const queries = counter.log();
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries).toHaveLength(6);
  });

  it("penghitung menangkap pola N+1 yang disengaja", async () => {
    // Bukti bahwa penghitungnya benar-benar bekerja. Tanpa uji ini, seluruh
    // uji di atas dapat lulus hanya karena penghitungnya tidak menghitung
    // apa pun.
    const counter = createQueryCounter();
    const db = createDb(env.DB, counter);
    const ids = Array.from({ length: 30 }, (_value, index) => productId(index + 1));

    for (const id of ids) {
      await db.first({
        query: "SELECT id FROM products WHERE id = ?",
        params: [id],
      });
    }

    expect(counter.total()).toBe(30);
    expect(() => assertWithinBudget(counter)).toThrow(QueryBudgetExceeded);
    // Seluruh 30 kueri teksnya sama — persis pola yang dilarang.
    expect(new Set(counter.log()).size).toBe(1);
  });

  it("menghitung setiap pernyataan di dalam batch sebagai satu kueri", async () => {
    // D1 menghitung pernyataan, bukan putaran. Batch menghemat putaran
    // jaringan, bukan kuota — dan penghitungnya harus mencerminkan itu.
    const counter = createQueryCounter();
    const db = createDb(env.DB, counter);

    await db.batch([
      { query: "SELECT id FROM products WHERE id = ?", params: [productId(1)] },
      { query: "SELECT id FROM products WHERE id = ?", params: [productId(2)] },
      { query: "SELECT id FROM products WHERE id = ?", params: [productId(3)] },
    ]);

    expect(counter.total()).toBe(3);
  });

  it("memakai indeks untuk kueri detail, bukan pemindaian penuh", async () => {
    // Bukti tambahan bahwa kueri detail menyentuh kunci utama. Kalau
    // `products.id` tidak lagi dipakai sebagai kunci, EXPLAIN akan berubah
    // dan uji ini menangkapnya sebelum demo.
    const plan = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM products WHERE id = ?",
    )
      .bind(productId(1))
      .all<{ detail: string }>();

    const detail = plan.results.map((row) => row.detail).join(" ");
    expect(detail.toLowerCase()).toContain("products");
    expect(detail.toLowerCase()).not.toContain("scan products");
  });
});
