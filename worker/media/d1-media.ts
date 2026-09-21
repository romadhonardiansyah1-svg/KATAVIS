/**
 * Akses D1 untuk aset media.
 *
 * Satu-satunya tempat di modul `media` yang menulis SQL. Aturan validasinya
 * tetap di `upload.ts`, yang murni dan tidak menyentuh basis data.
 */

import type { MediaKind } from "../../lib/schemas";

export type UploadStatus = "pending" | "confirmed" | "failed";

export interface MediaAssetRecord {
  readonly id: string;
  readonly productId: string;
  readonly kind: MediaKind;
  readonly r2Key: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly altText: string | null;
  readonly provider: string | null;
  readonly isPrimary: boolean;
  readonly uploadStatus: UploadStatus;
}

interface MediaRow {
  readonly id: string;
  readonly product_id: string;
  readonly kind: string;
  readonly r2_key: string;
  readonly mime_type: string;
  readonly bytes: number;
  readonly alt_text: string | null;
  readonly provider: string | null;
  readonly is_primary: number;
  readonly upload_status: string;
}

const MEDIA_COLUMNS =
  "id, product_id, kind, r2_key, mime_type, bytes, alt_text, provider, is_primary, upload_status";

function toRecord(row: MediaRow): MediaAssetRecord {
  return {
    id: row.id,
    productId: row.product_id,
    kind: row.kind as MediaKind,
    r2Key: row.r2_key,
    mimeType: row.mime_type,
    bytes: row.bytes,
    altText: row.alt_text,
    provider: row.provider,
    isPrimary: row.is_primary === 1,
    uploadStatus: (row.upload_status as UploadStatus) ?? "pending",
  };
}

/**
 * Mencatat aset yang menunggu unggahan.
 *
 * `upload_status` sengaja `pending`: barisnya lahir saat URL bertanda tangan
 * diterbitkan, bukan saat berkasnya benar-benar tiba. Aset yang tidak pernah
 * selesai diunggah tetap terlihat sebagai tertunda, bukan sebagai hilang.
 */
export async function d1InsertMediaAsset(
  db: D1Database,
  asset: {
    readonly id: string;
    readonly productId: string;
    readonly kind: MediaKind;
    readonly r2Key: string;
    readonly mimeType: string;
    readonly bytes: number;
  },
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO media_assets
         (id, product_id, kind, r2_key, mime_type, bytes, is_primary, upload_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?)`,
    )
    .bind(asset.id, asset.productId, asset.kind, asset.r2Key, asset.mimeType, asset.bytes, nowMs)
    .run();
}

export async function d1FindMediaAsset(
  db: D1Database,
  mediaId: string,
): Promise<MediaAssetRecord | null> {
  const row = await db
    .prepare(`SELECT ${MEDIA_COLUMNS} FROM media_assets WHERE id = ?`)
    .bind(mediaId)
    .first<MediaRow>();

  return row === null ? null : toRecord(row);
}

/**
 * Menandai unggahan selesai, dengan jenis dan ukuran yang **terukur**.
 *
 * Bukan yang dinyatakan klien saat meminta URL: berkas yang tiba bisa
 * berbeda dari yang dijanjikan, dan `mime_type` di sini dipakai katalog
 * untuk memutuskan bagaimana menampilkannya.
 */
export async function d1ConfirmMediaAsset(
  db: D1Database,
  mediaId: string,
  measured: { readonly mimeType: string; readonly bytes: number },
): Promise<MediaAssetRecord | null> {
  await db
    .prepare(
      `UPDATE media_assets
       SET upload_status = 'confirmed', mime_type = ?, bytes = ?
       WHERE id = ?`,
    )
    .bind(measured.mimeType, measured.bytes, mediaId)
    .run();

  return d1FindMediaAsset(db, mediaId);
}

/**
 * Menyunting teks alternatif dan penanda foto utama.
 *
 * Menjadikan satu aset sebagai foto utama berarti mencabut penanda itu dari
 * aset lain pada produk yang sama. Dua baris, satu putaran — kalau tidak,
 * produk bisa berakhir dengan dua foto utama dan katalog menampilkan yang
 * mana pun secara acak.
 */
export async function d1PatchMediaAsset(
  db: D1Database,
  mediaId: string,
  patch: { readonly altText?: string | undefined; readonly isPrimary?: boolean | undefined },
): Promise<MediaAssetRecord | null> {
  const statements: D1PreparedStatement[] = [];

  if (patch.isPrimary === true) {
    statements.push(
      db
        .prepare(
          `UPDATE media_assets SET is_primary = 0
           WHERE product_id = (SELECT product_id FROM media_assets WHERE id = ?)`,
        )
        .bind(mediaId),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE media_assets
         SET alt_text = COALESCE(?, alt_text),
             is_primary = COALESCE(?, is_primary)
         WHERE id = ?`,
      )
      .bind(
        patch.altText ?? null,
        patch.isPrimary === undefined ? null : patch.isPrimary ? 1 : 0,
        mediaId,
      ),
  );

  await db.batch(statements);

  return d1FindMediaAsset(db, mediaId);
}
