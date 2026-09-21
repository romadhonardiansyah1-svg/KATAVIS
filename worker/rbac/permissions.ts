/**
 * Aturan izin modul rbac.
 *
 * Seluruh fungsi di berkas ini murni: tidak ada D1, R2, jaringan, maupun
 * jam sistem yang dibaca sendiri. Pemanggil memuat baris `users` dan
 * `caregiver_links`, lalu mengopernya masuk beserta `now`. Itulah yang
 * membuat 13 kasus uji TEST-PLAN.md bagian 3 berjalan tanpa basis data,
 * dan yang membuat modul ini dapat dipisahkan menjadi layanan tersendiri
 * kelak tanpa penulisan ulang (ADR-001).
 *
 * Dua invarian yang tidak boleh dilonggarkan:
 *
 *   1. Default MENOLAK. Peran tak dikenal, izin tak dikenal, tautan yang
 *      tidak berstatus `active`, atau tautan yang sudah lewat `expires_at`
 *      menghasilkan false — bukan true. Pemeriksaan ditulis secara positif
 *      (`status === "active"`), bukan sebagai pengecualian
 *      (`status !== "revoked"`), karena bentuk kedua meloloskan `pending`
 *      dan `expired`.
 *
 *   2. Pendamping tidak pernah dapat menerbitkan atau menghapus. Keduanya
 *      tidak ada dalam daftar izin yang dapat didelegasikan (lib/schemas.ts,
 *      FEATURE-SPECS S3), sehingga tidak ada nilai `permissions` yang dapat
 *      membukanya.
 */

import { z } from "zod";

import {
  CaregiverPermissionSchema,
  LIMITS,
  RoleSchema,
  type CaregiverPermission,
  type ProductStatus,
  type Role,
} from "../../lib/schemas";

// --- Bentuk data ---

/**
 * Peran sengaja bertipe `string`, bukan `Role`.
 *
 * Nilainya berasal dari token dan basis data, jadi ia adalah data luar
 * sampai dicocokkan dengan peran yang dikenal. Memaksakan tipe `Role` di
 * sini akan membuat pemeriksaan default-menolak tampak tidak perlu —
 * padahal justru itulah yang diuji TC-U-RBAC-12.
 */
export interface Actor {
  readonly id: string;
  readonly role: string;
  /** token_version yang tertanam di dalam token saat diterbitkan. */
  readonly sessionTokenVersion: number;
  /** token_version terkini pada baris `users`. */
  readonly currentTokenVersion: number;
}

export interface ProductRef {
  readonly id: string;
  readonly artisanId: string;
  readonly status: ProductStatus;
}

/** Cerminan CHECK pada `caregiver_links.status` (migrations/0001). */
export type CaregiverLinkStatus = "pending" | "active" | "revoked" | "expired";

export interface CaregiverLink {
  readonly id: string;
  readonly artisanId: string;
  /** null selama undangan belum diterima. */
  readonly caregiverId: string | null;
  readonly permissions: readonly CaregiverPermission[];
  readonly status: CaregiverLinkStatus;
  readonly expiresAt: number;
}

/** Baris `caregiver_links` apa adanya dari D1. */
export interface CaregiverLinkRow {
  readonly id: string;
  readonly artisan_id: string;
  readonly caregiver_id: string | null;
  readonly permissions: string;
  readonly status: string;
  readonly expires_at: number;
}

// --- Pemeriksaan dasar ---

const CAREGIVER_LINK_STATUSES: readonly CaregiverLinkStatus[] = [
  "pending",
  "active",
  "revoked",
  "expired",
];

function isCaregiverLinkStatus(status: string): status is CaregiverLinkStatus {
  return CAREGIVER_LINK_STATUSES.some((known) => known === status);
}

/** Dipakai pemanggil yang perlu membedakan "peran tak dikenal" dari "peran tak berizin". */
export function isKnownRole(role: string): role is Role {
  return RoleSchema.safeParse(role).success;
}

/**
 * Sesi masih sah.
 *
 * Pencabutan akses pendamping menaikkan `users.token_version`
 * (API-CONTRACT bagian 9). Tanpa perbandingan ini pada SETIAP permintaan,
 * token lama tetap sah sampai kedaluwarsa dan pencabutan hanya berlaku di
 * atas kertas. Diuji di TC-I-04 dan TC-SEC-16.
 */
export function isSessionCurrent(actor: Actor): boolean {
  return actor.sessionTokenVersion === actor.currentTokenVersion;
}

function isOwningArtisan(actor: Actor, product: ProductRef): boolean {
  return actor.role === "artisan" && product.artisanId === actor.id;
}

/**
 * Tautan pendamping yang benar-benar berlaku untuk produk ini.
 *
 * Lima syarat sekaligus: pemanggil memang pendamping, tautan berstatus
 * `active`, tautan itu milik pemanggil, terikat pada pengrajin pemilik
 * produk, dan belum lewat `expires_at`.
 */
function isLinkActiveFor(
  actor: Actor,
  product: ProductRef,
  link: CaregiverLink | null,
  now: number,
): link is CaregiverLink {
  return (
    actor.role === "caregiver" &&
    link !== null &&
    link.status === "active" &&
    link.caregiverId === actor.id &&
    link.artisanId === product.artisanId &&
    link.expiresAt > now
  );
}

function caregiverHasPermission(
  actor: Actor,
  product: ProductRef,
  link: CaregiverLink | null,
  permission: CaregiverPermission,
  now: number,
): boolean {
  return (
    isLinkActiveFor(actor, product, link, now) &&
    link.permissions.includes(permission)
  );
}

// --- Fungsi izin ---

/**
 * Melihat produk.
 *
 * Matriks FEATURE-SPECS S3: pengrajin melihat produknya sendiri, pendamping
 * bila diizinkan, admin untuk mengurasi, pembeli hanya yang sudah terbit.
 *
 * Batas status produk bukan urusan modul ini: rbac menjawab "siapa",
 * catalog menjawab "kapan".
 */
export function canViewProduct(
  actor: Actor,
  product: ProductRef,
  link: CaregiverLink | null,
  now: number,
): boolean {
  if (!isSessionCurrent(actor)) return false;

  switch (actor.role) {
    case "artisan":
      return isOwningArtisan(actor, product);
    case "caregiver":
      // "Bila diizinkan": tautan aktif yang memberi setidaknya satu izin.
      return (
        isLinkActiveFor(actor, product, link, now) &&
        link.permissions.length > 0
      );
    case "admin":
      // Mengurasi menuntut melihat apa yang dikirim pengrajin (TC-U-RBAC-08).
      return true;
    case "buyer":
      // Pembeli hanya melihat katalog terbit (TC-U-RBAC-10, TC-U-RBAC-11).
      return product.status === "published";
    default:
      return false;
  }
}

/** Menyunting draf. Pengrajin pemilik karya, atau pendamping berizin `edit_draft`. */
export function canEditDraft(
  actor: Actor,
  product: ProductRef,
  link: CaregiverLink | null,
  now: number,
): boolean {
  if (!isSessionCurrent(actor)) return false;

  return (
    isOwningArtisan(actor, product) ||
    caregiverHasPermission(actor, product, link, "edit_draft", now)
  );
}

/** Mengunggah media. Pengrajin pemilik karya, atau pendamping berizin `upload_media`. */
export function canUploadMedia(
  actor: Actor,
  product: ProductRef,
  link: CaregiverLink | null,
  now: number,
): boolean {
  if (!isSessionCurrent(actor)) return false;

  return (
    isOwningArtisan(actor, product) ||
    caregiverHasPermission(actor, product, link, "upload_media", now)
  );
}

/** Mengajukan tinjauan. Pengrajin pemilik karya, atau pendamping berizin `submit_review`. */
export function canSubmitReview(
  actor: Actor,
  product: ProductRef,
  link: CaregiverLink | null,
  now: number,
): boolean {
  if (!isSessionCurrent(actor)) return false;

  return (
    isOwningArtisan(actor, product) ||
    caregiverHasPermission(actor, product, link, "submit_review", now)
  );
}

/**
 * Menerbitkan produk.
 *
 * Hanya pengrajin pemilik karya. Izin pendamping tidak pernah cukup — dan
 * memang tidak ada izin `publish` yang dapat diberikan, sehingga tautan
 * tidak pernah diperiksa di sini (TC-U-RBAC-04, S3-06).
 */
export function canPublish(actor: Actor, product: ProductRef): boolean {
  if (!isSessionCurrent(actor)) return false;

  return isOwningArtisan(actor, product);
}

/**
 * Menghapus produk.
 *
 * Sama seperti menerbitkan: keputusan pemilik karya. Aksi merusak tidak
 * pernah didelegasikan, jadi tautan pun tidak diperiksa (TC-U-RBAC-07).
 */
export function canDeleteProduct(actor: Actor, product: ProductRef): boolean {
  if (!isSessionCurrent(actor)) return false;

  return isOwningArtisan(actor, product);
}

/** Mengurasi produk. Admin menerima atau menolak; ia tidak menulis ulang cerita pengrajin. */
export function canCurate(actor: Actor): boolean {
  if (!isSessionCurrent(actor)) return false;

  return actor.role === "admin";
}

// --- Undangan ---

/** Batas waktu undangan: 24 jam sejak dikirim (S3-03). */
export function inviteExpiresAt(invitedAt: number): number {
  return invitedAt + LIMITS.INVITE_TTL_MS;
}

/**
 * Undangan masih dapat diterima.
 *
 * Berbeda dari `isLinkActiveFor`: status yang benar di sini justru
 * `pending`, bukan `active`. Undangan yang sudah diterima berstatus
 * `active`, sehingga tidak dapat dipakai dua kali (S3-04).
 */
export function canAcceptInvite(
  invite: CaregiverLink | null,
  now: number,
): boolean {
  return (
    invite !== null && invite.status === "pending" && invite.expiresAt > now
  );
}

// --- Pemuatan (bagian murni) ---

/**
 * Mengubah baris `caregiver_links` menjadi tautan yang dapat diperiksa.
 *
 * Kueri D1 dilakukan pemanggil; penguraian `permissions` (JSON) dan
 * `status` dilakukan di sini. Nilai yang tidak dikenali menghasilkan null —
 * bukan tautan setengah sah. Tautan null tidak pernah mengizinkan apa pun.
 */
export function parseCaregiverLink(
  row: CaregiverLinkRow | null,
): CaregiverLink | null {
  if (row === null) return null;
  if (!isCaregiverLinkStatus(row.status)) return null;

  const permissions = parsePermissions(row.permissions);
  if (permissions === null) return null;

  return {
    id: row.id,
    artisanId: row.artisan_id,
    caregiverId: row.caregiver_id,
    permissions,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

function parsePermissions(raw: string): readonly CaregiverPermission[] | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    // JSON rusak berarti isi izin tidak dapat dipastikan. Default menolak.
    return null;
  }

  const result = z.array(CaregiverPermissionSchema).safeParse(decoded);
  return result.success ? result.data : null;
}
