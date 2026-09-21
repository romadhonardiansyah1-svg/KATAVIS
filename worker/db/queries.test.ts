/**
 * Uji kueri produk — TC-PERF-04.
 *
 * Ganda `Db` di sini adalah antarmuka milik kita sendiri, bukan tiruan D1:
 * yang diuji adalah BENTUK kuerinya — berapa pernyataan, dalam berapa
 * putaran, dengan parameter berurutan apa. Itu yang menentukan jumlah kueri
 * per invocation, dan itu dapat diperiksa tanpa basis data.
 *
 * Jumlah kueri terhadap D1 sungguhan ada di `queries.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { QUERY_BUDGET, type Db, type DbStatement } from "./counter";
import { findPublicCatalogEntry, listProducts, loadProductDetail } from "./queries";

const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDP001";
const ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDE001";
const NOW_MS = 1_700_000_000_000;

const PRODUCT_ROW = {
  id: PRODUCT_ID,
  artisan_id: ARTISAN_ID,
  status: "review",
  slug: "tas-kulit-nusantara",
  progress: 80,
  created_at: NOW_MS,
  updated_at: NOW_MS + 100_000,
  published_at: null,
};

const CONTENT_ID = {
  locale: "id",
  name: "Tas Kulit Nusantara",
  story: "Dibuat dari kulit sapi nabati.",
  specs: '["Kulit sapi nabati","Jahitan tangan"]',
  social_copy: "Tas kulit asli dari pengrajin lokal.",
  seo_keywords: '["tas kulit","tas tangan"]',
  source: "ai_edited",
  updated_at: NOW_MS + 90_000,
};

const CONTENT_EN = {
  locale: "en",
  name: "Nusantara Leather Bag",
  story: "Made from vegetable-tanned cowhide.",
  specs: null,
  social_copy: null,
  seo_keywords: null,
  source: "ai",
  updated_at: NOW_MS + 80_000,
};

const MEDIA_ROW = {
  id: "01J8ZQFX9K7YWVTN3MABCDM001",
  kind: "photo_studio",
  r2_key: `products/${PRODUCT_ID}/studio-1.webp`,
  mime_type: "image/webp",
  bytes: 184_320,
  alt_text: "Tas kulit cokelat di atas marmer",
  provider: "workers_ai",
  is_primary: 1,
};

const JOB_ROW = {
  id: "01J8ZQFX9K7YWVTN3MABCDJ001",
  kind: "image",
  status: "succeeded",
  provider: "workers_ai",
  progress: 100,
  attempt: 1,
  error_code: null,
  created_at: NOW_MS,
  started_at: NOW_MS + 1000,
  completed_at: NOW_MS + 13_000,
};

const TRANSCRIPT_ROW = {
  text: "Saya membuat tas dari kulit kerbau.",
  locale: "id",
  reviewed: 1,
  edited: 1,
  provider: "groq",
  duration_ms: 28_400,
};

interface FakeDb {
  readonly db: Db;
  /** Setiap batch yang dijalankan, berurutan. */
  readonly batches: (readonly DbStatement[])[];
  /** Setiap pernyataan tunggal yang dijalankan. */
  readonly singles: DbStatement[];
}

function fakeDb(
  config: {
    readonly batchResults?: readonly (readonly unknown[])[];
    readonly allRows?: readonly unknown[];
  } = {},
): FakeDb {
  const batches: (readonly DbStatement[])[] = [];
  const singles: DbStatement[] = [];

  return {
    batches,
    singles,
    db: {
      async first<TValue>(statement: DbStatement): Promise<TValue | null> {
        singles.push(statement);
        return null;
      },
      async all<TValue>(statement: DbStatement): Promise<TValue[]> {
        singles.push(statement);
        return [...(config.allRows ?? [])] as TValue[];
      },
      async run(statement: DbStatement): Promise<void> {
        singles.push(statement);
      },
      async batch(
        statements: readonly DbStatement[],
      ): Promise<readonly (readonly unknown[])[]> {
        batches.push(statements);
        return config.batchResults ?? statements.map(() => []);
      },
    },
  };
}

function detailResults(
  overrides: {
    readonly product?: readonly unknown[];
    readonly content?: readonly unknown[];
    readonly media?: readonly unknown[];
    readonly jobs?: readonly unknown[];
    readonly transcript?: readonly unknown[];
  } = {},
): readonly (readonly unknown[])[] {
  return [
    overrides.product ?? [PRODUCT_ROW],
    overrides.content ?? [CONTENT_ID, CONTENT_EN],
    overrides.media ?? [MEDIA_ROW],
    overrides.jobs ?? [JOB_ROW],
    overrides.transcript ?? [TRANSCRIPT_ROW],
  ];
}

describe("db — loadProductDetail", () => {
  it("mengambil lima tabel dalam SATU batch", async () => {
    // TC-PERF-04
    // Inilah inti aturan N+1: lima tabel, satu putaran, lima kueri. Kalau
    // suatu saat ini berubah menjadi lima `await` berurutan, jumlah
    // putarannya naik lima kali tanpa satu pun uji lain yang gagal.
    const fake = fakeDb({ batchResults: detailResults() });
    await loadProductDetail(fake.db, PRODUCT_ID);

    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(5);
    expect(fake.singles).toEqual([]);
    expect(fake.batches[0]?.length).toBeLessThan(QUERY_BUDGET);
  });

  it("mengelompokkan konten per bahasa", async () => {
    const fake = fakeDb({ batchResults: detailResults() });
    const detail = await loadProductDetail(fake.db, PRODUCT_ID);

    expect(detail?.content.size).toBe(2);
    expect(detail?.content.get("id")?.name).toBe("Tas Kulit Nusantara");
    expect(detail?.content.get("en")?.name).toBe("Nusantara Leather Bag");
  });

  it("mengurai specs dan seoKeywords dari kolom JSON", async () => {
    const fake = fakeDb({ batchResults: detailResults() });
    const detail = await loadProductDetail(fake.db, PRODUCT_ID);

    expect(detail?.content.get("id")?.specs).toEqual([
      "Kulit sapi nabati",
      "Jahitan tangan",
    ]);
    expect(detail?.content.get("id")?.seoKeywords).toEqual([
      "tas kulit",
      "tas tangan",
    ]);
    // Kolom NULL menjadi larik kosong, bukan null: antarmuka merender daftar
    // tanpa perlu memeriksa null terlebih dulu.
    expect(detail?.content.get("en")?.specs).toEqual([]);
  });

  it("menganggap kolom JSON yang rusak sebagai kosong", async () => {
    const fake = fakeDb({
      batchResults: detailResults({
        content: [{ ...CONTENT_ID, specs: "{bukan json", seo_keywords: '"teks"' }],
      }),
    });
    const detail = await loadProductDetail(fake.db, PRODUCT_ID);

    expect(detail?.content.get("id")?.specs).toEqual([]);
    expect(detail?.content.get("id")?.seoKeywords).toEqual([]);
  });

  it("menerjemahkan kolom 0/1 menjadi boolean dan memvalidasi enum", async () => {
    const fake = fakeDb({
      batchResults: detailResults({
        media: [MEDIA_ROW, { ...MEDIA_ROW, id: "01J8ZQFX9K7YWVTN3MABCDM002", kind: "video" }],
        jobs: [JOB_ROW, { ...JOB_ROW, id: "01J8ZQFX9K7YWVTN3MABCDJ002", kind: "video" }],
      }),
    });
    const detail = await loadProductDetail(fake.db, PRODUCT_ID);

    expect(detail?.media).toHaveLength(1);
    expect(detail?.media[0]?.isPrimary).toBe(true);
    expect(detail?.media[0]?.r2Key).toBe(`products/${PRODUCT_ID}/studio-1.webp`);
    // Jenis media di luar skema dilewati, bukan menggagalkan seluruh layar.
    expect(detail?.jobs).toHaveLength(1);
    expect(detail?.jobs[0]?.status).toBe("succeeded");
    expect(detail?.transcript?.edited).toBe(true);
    expect(detail?.transcript?.durationMs).toBe(28_400);
  });

  it("menolak kode galat yang tidak ada di katalog", async () => {
    const fake = fakeDb({
      batchResults: detailResults({
        jobs: [
          { ...JOB_ROW, error_code: "IMAGE_GENERATE_FAILED" },
          { ...JOB_ROW, id: "01J8ZQFX9K7YWVTN3MABCDJ003", error_code: "TIDAK_ADA" },
        ],
      }),
    });
    const detail = await loadProductDetail(fake.db, PRODUCT_ID);

    expect(detail?.jobs[0]?.errorCode).toBe("IMAGE_GENERATE_FAILED");
    expect(detail?.jobs[1]?.errorCode).toBeNull();
  });

  it("mengembalikan null bila produk tidak ada", async () => {
    const fake = fakeDb({ batchResults: detailResults({ product: [] }) });

    expect(await loadProductDetail(fake.db, PRODUCT_ID)).toBeNull();
    // Kelima kueri tetap dijalankan dalam satu batch: bentuknya tidak
    // bercabang menurut data yang ditemukan.
    expect(fake.batches[0]).toHaveLength(5);
  });

  it("mengembalikan null bila status di luar skema", async () => {
    const fake = fakeDb({
      batchResults: detailResults({ product: [{ ...PRODUCT_ROW, status: "terbit" }] }),
    });

    expect(await loadProductDetail(fake.db, PRODUCT_ID)).toBeNull();
  });
});

describe("db — listProducts", () => {
  function listRow(index: number): Record<string, unknown> {
    return {
      id: `01J8ZQFX9K7YWVTN3MABCDP${String(index).padStart(3, "0")}`,
      status: "published",
      name: `Produk ${index}`,
      primary_photo_key: `products/${index}/studio-1.webp`,
      progress: 100,
      updated_at: NOW_MS + index,
    };
  }

  it("memakai kursor keyset, bukan OFFSET", async () => {
    // TC-PERF-04
    const fake = fakeDb({ allRows: [] });
    await listProducts(fake.db, {
      artisanId: ARTISAN_ID,
      locale: "id",
      limit: 5,
      cursor: "01J8ZQFX9K7YWVTN3MABCDP100",
    });

    const statement = fake.singles[0]?.query ?? "";
    expect(statement).toContain("p.id < ?");
    expect(statement).not.toContain("OFFSET");
    // Kolomnya ditulis satu per satu, bukan SELECT *.
    expect(statement).not.toContain("SELECT *");
    // Satu pernyataan untuk seluruh halaman, bukan satu per baris.
    expect(fake.singles).toHaveLength(1);
  });

  it("menyusun parameter mengikuti urutan placeholder", async () => {
    const fake = fakeDb({ allRows: [] });
    await listProducts(fake.db, {
      artisanId: ARTISAN_ID,
      locale: "en",
      limit: 5,
      status: "published",
      cursor: "01J8ZQFX9K7YWVTN3MABCDP100",
    });

    // Placeholder pertama ada di SELECT (locale untuk subquery judul),
    // bukan di WHERE. Urutan yang tertukar akan mengembalikan judul bahasa
    // yang salah tanpa galat apa pun.
    expect(fake.singles[0]?.params).toEqual([
      "en",
      ARTISAN_ID,
      "published",
      "01J8ZQFX9K7YWVTN3MABCDP100",
      6,
    ]);
  });

  it("meminta satu baris ekstra untuk mengetahui adanya halaman berikutnya", async () => {
    const fake = fakeDb({ allRows: [] });
    await listProducts(fake.db, { artisanId: ARTISAN_ID, locale: "id", limit: 20 });

    // limit + 1, bukan COUNT(*) terpisah — satu kueri lebih murah daripada
    // dua, dan hasilnya sama pasti.
    expect(fake.singles[0]?.params).toEqual(["id", ARTISAN_ID, 21]);
  });

  it("memotong hasil ke limit dan menetapkan nextCursor", async () => {
    const fake = fakeDb({
      allRows: [listRow(3), listRow(2), listRow(1)],
    });
    const page = await listProducts(fake.db, {
      artisanId: ARTISAN_ID,
      locale: "id",
      limit: 2,
    });

    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.id).toBe("01J8ZQFX9K7YWVTN3MABCDP003");
    // Kursor adalah id baris terakhir yang DIKEMBALIKAN, bukan baris ekstra.
    expect(page.nextCursor).toBe("01J8ZQFX9K7YWVTN3MABCDP002");
  });

  it("tidak menetapkan nextCursor pada halaman terakhir", async () => {
    const fake = fakeDb({ allRows: [listRow(2), listRow(1)] });
    const page = await listProducts(fake.db, {
      artisanId: ARTISAN_ID,
      locale: "id",
      limit: 5,
    });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("melewati baris berstatus di luar skema tanpa merusak kursor", async () => {
    const fake = fakeDb({
      allRows: [listRow(3), { ...listRow(2), status: "terbit" }, listRow(1)],
    });
    const page = await listProducts(fake.db, {
      artisanId: ARTISAN_ID,
      locale: "id",
      limit: 2,
    });

    expect(page.items).toHaveLength(1);
    // Kursor tetap menunjuk baris terakhir halaman, bukan baris yang
    // dilewati — kalau tidak, satu baris rusak akan mengulang halaman.
    expect(page.nextCursor).toBe("01J8ZQFX9K7YWVTN3MABCDP002");
  });
});

describe("db — findPublicCatalogEntry", () => {
  const CATALOG_ROW = {
    id: PRODUCT_ID,
    slug: "tas-kulit-nusantara",
    name: "Tas Kulit Nusantara",
    story: "Tas ini dibuat dari kulit sapi samak nabati.",
    specs: '["Kulit sapi nabati","Dijahit tangan"]',
    display_name: "Irsyad",
  };

  function catalogResults(
    overrides: {
      readonly product?: readonly unknown[];
      readonly media?: readonly unknown[];
      readonly locales?: readonly unknown[];
    } = {},
  ): readonly (readonly unknown[])[] {
    return [
      overrides.product ?? [CATALOG_ROW],
      overrides.media ?? [{ r2_key: "products/p/foto-asli.jpg", alt_text: "Tas kulit" }],
      overrides.locales ?? [{ locale: "id" }, { locale: "en" }],
    ];
  }

  it("mengambil produk, media, dan daftar bahasa dalam SATU batch", async () => {
    // TC-PERF-04. Halaman pembeli adalah halaman yang paling sering dibuka
    // ulang; tiga kueri terpisah akan terasa tepat saat katalognya dibagikan.
    const fake = fakeDb({ batchResults: catalogResults() });

    await findPublicCatalogEntry(fake.db, "tas-kulit-nusantara", "id");

    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(3);
    expect(fake.singles).toHaveLength(0);
  });

  it("hanya mengembalikan produk yang sudah terbit", async () => {
    // TC-E2E-06. Produk draf menghasilkan 404, bukan 403 — 403 membocorkan
    // keberadaannya. Syarat itu ada di dalam SQL, dan itulah yang diperiksa.
    const fake = fakeDb({ batchResults: catalogResults() });

    await findPublicCatalogEntry(fake.db, "tas-kulit-nusantara", "id");

    const statements = fake.batches[0] ?? [];
    for (const statement of statements) {
      expect(statement.query).toContain("status = 'published'");
    }
  });

  it("memetakan baris menjadi entri katalog, termasuk specs sebagai larik", async () => {
    const fake = fakeDb({ batchResults: catalogResults() });

    const entry = await findPublicCatalogEntry(fake.db, "tas-kulit-nusantara", "id");

    expect(entry).toEqual({
      id: PRODUCT_ID,
      slug: "tas-kulit-nusantara",
      name: "Tas Kulit Nusantara",
      story: "Tas ini dibuat dari kulit sapi samak nabati.",
      specs: ["Kulit sapi nabati", "Dijahit tangan"],
      artisanName: "Irsyad",
      media: [{ r2Key: "products/p/foto-asli.jpg", altText: "Tas kulit" }],
      availableLocales: ["id", "en"],
    });
  });

  it("mengembalikan null saat produknya tidak ada atau belum terbit", async () => {
    const fake = fakeDb({ batchResults: catalogResults({ product: [] }) });

    expect(await findPublicCatalogEntry(fake.db, "tidak-ada", "id")).toBeNull();
  });

  it("membuang locale yang tidak dikenal dari daftar bahasa", async () => {
    // Daftar itu dipakai pemilih bahasa di antarmuka. Satu nilai asing akan
    // menjadi tombol yang tidak dapat membuka apa pun.
    const fake = fakeDb({
      batchResults: catalogResults({
        locales: [{ locale: "id" }, { locale: "xx" }, { locale: "en" }],
      }),
    });

    const entry = await findPublicCatalogEntry(fake.db, "tas-kulit-nusantara", "id");

    expect(entry?.availableLocales).toEqual(["id", "en"]);
  });

  it("memberi specs kosong saat kolomnya bukan JSON", async () => {
    // Kolom rusak tidak boleh membatalkan seluruh muatan: pembeli tetap
    // mendapat nama dan cerita.
    const fake = fakeDb({
      batchResults: catalogResults({ product: [{ ...CATALOG_ROW, specs: "bukan json" }] }),
    });

    const entry = await findPublicCatalogEntry(fake.db, "tas-kulit-nusantara", "id");

    expect(entry?.specs).toEqual([]);
  });

  it("meneruskan alt text null apa adanya", async () => {
    // Teks alternatif yang tidak ada bukan alasan menolak foto: nama dan
    // cerita tetap terbaca tanpa gambar (F3-04).
    const fake = fakeDb({
      batchResults: catalogResults({ media: [{ r2_key: "products/p/foto.jpg", alt_text: null }] }),
    });

    const entry = await findPublicCatalogEntry(fake.db, "tas-kulit-nusantara", "id");

    expect(entry?.media).toEqual([{ r2Key: "products/p/foto.jpg", altText: null }]);
  });
});
