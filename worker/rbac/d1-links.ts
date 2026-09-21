/**
 * Akses D1 untuk tautan pendamping.
 *
 * Satu-satunya tempat di modul `rbac` yang menulis SQL. Aturan izinnya tetap
 * di `permissions.ts`, yang murni.
 *
 * Modul ini TIDAK menaikkan `token_version` saat mencabut — kolom itu milik
 * `worker/auth`, dan batas modul melarang `rbac` menyentuhnya. Pencabutan
 * yang berlaku seketika karena itu dirakit pemanggil: `d1RevokeLink` menutup
 * tautannya, lalu `worker/auth.d1BumpTokenVersion` mematikan token yang
 * beredar. Keduanya wajib; yang pertama saja bukan pencabutan (TC-I-04).
 */

import type { CaregiverPermission } from "../../lib/schemas";

import type { CaregiverLinkRow } from "./permissions";

const LINK_COLUMNS =
  "id, artisan_id, caregiver_id, permissions, status, expires_at";

export interface InviteInput {
  readonly id: string;
  readonly artisanId: string;
  readonly invitePhone: string;
  readonly inviteToken: string;
  readonly permissions: readonly CaregiverPermission[];
  readonly expiresAt: number;
}

/**
 * Membuat undangan.
 *
 * `caregiver_id` dibiarkan NULL sampai undangannya diterima: pada saat
 * mengundang, pendampingnya mungkin belum pernah masuk ke sistem sama sekali
 * dan belum punya baris pengguna.
 */
export async function d1CreateInvite(
  db: D1Database,
  invite: InviteInput,
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO caregiver_links
         (id, artisan_id, caregiver_id, invite_phone, invite_token, permissions,
          status, invited_at, expires_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      invite.id,
      invite.artisanId,
      invite.invitePhone,
      invite.inviteToken,
      JSON.stringify(invite.permissions),
      nowMs,
      invite.expiresAt,
    )
    .run();
}

export async function d1FindInviteByToken(
  db: D1Database,
  token: string,
): Promise<CaregiverLinkRow | null> {
  return db
    .prepare(`SELECT ${LINK_COLUMNS} FROM caregiver_links WHERE invite_token = ?`)
    .bind(token)
    .first<CaregiverLinkRow>();
}

/**
 * Tautan antara seorang pendamping dan seorang pengrajin.
 *
 * Dipakai jalur yang memeriksa izin: `worker/rbac` menerima tautannya
 * sebagai argumen, dan seseorang harus memuatnya dari basis data.
 */
export async function d1FindLinkFor(
  db: D1Database,
  caregiverId: string,
  artisanId: string,
): Promise<CaregiverLinkRow | null> {
  return db
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM caregiver_links
       WHERE caregiver_id = ? AND artisan_id = ?`,
    )
    .bind(caregiverId, artisanId)
    .first<CaregiverLinkRow>();
}

/**
 * Tautan antara seorang pendamping dan seorang pengrajin.
 *
 * Dipakai jalur yang memeriksa izin: `worker/rbac` menerima tautannya
 * sebagai argumen, dan seseorang harus memuatnya dari basis data.
 */
export async function d1FindLinkById(
  db: D1Database,
  linkId: string,
): Promise<CaregiverLinkRow | null> {
  return db
    .prepare(`SELECT ${LINK_COLUMNS} FROM caregiver_links WHERE id = ?`)
    .bind(linkId)
    .first<CaregiverLinkRow>();
}

/**
 * Menerima undangan.
 *
 * Syarat `status = 'pending'` ada di dalam WHERE, bukan di kode pemanggil:
 * undangan sekali pakai (TC-SEC-15), dan pemeriksaan yang bergantung pada
 * pembacaan sebelumnya akan gagal saat dua permintaan tiba bersamaan.
 */
export async function d1AcceptInvite(
  db: D1Database,
  linkId: string,
  caregiverId: string,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE caregiver_links
       SET caregiver_id = ?, status = 'active', granted_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(caregiverId, nowMs, linkId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export async function d1ListLinksForArtisan(
  db: D1Database,
  artisanId: string,
): Promise<readonly CaregiverLinkRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${LINK_COLUMNS} FROM caregiver_links
       WHERE artisan_id = ?
       ORDER BY invited_at DESC`,
    )
    .bind(artisanId)
    .all<CaregiverLinkRow>();

  return rows.results;
}

export async function d1RevokeLink(
  db: D1Database,
  linkId: string,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE caregiver_links
       SET status = 'revoked', revoked_at = ?
       WHERE id = ? AND status != 'revoked'`,
    )
    .bind(nowMs, linkId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
