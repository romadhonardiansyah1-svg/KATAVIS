/**
 * Kasus uji feed CSV — TC-E2E-08, F4-04, dan F4-05.
 *
 * Berkasnya diurai kembali dengan pengurai RFC 4180 kecil di bawah, bukan
 * diperiksa dengan `toContain`. Cerita produk hampir selalu memuat koma dan
 * sering memuat baris baru; hanya penguraian sungguhan yang dapat
 * membuktikan kolomnya tidak bergeser — dan kolom yang bergeser berarti
 * Google membaca nama produk sebagai harga.
 */

import { describe, expect, it } from "vitest";

import {
  MERCHANT_COLUMNS,
  MERCHANT_CONDITION,
  MERCHANT_MISSING_COLUMNS,
  buildMerchantFeed,
  publicCatalogUrl,
  type MerchantProduct,
} from "./csv";

const BASE_URL = "https://katavis.example";
const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDP001";

const PRODUCT: MerchantProduct = {
  id: PRODUCT_ID,
  slug: "tas-kulit-nusantara",
  name: "Tas Kulit Nusantara",
  story: "Dibuat dari kulit sapi nabati selama dua minggu.",
  artisanName: "Irsyad",
  primaryPhotoUrl: "https://media.example/products/01J/studio-1.webp",
};

/** Pengurai RFC 4180 secukupnya untuk memeriksa keluaran sendiri. */
function parseCsv(text: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

describe("export — feed CSV Google Merchant Center", () => {
  it("memakai nama kolom yang dikenal Google", () => {
    // F4-04
    expect(MERCHANT_COLUMNS).toEqual([
      "id",
      "title",
      "description",
      "link",
      "image_link",
      "brand",
      "condition",
    ]);
    expect(parseCsv(buildMerchantFeed([PRODUCT], BASE_URL))[0]).toEqual([
      ...MERCHANT_COLUMNS,
    ]);
  });

  it("menulis satu baris per produk", () => {
    const rows = parseCsv(
      buildMerchantFeed(
        [PRODUCT, { ...PRODUCT, id: "01J8ZQFX9K7YWVTN3MABCDP002" }],
        BASE_URL,
      ),
    );

    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(MERCHANT_COLUMNS.length);
  });

  it("mencantumkan nama pengrajin pada kolom brand", () => {
    // F4-05
    const rows = parseCsv(buildMerchantFeed([PRODUCT], BASE_URL));
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("brand")]).toBe("Irsyad");
  });

  it("menyusun tautan dari rute publik yang ada di kontrak", () => {
    const rows = parseCsv(buildMerchantFeed([PRODUCT], BASE_URL));
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("link")]).toBe(
      `${BASE_URL}/public/catalog/tas-kulit-nusantara`,
    );
    expect(publicCatalogUrl(`${BASE_URL}/`, "tas")).toBe(`${BASE_URL}/public/catalog/tas`);
  });

  it("tidak menggeser kolom saat cerita memuat koma", () => {
    const rows = parseCsv(
      buildMerchantFeed(
        [
          {
            ...PRODUCT,
            story: "Kulit sapi, nabati, dijahit tangan, tahan lama.",
          },
        ],
        BASE_URL,
      ),
    );

    expect(rows[1]).toHaveLength(MERCHANT_COLUMNS.length);
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("description")]).toBe(
      "Kulit sapi, nabati, dijahit tangan, tahan lama.",
    );
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("brand")]).toBe("Irsyad");
  });

  it("tidak menggeser kolom saat cerita memuat baris baru dan tanda kutip", () => {
    const rows = parseCsv(
      buildMerchantFeed(
        [{ ...PRODUCT, story: 'Baris pertama.\nDia bilang "halus".' }],
        BASE_URL,
      ),
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(MERCHANT_COLUMNS.length);
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("description")]).toBe(
      'Baris pertama.\nDia bilang "halus".',
    );
  });

  it("menulis bidang kosong untuk produk yang belum lengkap, bukan melewatinya", () => {
    // Melewatinya menyembunyikan produk yang belum lengkap; bidang kosong
    // membuat Google melaporkannya sebagai galat yang dapat ditindaklanjuti.
    const rows = parseCsv(
      buildMerchantFeed(
        [{ ...PRODUCT, slug: null, name: null, story: null, primaryPhotoUrl: null }],
        BASE_URL,
      ),
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("link")]).toBe("");
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("title")]).toBe("");
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("image_link")]).toBe("");
    // Nama pengrajin tetap ada meski produknya belum lengkap.
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("brand")]).toBe("Irsyad");
  });

  it("mengisi condition dengan nilai yang sah", () => {
    expect(MERCHANT_CONDITION).toBe("new");
    const rows = parseCsv(buildMerchantFeed([PRODUCT], BASE_URL));
    expect(rows[1]?.[MERCHANT_COLUMNS.indexOf("condition")]).toBe("new");
  });

  it("mengakhiri berkas dengan baris baru", () => {
    // POSIX menuntutnya, dan sebagian pengurai mengabaikan baris terakhir
    // tanpa itu — pada feed yang berisi satu produk, itu berarti feed kosong.
    const csv = buildMerchantFeed([PRODUCT], BASE_URL);
    expect(csv.endsWith("\n")).toBe(true);
    expect(csv.endsWith("\n\n")).toBe(false);
  });

  it("hanya menuliskan judul kolom saat tidak ada produk", () => {
    const rows = parseCsv(buildMerchantFeed([], BASE_URL));
    expect(rows).toHaveLength(1);
  });

  it("mencatat kolom wajib Google yang tidak dapat diisi", () => {
    // Bukan kelalaian: `price` tidak ada di skema mana pun, dan
    // `availability` menuntut klaim stok yang tidak dilacak sistem ini.
    // Daftarnya diekspor supaya pemanggil dapat memutuskannya, dan supaya
    // kekurangannya terlihat.
    expect(MERCHANT_MISSING_COLUMNS).toContain("price");
    expect(MERCHANT_MISSING_COLUMNS).toContain("availability");

    for (const column of MERCHANT_MISSING_COLUMNS) {
      expect(MERCHANT_COLUMNS).not.toContain(column);
    }
  });
});
