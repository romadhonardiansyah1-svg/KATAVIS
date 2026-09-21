/**
 * Ekspor katalog: PDF, feed CSV, dan JSON.
 *
 * Ketiganya disusun dari satu bentuk masukan yang sama — `ExportProduct` —
 * sehingga satu produk menghasilkan tiga berkas yang isinya konsisten.
 *
 * F4-05 berlaku untuk ketiganya: setiap ekspor mencantumkan nama pengrajin.
 * Pada PDF ia masuk baris judul, pada CSV menjadi kolom `brand`, dan pada
 * JSON menjadi bidang `artisan`. Katalog yang tidak menyebut siapa
 * pembuatnya menghapus justru hal yang membuat karya ini layak dijual.
 *
 * Bentuk permintaannya dari kontrak API bagian 10, dan `ExportRequestSchema`
 * sudah ada di lib/schemas.ts — tidak ada skema baru di sini.
 */

import type { ErrorCode } from "../../lib/errors";
import { ExportRequestSchema, type Locale } from "../../lib/schemas";

import { MERCHANT_MISSING_COLUMNS, buildMerchantFeed } from "./csv";
import { buildTaggedPdf, type PdfBlock } from "./pdf";

export { MERCHANT_COLUMNS, MERCHANT_MISSING_COLUMNS, buildMerchantFeed } from "./csv";
export type { MerchantProduct } from "./csv";

export { buildTaggedPdf } from "./pdf";
export type { PdfBlock, PdfBuildResult, PdfDocumentInput } from "./pdf";

export type ExportFormat = "pdf" | "csv_merchant" | "json";

export interface ExportMedia {
  readonly url: string;
  readonly altText: string | null;
  /**
   * Bita JPEG, bila pemanggil sudah mengambilnya dari R2.
   *
   * PDF menyematkan gambar, dan hanya JPEG yang dapat disematkan apa adanya
   * dengan DCTDecode. Media tanpa bita ini tetap muncul sebagai elemen
   * struktur bergambar teks alternatif, tanpa gambarnya.
   */
  readonly jpeg?: Uint8Array;
  readonly pixelWidth?: number;
  readonly pixelHeight?: number;
}

export interface ExportProduct {
  readonly id: string;
  readonly slug: string | null;
  readonly locale: Locale;
  readonly name: string | null;
  readonly story: string | null;
  readonly specs: readonly string[];
  readonly socialCopy: string | null;
  readonly artisanName: string;
  readonly media: readonly ExportMedia[];
}

export interface ExportArtifact {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
  readonly filename: string;
}

export type ExportResult =
  | {
      readonly ok: true;
      readonly artifact: ExportArtifact;
      /**
       * Hal yang perlu diketahui pemanggil sebelum berkasnya diserahkan.
       *
       * Sekarang hanya satu isinya: karakter yang tidak dapat dikodekan PDF
       * dan digantikan `?`. Ekspor tetap dihasilkan, tetapi pemanggil dapat
       * memutuskan untuk menolaknya alih-alih menyerahkan katalog yang salah
       * baca kepada pengrajin.
       */
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly code: ErrorCode };

const CONTENT_TYPE: Readonly<Record<ExportFormat, string>> = {
  pdf: "application/pdf",
  csv_merchant: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

const EXTENSION: Readonly<Record<ExportFormat, string>> = {
  pdf: "pdf",
  csv_merchant: "csv",
  json: "json",
};

function pdfBlocks(product: ExportProduct): readonly PdfBlock[] {
  const blocks: PdfBlock[] = [
    { kind: "heading", level: 1, text: product.name ?? "" },
    { kind: "paragraph", text: product.story ?? "" },
  ];

  // Spesifikasi digabung menjadi satu paragraf, bukan satu paragraf per
  // butir: pohon struktur yang memuat belasan elemen /P berurutan membuat
  // pembaca layar membacakannya sebagai belasan paragraf terpisah.
  if (product.specs.length > 0) {
    blocks.push({ kind: "paragraph", text: product.specs.join(" · ") });
  }

  for (const media of product.media) {
    if (media.jpeg === undefined) continue;

    blocks.push({
      kind: "figure",
      jpeg: media.jpeg,
      pixelWidth: media.pixelWidth ?? 1,
      pixelHeight: media.pixelHeight ?? 1,
      // Teks alternatif wajib ada. Media tanpa alt text memakai nama produk
      // sebagai gantinya — lebih baik daripada gambar tanpa keterangan sama
      // sekali bagi pengguna pembaca layar.
      altText: media.altText ?? product.name ?? "",
    });
  }

  return blocks;
}

function jsonDocument(product: ExportProduct): string {
  return `${JSON.stringify(
    {
      id: product.id,
      locale: product.locale,
      name: product.name,
      story: product.story,
      specs: product.specs,
      socialCopy: product.socialCopy,
      artisan: { displayName: product.artisanName },
      media: product.media.map((media) => ({
        url: media.url,
        altText: media.altText,
      })),
    },
    null,
    2,
  )}\n`;
}

/**
 * Menyusun berkas ekspor.
 *
 * `catalogBaseUrl` dipakai feed CSV untuk menyusun tautan halaman publik,
 * yang rutenya ada di kontrak API bagian 10.
 */
export function buildExport(
  product: ExportProduct,
  request: unknown,
  catalogBaseUrl: string,
): ExportResult {
  const parsed = ExportRequestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, code: "UNSUPPORTED_FORMAT" };

  // Ekspor katalog yang belum punya nama dan cerita tidak berguna untuk
  // dijual, dan berkas setengah jadi lebih membingungkan daripada penolakan.
  if ((product.name ?? "").trim().length === 0) {
    return { ok: false, code: "CONTENT_INCOMPLETE" };
  }
  if ((product.story ?? "").trim().length === 0) {
    return { ok: false, code: "CONTENT_INCOMPLETE" };
  }

  const format = parsed.data.format;
  const name = `${product.slug ?? product.id}-${parsed.data.locale}.${EXTENSION[format]}`;

  if (format === "pdf") {
    const built = buildTaggedPdf({
      title: product.name ?? "",
      locale: parsed.data.locale,
      artisanName: product.artisanName,
      blocks: pdfBlocks(product),
    });

    const warnings =
      built.replacedCharacters.length === 0
        ? []
        : [
            `PDF memakai font inti Helvetica (WinAnsi), yang tidak memuat aksara berikut: ${built.replacedCharacters.join(" ")}. Teksnya digantikan "?" pada berkas.`,
          ];

    return {
      ok: true,
      artifact: { bytes: built.bytes, contentType: CONTENT_TYPE.pdf, filename: name },
      warnings,
    };
  }

  if (format === "csv_merchant") {
    const csv = buildMerchantFeed(
      [
        {
          id: product.id,
          slug: product.slug,
          name: product.name,
          story: product.story,
          artisanName: product.artisanName,
          primaryPhotoUrl: product.media[0]?.url ?? null,
        },
      ],
      catalogBaseUrl,
    );

    return {
      ok: true,
      artifact: {
        bytes: new TextEncoder().encode(csv),
        contentType: CONTENT_TYPE.csv_merchant,
        filename: name,
      },
      // Feed ini tidak memuat kolom yang diwajibkan Google Merchant Center.
      // Dilaporkan di sini supaya tidak ada yang mengira berkasnya siap
      // diunggah apa adanya.
      warnings: [
        `Feed tidak memuat kolom wajib Google Merchant Center: ${MERCHANT_MISSING_COLUMNS.join(", ")}.`,
      ],
    };
  }

  return {
    ok: true,
    artifact: {
      bytes: new TextEncoder().encode(jsonDocument(product)),
      contentType: CONTENT_TYPE.json,
      filename: name,
    },
    warnings: [],
  };
}
