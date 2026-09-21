/**
 * Kasus uji penyusun ekspor — kontrak API bagian 10.
 *
 * Yang diperiksa di sini adalah pemilihan berkas dan penolakan sebelum
 * berkas dibuat. Isi ketiga formatnya diuji di `pdf.test.ts` dan
 * `csv.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { buildExport, type ExportProduct } from "./index";

const BASE_URL = "https://katavis.example";

const PRODUCT: ExportProduct = {
  id: "01J8ZQFX9K7YWVTN3MABCDP001",
  slug: "tas-kulit-nusantara",
  locale: "id",
  name: "Tas Kulit Nusantara",
  story: "Dibuat dari kulit sapi nabati selama dua minggu.",
  specs: ["Kulit sapi nabati", "Jahitan tangan"],
  socialCopy: "Tas kulit asli dari pengrajin lokal.",
  artisanName: "Irsyad",
  media: [
    {
      url: "https://media.example/products/01J/studio-1.webp",
      altText: "Tas kulit cokelat di atas meja marmer",
    },
  ],
};

function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("export — penyusun berkas", () => {
  it.each([
    ["pdf", "application/pdf", "tas-kulit-nusantara-id.pdf"],
    ["csv_merchant", "text/csv; charset=utf-8", "tas-kulit-nusantara-id.csv"],
    ["json", "application/json; charset=utf-8", "tas-kulit-nusantara-id.json"],
  ] as const)("menyusun %s dengan jenis dan nama berkas yang benar", (format, contentType, filename) => {
    const result = buildExport(PRODUCT, { format, locale: "id" }, BASE_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.contentType).toBe(contentType);
    expect(result.artifact.filename).toBe(filename);
    expect(result.artifact.bytes.length).toBeGreaterThan(0);
  });

  it("memakai id sebagai nama berkas bila slug belum ada", () => {
    const result = buildExport(
      { ...PRODUCT, slug: null },
      { format: "json", locale: "id" },
      BASE_URL,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.filename).toBe(`${PRODUCT.id}-id.json`);
  });

  it("mencantumkan nama pengrajin pada ketiga format", () => {
    // F4-05
    for (const format of ["pdf", "csv_merchant", "json"] as const) {
      const result = buildExport(PRODUCT, { format, locale: "id" }, BASE_URL);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const text = textOf(result.artifact.bytes);
      // Pada PDF nama itu ada di aliran isi, dan tanda pisahnya dilolosikan.
      expect(format === "pdf" ? text.includes("Irsyad") : text.includes("Irsyad")).toBe(true);
    }
  });

  it("menolak permintaan yang bentuknya tidak sah", () => {
    for (const request of [
      {},
      { format: "docx", locale: "id" },
      { format: "pdf" },
      { format: "pdf", locale: "xx" },
    ]) {
      expect(buildExport(PRODUCT, request, BASE_URL)).toEqual({
        ok: false,
        code: "UNSUPPORTED_FORMAT",
      });
    }
  });

  it("mengabaikan bidang tambahan pada permintaan", () => {
    // Perilaku bawaan skema Zod di lib/schemas.ts: bidang yang tidak dikenal
    // dibuang, bukan ditolak. Itu yang diinginkan di batas API — klien lama
    // yang mengirim bidang tambahan tidak boleh berhenti bekerja.
    const result = buildExport(
      PRODUCT,
      { format: "json", locale: "id", extra: true },
      BASE_URL,
    );

    expect(result.ok).toBe(true);
  });

  it("menolak ekspor katalog yang belum punya nama atau cerita", () => {
    for (const incomplete of [
      { ...PRODUCT, name: null },
      { ...PRODUCT, name: "   " },
      { ...PRODUCT, story: null },
      { ...PRODUCT, story: "" },
    ]) {
      expect(buildExport(incomplete, { format: "pdf", locale: "id" }, BASE_URL)).toEqual({
        ok: false,
        code: "CONTENT_INCOMPLETE",
      });
    }
  });

  it("memperingatkan saat PDF tidak dapat memuat seluruh aksara", () => {
    const result = buildExport(
      { ...PRODUCT, name: "革のバッグ" },
      { format: "pdf", locale: "ja" },
      BASE_URL,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Berkasnya tetap dihasilkan, tetapi pemanggil harus tahu isinya tidak
    // utuh sebelum menyerahkannya kepada pengrajin.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Helvetica");
  });

  it("memperingatkan bahwa feed CSV belum lengkap untuk diunggah", () => {
    const result = buildExport(PRODUCT, { format: "csv_merchant", locale: "id" }, BASE_URL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("price");
    expect(result.warnings[0]).toContain("availability");
  });

  it("tidak memperingatkan apa pun untuk ekspor yang utuh", () => {
    for (const format of ["pdf", "json"] as const) {
      const result = buildExport(PRODUCT, { format, locale: "id" }, BASE_URL);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.warnings).toEqual([]);
    }
  });

  it("menyusun JSON yang dapat dibaca kembali", () => {
    const result = buildExport(PRODUCT, { format: "json", locale: "id" }, BASE_URL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const document = JSON.parse(textOf(result.artifact.bytes)) as Record<string, unknown>;

    expect(document.id).toBe(PRODUCT.id);
    expect(document.locale).toBe("id");
    expect(document.name).toBe("Tas Kulit Nusantara");
    expect(document.specs).toEqual(["Kulit sapi nabati", "Jahitan tangan"]);
    expect(document.artisan).toEqual({ displayName: "Irsyad" });
    // Nomor telepon dan identitas lain pengrajin tidak pernah ikut.
    expect(JSON.stringify(document)).not.toContain("+62");
  });

  it("menyematkan gambar ke PDF hanya bila bita JPEG-nya tersedia", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0xff, 0xd9]);

    const withBytes = buildExport(
      {
        ...PRODUCT,
        media: [{ ...PRODUCT.media[0], url: "https://x/y.webp", altText: "Tas", jpeg, pixelWidth: 800, pixelHeight: 600 }],
      },
      { format: "pdf", locale: "id" },
      BASE_URL,
    );
    expect(withBytes.ok).toBe(true);
    if (!withBytes.ok) return;
    expect(textOf(withBytes.artifact.bytes)).toContain("/Filter /DCTDecode");

    const withoutBytes = buildExport(PRODUCT, { format: "pdf", locale: "id" }, BASE_URL);
    expect(withoutBytes.ok).toBe(true);
    if (!withoutBytes.ok) return;
    expect(textOf(withoutBytes.artifact.bytes)).not.toContain("/Filter /DCTDecode");
  });

  it("memakai nama produk sebagai teks alternatif bila alt text kosong", () => {
    // Gambar tanpa keterangan sama sekali tidak berguna bagi pengguna
    // pembaca layar; nama produk jauh lebih baik daripada tidak ada.
    const result = buildExport(
      {
        ...PRODUCT,
        media: [
          {
            url: "https://x/y.jpg",
            altText: null,
            jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
            pixelWidth: 10,
            pixelHeight: 10,
          },
        ],
      },
      { format: "pdf", locale: "id" },
      BASE_URL,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(textOf(result.artifact.bytes)).toContain("/Alt (Tas Kulit Nusantara)");
  });
});
