/**
 * Konten katalog per bahasa.
 *
 * `product_content` dipisah per bahasa (ARCHITECTURE bagian 6), dan itu
 * yang memungkinkan kriteria F1-07: kegagalan satu bahasa tidak
 * menggagalkan bahasa lain. Berkas ini memperlakukan setiap baris bahasa
 * sebagai satu kesatuan — tidak ada penulisan yang menyentuh dua bahasa
 * sekaligus.
 *
 * Aturan yang mengikat seluruh berkas: **setiap perubahan konten mengubah
 * `source` menjadi `ai_edited`.** Teks yang pernah disentuh manusia tidak
 * boleh lagi mengaku sebagai keluaran mesin, karena di situlah satu-satunya
 * jejak bahwa pengrajin sudah memeriksanya.
 */

import { ulid } from "ulid";

import type { ErrorCode } from "../../lib/errors";
import {
  ContentPatchSchema,
  LocaleSchema,
  type Locale,
} from "../../lib/schemas";

import type { Db } from "../db";

/** Cerminan CHECK pada `product_content.source` (migrations/0001). */
export type ContentSource = "ai" | "human" | "ai_edited";

export interface ContentDraft {
  readonly name?: string | undefined;
  readonly story?: string | undefined;
  readonly specs?: readonly string[] | undefined;
  readonly socialCopy?: string | undefined;
  readonly seoKeywords?: readonly string[] | undefined;
}

export interface ContentRecord extends ContentDraft {
  readonly locale: Locale;
  readonly source: ContentSource;
  readonly updatedAt: number;
}

export type ContentPatchResult =
  | { readonly ok: true; readonly patch: ContentDraft }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Memeriksa muatan `PATCH /products/:id/content/:locale`.
 *
 * Seluruh bidang opsional; yang dikirim diperbarui, yang tidak dikirim
 * dibiarkan. `ContentPatchSchema` menolak muatan kosong, sehingga tidak ada
 * penyuntingan yang tidak mengubah apa pun tetapi tetap menaikkan
 * `updated_at` dan mengubah `source`.
 */
export function parseContentPatch(input: unknown): ContentPatchResult {
  const parsed = ContentPatchSchema.safeParse(input);
  if (!parsed.success) {
    // Katalog galat tidak punya kode untuk validasi masukan. Yang dipakai
    // adalah kode terdekat yang berbicara tentang isi katalog, dan ini
    // dicatat sebagai pertanyaan untuk pemilik kontrak API.
    return { ok: false, code: "CONTENT_INCOMPLETE" };
  }

  return { ok: true, patch: parsed.data };
}

/**
 * Konten dianggap lengkap bila nama dan cerita terisi.
 *
 * Sengaja tidak menuntut panjang cerita atau jumlah spesifikasi seperti
 * F1-05. Kriteria itu mengukur mutu keluaran mesin, dan pengrajin yang
 * memendekkan ceritanya sendiri tidak boleh terhalang menerbitkan karyanya
 * (TC-E2E-01 menguji keluaran, bukan gerbang penerbitan).
 */
export function isContentComplete(
  content: { readonly name?: string | null; readonly story?: string | null } | null,
): boolean {
  if (content === null) return false;
  return hasText(content.name) && hasText(content.story);
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
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

const CONTENT_COLUMNS =
  "locale, name, story, specs, social_copy, seo_keywords, source, updated_at";

/** Membaca satu bahasa. `null` bila barisnya belum ada. */
export async function loadContent(
  db: Db,
  productId: string,
  locale: Locale,
): Promise<ContentRecord | null> {
  const row = await db.first<ContentRow>({
    query: `SELECT ${CONTENT_COLUMNS} FROM product_content
            WHERE product_id = ? AND locale = ?`,
    params: [productId, locale],
  });

  if (row === null) return null;

  const parsedLocale = LocaleSchema.safeParse(row.locale);
  if (!parsedLocale.success) return null;

  return {
    locale: parsedLocale.data,
    name: row.name ?? undefined,
    story: row.story ?? undefined,
    specs: parseJsonArray(row.specs),
    socialCopy: row.social_copy ?? undefined,
    seoKeywords: parseJsonArray(row.seo_keywords),
    source: asSource(row.source),
    updatedAt: row.updated_at,
  };
}

function parseJsonArray(raw: string | null): readonly string[] {
  if (raw === null) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    // Bukan JSON. Larik kosong, bukan alasan membatalkan seluruh muatan.
    return [];
  }

  return Array.isArray(decoded) && decoded.every((item) => typeof item === "string")
    ? decoded
    : [];
}

function asSource(value: string): ContentSource {
  if (value === "human" || value === "ai_edited") return value;
  return "ai";
}

function serializeArray(value: readonly string[] | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export type ContentWriteResult =
  | { readonly ok: true; readonly content: ContentRecord | null }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Menyunting konten satu bahasa.
 *
 * `COALESCE(excluded.x, product_content.x)` adalah yang membuat "hanya yang
 * dikirim diperbarui" berlaku: bidang yang tidak dikirim masuk sebagai NULL
 * dan karenanya mempertahankan nilai lama. Tanpa itu, satu penyuntingan nama
 * akan menghapus cerita.
 *
 * `source` diset ke `ai_edited` di kedua cabang — termasuk saat barisnya
 * baru dibuat. Baris yang lahir dari penyuntingan manusia bukan keluaran
 * mesin, dan menandainya `ai` akan menghapus jejak bahwa seseorang sudah
 * membacanya.
 */
export async function patchContent(
  db: Db,
  productId: string,
  locale: Locale,
  patch: ContentDraft,
  nowMs: number,
): Promise<ContentWriteResult> {
  await db.run({
    query: `INSERT INTO product_content
              (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai_edited', ?)
            ON CONFLICT(product_id, locale) DO UPDATE SET
              name = COALESCE(excluded.name, product_content.name),
              story = COALESCE(excluded.story, product_content.story),
              specs = COALESCE(excluded.specs, product_content.specs),
              social_copy = COALESCE(excluded.social_copy, product_content.social_copy),
              seo_keywords = COALESCE(excluded.seo_keywords, product_content.seo_keywords),
              source = 'ai_edited',
              updated_at = excluded.updated_at`,
    params: [
      ulid(),
      productId,
      locale,
      patch.name ?? null,
      patch.story ?? null,
      serializeArray(patch.specs),
      patch.socialCopy ?? null,
      serializeArray(patch.seoKeywords),
      nowMs,
    ],
  });

  return { ok: true, content: await loadContent(db, productId, locale) };
}
