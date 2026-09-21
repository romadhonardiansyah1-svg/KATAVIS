/**
 * Seluruh kueri baca untuk produk.
 *
 * Satu aturan membentuk seluruh berkas ini: **tidak ada kueri di dalam
 * perulangan.** Setiap fungsi di sini menyelesaikan pekerjaannya dalam satu
 * pernyataan, atau dalam satu `batch()` bila memang ada beberapa tabel.
 * D1 paket gratis mengizinkan 50 kueri per invocation, dan satu pola N+1
 * sudah cukup untuk menembusnya (ADR-006, TC-PERF-04).
 *
 * Konsekuensi yang terlihat jelas di `loadProductDetail`: lima tabel
 * diambil sekaligus, bukan satu per satu, meski hasilnya dipakai terpisah.
 * Itu bukan pengoptimalan dini — itu satu-satunya bentuk yang muat.
 *
 * Paginasi memakai kursor keyset (`id < ?`), bukan `OFFSET`. `OFFSET` yang
 * besar memaksa SQLite memindai seluruh baris sebelumnya, dan biayanya
 * tumbuh seiring halaman — tepat pada saat kuota paling tidak boleh boros.
 */

import { z } from "zod";

import { ERROR_CATALOG, type ErrorCode } from "../../lib/errors";
import {
  JobKindSchema,
  JobStatusSchema,
  LocaleSchema,
  MediaKindSchema,
  ProductStatusSchema,
  type JobKind,
  type JobStatus,
  type Locale,
  type MediaKind,
  type ProductStatus,
} from "../../lib/schemas";

import type { Db } from "./counter";

// --- Bentuk yang dipakai lapisan rute ---

/** Cerminan CHECK pada `product_content.source` (migrations/0001). */
export type ContentSource = "ai" | "human" | "ai_edited";

export interface ProductContent {
  readonly locale: Locale;
  readonly name: string | null;
  readonly story: string | null;
  readonly specs: readonly string[];
  readonly socialCopy: string | null;
  readonly seoKeywords: readonly string[];
  readonly source: ContentSource;
  readonly updatedAt: number;
}

export interface MediaAsset {
  readonly id: string;
  readonly kind: MediaKind;
  readonly r2Key: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly altText: string | null;
  readonly provider: string | null;
  readonly isPrimary: boolean;
}

export interface JobSummary {
  readonly id: string;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly provider: string | null;
  readonly progress: number;
  readonly attempt: number;
  readonly errorCode: ErrorCode | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
}

export interface TranscriptSummary {
  readonly text: string;
  readonly locale: Locale;
  readonly reviewed: boolean;
  readonly edited: boolean;
  readonly provider: string | null;
  readonly durationMs: number | null;
}

export interface ProductDetail {
  readonly id: string;
  readonly artisanId: string;
  readonly status: ProductStatus;
  readonly slug: string | null;
  readonly progress: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly publishedAt: number | null;
  /** Satu entri per bahasa. Kunci peta adalah kode BCP-47. */
  readonly content: ReadonlyMap<Locale, ProductContent>;
  readonly media: readonly MediaAsset[];
  readonly jobs: readonly JobSummary[];
  readonly transcript: TranscriptSummary | null;
}

export interface ProductListItem {
  readonly id: string;
  readonly status: ProductStatus;
  readonly name: string | null;
  /**
   * Kunci R2, bukan URL. URL bertanda tangan berumur pendek dan dibuat
   * modul media saat menyusun respons; menyimpannya di sini akan
   * menghasilkan tautan kedaluwarsa yang ikut ter-cache.
   */
  readonly primaryPhotoKey: string | null;
  readonly progress: number;
  readonly updatedAt: number;
}

export interface ProductPage {
  readonly items: readonly ProductListItem[];
  readonly nextCursor: string | null;
}

export interface ProductListQuery {
  readonly artisanId: string;
  /** Bahasa untuk kolom `name`. Nilainya dari `users.locale` (PRD bagian 6). */
  readonly locale: Locale;
  readonly limit: number;
  readonly status?: ProductStatus;
  readonly cursor?: string;
}

// --- Baris mentah ---

interface ProductRow {
  readonly id: string;
  readonly artisan_id: string;
  readonly status: string;
  readonly slug: string | null;
  readonly progress: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly published_at: number | null;
}

interface ContentRow {
  readonly locale: string;
  readonly name: string | null;
  readonly story: string | null;
  readonly specs: string | null;
  readonly social_copy: string | null;
  readonly seo_keywords: string | null;
  readonly source: string;
  readonly updated_at: number;
}

interface MediaRow {
  readonly id: string;
  readonly kind: string;
  readonly r2_key: string;
  readonly mime_type: string;
  readonly bytes: number;
  readonly alt_text: string | null;
  readonly provider: string | null;
  readonly is_primary: number;
}

interface JobRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly provider: string | null;
  readonly progress: number;
  readonly attempt: number;
  readonly error_code: string | null;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly completed_at: number | null;
}

interface TranscriptRow {
  readonly text: string;
  readonly locale: string;
  readonly reviewed: number;
  readonly edited: number;
  readonly provider: string | null;
  readonly duration_ms: number | null;
}

interface ProductListRow {
  readonly id: string;
  readonly status: string;
  readonly name: string | null;
  readonly primary_photo_key: string | null;
  readonly progress: number;
  readonly updated_at: number;
}

/**
 * Baris D1 datang sebagai `unknown[]`.
 *
 * Pernyataan di berkas ini menuliskan kolomnya satu per satu, jadi bentuknya
 * kita yang menentukan. Assertion ini menandai batas itu di satu tempat;
 * bidang yang benar-benar dapat salah — kolom TEXT berisi enum dan kolom
 * JSON — tetap divalidasi dengan skema di lib/schemas.ts sesudahnya.
 */
function rowsAs<TValue>(rows: readonly unknown[] | undefined): readonly TValue[] {
  return (rows ?? []) as readonly TValue[];
}

const STRING_ARRAY = z.array(z.string());

/**
 * Kolom JSON berisi larik string.
 *
 * Ini decoder untuk kolom basis data, bukan bentuk API: larik disimpan
 * sebagai TEXT karena D1 tidak punya tipe larik (ADR-006). Isi yang tidak
 * dapat diurai dianggap kosong — lebih baik menampilkan katalog tanpa
 * daftar spesifikasi daripada menggagalkan seluruh layar karena satu kolom.
 */
function parseStringArray(raw: string | null): readonly string[] {
  if (raw === null) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    // Bukan JSON. Kolom kosong, bukan alasan membatalkan seluruh muatan.
    return [];
  }

  const parsed = STRING_ARRAY.safeParse(decoded);
  return parsed.success ? parsed.data : [];
}

function asContentSource(value: string): ContentSource | null {
  if (value === "ai" || value === "human" || value === "ai_edited") return value;
  return null;
}

/** Kode galat hanya sah bila ada di katalog (lib/errors.ts). */
function asErrorCode(value: string | null): ErrorCode | null {
  if (value === null) return null;
  if (!Object.hasOwn(ERROR_CATALOG, value)) return null;
  return value as ErrorCode;
}

function toContent(row: ContentRow): ProductContent | null {
  const locale = LocaleSchema.safeParse(row.locale);
  const source = asContentSource(row.source);
  if (!locale.success || source === null) return null;

  return {
    locale: locale.data,
    name: row.name,
    story: row.story,
    specs: parseStringArray(row.specs),
    socialCopy: row.social_copy,
    seoKeywords: parseStringArray(row.seo_keywords),
    source,
    updatedAt: row.updated_at,
  };
}

function toMedia(row: MediaRow): MediaAsset | null {
  const kind = MediaKindSchema.safeParse(row.kind);
  if (!kind.success) return null;

  return {
    id: row.id,
    kind: kind.data,
    r2Key: row.r2_key,
    mimeType: row.mime_type,
    bytes: row.bytes,
    altText: row.alt_text,
    provider: row.provider,
    isPrimary: row.is_primary === 1,
  };
}

function toJob(row: JobRow): JobSummary | null {
  const kind = JobKindSchema.safeParse(row.kind);
  const status = JobStatusSchema.safeParse(row.status);
  if (!kind.success || !status.success) return null;

  return {
    id: row.id,
    kind: kind.data,
    status: status.data,
    provider: row.provider,
    progress: row.progress,
    attempt: row.attempt,
    errorCode: asErrorCode(row.error_code),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function toTranscript(row: TranscriptRow): TranscriptSummary | null {
  const locale = LocaleSchema.safeParse(row.locale);
  if (!locale.success) return null;

  return {
    text: row.text,
    locale: locale.data,
    reviewed: row.reviewed === 1,
    edited: row.edited === 1,
    provider: row.provider,
    durationMs: row.duration_ms,
  };
}

function compact<TValue>(values: readonly (TValue | null)[]): TValue[] {
  return values.filter((value): value is TValue => value !== null);
}

// --- Kueri ---

const PRODUCT_DETAIL_PRODUCT = `
  SELECT id, artisan_id, status, slug, progress, created_at, updated_at, published_at
  FROM products
  WHERE id = ?`;

const PRODUCT_DETAIL_CONTENT = `
  SELECT locale, name, story, specs, social_copy, seo_keywords, source, updated_at
  FROM product_content
  WHERE product_id = ?`;

const PRODUCT_DETAIL_MEDIA = `
  SELECT id, kind, r2_key, mime_type, bytes, alt_text, provider, is_primary
  FROM media_assets
  WHERE product_id = ? AND upload_status = 'confirmed'
  ORDER BY is_primary DESC, created_at ASC`;

const PRODUCT_DETAIL_JOBS = `
  SELECT id, kind, status, provider, progress, attempt, error_code,
         created_at, started_at, completed_at
  FROM jobs
  WHERE product_id = ?
  ORDER BY created_at DESC`;

const PRODUCT_DETAIL_TRANSCRIPT = `
  SELECT text, locale, reviewed, edited, provider, duration_ms
  FROM transcripts
  WHERE product_id = ?`;

/**
 * Seluruh yang dibutuhkan layar produk, dalam SATU invocation.
 *
 * Lima tabel, satu `batch()`, lima kueri — bukan satu kueri per tabel yang
 * di-`await` berurutan, dan pasti bukan satu kueri per baris. Kontrak API
 * bagian 4 menyebut alasan sebenarnya: endpoint yang memaksa frontend
 * memanggil berulang justru berbahaya di paket gratis.
 *
 * `null` berarti produknya tidak ada, atau statusnya di luar skema —
 * keduanya tidak dapat disajikan, dan tidak ada gunanya membedakannya bagi
 * pemanggil. CHECK di basis data membuat kasus kedua tidak mungkin terjadi
 * kecuali skema berubah.
 */
export async function loadProductDetail(
  db: Db,
  productId: string,
): Promise<ProductDetail | null> {
  const results = await db.batch([
    { query: PRODUCT_DETAIL_PRODUCT, params: [productId] },
    { query: PRODUCT_DETAIL_CONTENT, params: [productId] },
    { query: PRODUCT_DETAIL_MEDIA, params: [productId] },
    { query: PRODUCT_DETAIL_JOBS, params: [productId] },
    { query: PRODUCT_DETAIL_TRANSCRIPT, params: [productId] },
  ]);

  const productRow = rowsAs<ProductRow>(results[0])[0];
  if (productRow === undefined) return null;

  const status = ProductStatusSchema.safeParse(productRow.status);
  if (!status.success) return null;

  const content = new Map<Locale, ProductContent>();
  for (const entry of compact(
    rowsAs<ContentRow>(results[1]).map((row) => toContent(row)),
  )) {
    content.set(entry.locale, entry);
  }

  const transcriptRow = rowsAs<TranscriptRow>(results[4])[0];

  return {
    id: productRow.id,
    artisanId: productRow.artisan_id,
    status: status.data,
    slug: productRow.slug,
    progress: productRow.progress,
    createdAt: productRow.created_at,
    updatedAt: productRow.updated_at,
    publishedAt: productRow.published_at,
    content,
    media: compact(rowsAs<MediaRow>(results[2]).map((row) => toMedia(row))),
    jobs: compact(rowsAs<JobRow>(results[3]).map((row) => toJob(row))),
    transcript:
      transcriptRow === undefined ? null : toTranscript(transcriptRow),
  };
}

/**
 * Katalog publik — `GET /public/catalog/:slug`.
 *
 * Empat tabel dalam satu batch, dan satu syarat yang tidak boleh dilupakan:
 * hanya produk `published`. Produk `draft` tidak ditolak dengan 403
 * melainkan tidak ditemukan sama sekali — kontrak API bagian 10 menyebut
 * alasannya, 403 membocorkan keberadaan produk.
 *
 * Nama pengrajin diambil dari `users.display_name` dan tidak lebih. Nomor
 * telepon dan identitas lain tidak pernah ikut ke titik akhir publik.
 */
export async function findPublicCatalogEntry(
  db: Db,
  slug: string,
  locale: Locale,
): Promise<PublicCatalogEntry | null> {
  const results = await db.batch([
    {
      query: `SELECT p.id, p.slug, c.name, c.story, c.specs, u.display_name
              FROM products p
              JOIN users u ON u.id = p.artisan_id
              LEFT JOIN product_content c ON c.product_id = p.id AND c.locale = ?
              WHERE p.slug = ? AND p.status = 'published'`,
      params: [locale, slug],
    },
    {
      query: `SELECT m.r2_key, m.alt_text
              FROM media_assets m
              JOIN products p ON p.id = m.product_id
              WHERE p.slug = ? AND p.status = 'published'
                AND m.upload_status = 'confirmed'
              ORDER BY m.is_primary DESC, m.created_at ASC`,
      params: [slug],
    },
    {
      query: `SELECT DISTINCT c.locale
              FROM product_content c
              JOIN products p ON p.id = c.product_id
              WHERE p.slug = ? AND p.status = 'published' AND c.name IS NOT NULL`,
      params: [slug],
    },
  ]);

  const row = rowsAs<PublicCatalogRow>(results[0])[0];
  if (row === undefined) return null;

  const availableLocales = rowsAs<{ readonly locale: string }>(results[2])
    .map((entry) => LocaleSchema.safeParse(entry.locale))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    story: row.story,
    specs: parseStringArray(row.specs),
    artisanName: row.display_name,
    media: rowsAs<{ readonly r2_key: string; readonly alt_text: string | null }>(
      results[1],
    ).map((media) => ({ r2Key: media.r2_key, altText: media.alt_text })),
    availableLocales,
  };
}

interface PublicCatalogRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string | null;
  readonly story: string | null;
  readonly specs: string | null;
  readonly display_name: string;
}

export interface PublicCatalogEntry {
  readonly id: string;
  readonly slug: string;
  readonly name: string | null;
  readonly story: string | null;
  readonly specs: readonly string[];
  /** Nama tampilan saja. Tidak pernah nomor telepon. */
  readonly artisanName: string;
  readonly media: readonly {
    readonly r2Key: string;
    readonly altText: string | null;
  }[];
  readonly availableLocales: readonly Locale[];
}

/**
 * Daftar produk milik satu pengrajin, dengan kursor.
 *
 * Satu pernyataan untuk seluruh halaman. Judul dan foto utama diambil lewat
 * subquery berkorelasi, bukan lewat kueri susulan per baris — itulah bentuk
 * N+1 yang paling mudah terjadi pada daftar, dan yang paling mahal karena
 * jumlahnya tumbuh seiring `limit`.
 *
 * `LIMIT` diisi `limit + 1` untuk mengetahui apakah masih ada halaman
 * berikutnya tanpa kueri `COUNT(*)` tambahan. Baris ekstra itu dibuang
 * sebelum dikembalikan.
 */
export async function listProducts(
  db: Db,
  query: ProductListQuery,
): Promise<ProductPage> {
  const conditions = ["p.artisan_id = ?"];
  // Urutan parameter mengikuti urutan placeholder di dalam teks SQL, dan
  // placeholder pertama ada di SELECT — bukan di WHERE.
  const params: unknown[] = [query.locale, query.artisanId];

  if (query.status !== undefined) {
    conditions.push("p.status = ?");
    params.push(query.status);
  }

  if (query.cursor !== undefined) {
    // Keyset, bukan OFFSET. ULID terurut menurut waktu, jadi satu kolom
    // cukup untuk menentukan posisi.
    conditions.push("p.id < ?");
    params.push(query.cursor);
  }

  params.push(query.limit + 1);

  const statement = `
    SELECT
      p.id, p.status, p.progress, p.updated_at,
      (SELECT c.name FROM product_content c
        WHERE c.product_id = p.id AND c.locale = ?) AS name,
      (SELECT m.r2_key FROM media_assets m
        WHERE m.product_id = p.id AND m.is_primary = 1
          AND m.upload_status = 'confirmed'
        ORDER BY m.created_at LIMIT 1) AS primary_photo_key
    FROM products p
    WHERE ${conditions.join(" AND ")}
    ORDER BY p.id DESC
    LIMIT ?`;

  const rows = rowsAs<ProductListRow>(await db.all({ query: statement, params }));

  const page = rows.slice(0, query.limit);
  const lastRow = page[page.length - 1];

  return {
    items: compact(
      page.map((row): ProductListItem | null => {
        const status = ProductStatusSchema.safeParse(row.status);
        if (!status.success) return null;
        return {
          id: row.id,
          status: status.data,
          name: row.name,
          primaryPhotoKey: row.primary_photo_key,
          progress: row.progress,
          updatedAt: row.updated_at,
        };
      }),
    ),
    nextCursor: rows.length > query.limit && lastRow !== undefined ? lastRow.id : null,
  };
}
