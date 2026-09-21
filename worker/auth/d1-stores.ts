/**
 * Implementasi D1 dari seluruh port modul auth.
 *
 * Berkas ini adalah satu-satunya tempat di modul auth yang menulis SQL, dan
 * satu-satunya yang membutuhkan basis data. Itulah tujuannya: aturan di
 * `otp.ts`, `pin.ts`, dan `middleware.ts` tetap dapat diuji tanpa D1,
 * sementara yang berhubungan dengan penyimpanan berkumpul di sini dan dapat
 * diperiksa sekaligus.
 *
 * Skema yang dipakai: migrations/0002_auth.sql.
 *
 * Setiap kueri memakai parameter terikat. Tidak ada nilai dari luar yang
 * pernah masuk ke dalam string SQL — aturan ini berlaku untuk seluruh
 * berkas, bukan hanya untuk nomor telepon.
 */

import type { UserSessionLookup } from "./middleware";
import type { OtpStore, RateLimitStore } from "./otp";
import { INITIAL_PIN_ATTEMPTS, type PinAttemptStore } from "./pin";

interface OtpCodeRow {
  readonly phone: string;
  readonly code_hash: string;
  readonly created_at: number;
  readonly expires_at: number;
}

interface TokenVersionRow {
  readonly token_version: number;
}

interface PinAttemptRow {
  readonly pin_attempts: number;
  readonly pin_locked_until: number | null;
}

interface CountRow {
  readonly total: number;
}

/**
 * Satu nomor punya paling banyak satu kode aktif, jadi `phone` menjadi kunci
 * utama dan permintaan baru menimpa yang lama. Tanpa ini, tiga permintaan
 * berturut-turut meninggalkan tiga kode yang semuanya masih sah.
 */
export function d1OtpStore(db: D1Database): OtpStore {
  return {
    save: async (challenge) => {
      await db
        .prepare(
          `INSERT INTO otp_codes (phone, code_hash, created_at, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(phone) DO UPDATE SET
             code_hash = excluded.code_hash,
             created_at = excluded.created_at,
             expires_at = excluded.expires_at`,
        )
        .bind(
          challenge.phone,
          challenge.codeHash,
          challenge.createdAt,
          challenge.expiresAt,
        )
        .run();
    },

    find: async (phone) => {
      const row = await db
        .prepare(
          "SELECT phone, code_hash, created_at, expires_at FROM otp_codes WHERE phone = ?",
        )
        .bind(phone)
        .first<OtpCodeRow>();

      if (row === null) return null;

      return {
        phone: row.phone,
        codeHash: row.code_hash,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    },

    remove: async (phone) => {
      await db.prepare("DELETE FROM otp_codes WHERE phone = ?").bind(phone).run();
    },
  };
}

/**
 * Batas laju berbasis kejadian.
 *
 * Jendelanya dihitung dari `occurred_at`, bukan dari jam dinding: tiga
 * permintaan pada 14.59 tidak membuka jendela baru pada 15.00.
 */
export function d1RateLimitStore(db: D1Database): RateLimitStore {
  return {
    record: async (key, at) => {
      await db
        .prepare("INSERT INTO auth_rate_limits (key, occurred_at) VALUES (?, ?)")
        .bind(key, at)
        .run();
    },

    countSince: async (key, since) => {
      const row = await db
        .prepare(
          `SELECT COUNT(*) AS total FROM auth_rate_limits
           WHERE key = ? AND occurred_at >= ?`,
        )
        .bind(key, since)
        .first<CountRow>();

      return row?.total ?? 0;
    },

    prune: async (before) => {
      await db
        .prepare("DELETE FROM auth_rate_limits WHERE occurred_at < ?")
        .bind(before)
        .run();
    },
  };
}

/** Membaca `users.token_version` pada setiap permintaan. */
export function d1SessionLookup(db: D1Database): UserSessionLookup {
  return {
    findTokenVersion: async (userId) => {
      const row = await db
        .prepare("SELECT token_version FROM users WHERE id = ?")
        .bind(userId)
        .first<TokenVersionRow>();

      return row?.token_version ?? null;
    },
  };
}

export function d1PinAttemptStore(db: D1Database): PinAttemptStore {
  return {
    load: async (userId) => {
      const row = await db
        .prepare("SELECT pin_attempts, pin_locked_until FROM users WHERE id = ?")
        .bind(userId)
        .first<PinAttemptRow>();

      // Pengguna yang tidak ada mengembalikan keadaan awal, bukan null:
      // pemanggil tidak perlu membedakan "belum pernah gagal" dari "tidak
      // ada", dan perbedaan itu tidak boleh membocorkan apa pun.
      if (row === null) return INITIAL_PIN_ATTEMPTS;

      return {
        failedAttempts: row.pin_attempts,
        lockedUntil: row.pin_locked_until,
      };
    },

    save: async (userId, state) => {
      await db
        .prepare(
          "UPDATE users SET pin_attempts = ?, pin_locked_until = ? WHERE id = ?",
        )
        .bind(state.failedAttempts, state.lockedUntil, userId)
        .run();
    },
  };
}

/**
 * Menyimpan hash PIN baru.
 *
 * Penetapan PIN selalu mengosongkan hitungan gagal dan membuka kunci. Tanpa
 * itu, pengrajin yang baru saja mengganti PIN bisa mendapati dirinya masih
 * terkunci karena kesalahan sebelum ia menggantinya.
 */
export async function d1SavePinHash(
  db: D1Database,
  userId: string,
  hash: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET pin_hash = ?, pin_attempts = 0, pin_locked_until = NULL
       WHERE id = ?`,
    )
    .bind(hash, userId)
    .run();
}

// --- Direktori pengguna ---

export interface AuthUserRecord {
  readonly id: string;
  readonly phone: string;
  readonly displayName: string;
  readonly role: string;
  readonly locale: string;
  readonly a11yProfile: string | null;
  readonly tokenVersion: number;
  readonly pinHash: string | null;
  /** Aktivitas terakhir. Jendela menganggur refresh token diukur dari sini. */
  readonly lastSeenAt: number | null;
}

interface UserRow {
  readonly id: string;
  readonly phone: string;
  readonly display_name: string;
  readonly role: string;
  readonly locale: string;
  readonly a11y_profile: string | null;
  readonly token_version: number;
  readonly pin_hash: string | null;
  readonly last_seen_at: number | null;
}

const USER_COLUMNS =
  "id, phone, display_name, role, locale, a11y_profile, token_version, pin_hash, last_seen_at";

function toUser(row: UserRow): AuthUserRecord {
  return {
    id: row.id,
    phone: row.phone,
    displayName: row.display_name,
    role: row.role,
    locale: row.locale,
    a11yProfile: row.a11y_profile,
    tokenVersion: row.token_version,
    pinHash: row.pin_hash,
    lastSeenAt: row.last_seen_at,
  };
}

export async function d1FindUserByPhone(
  db: D1Database,
  phone: string,
): Promise<AuthUserRecord | null> {
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE phone = ?`)
    .bind(phone)
    .first<UserRow>();

  return row === null ? null : toUser(row);
}

/** Dipakai jalur refresh dan ekspor, yang keduanya hanya punya id pengguna. */
export async function d1FindUserById(
  db: D1Database,
  userId: string,
): Promise<AuthUserRecord | null> {
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(userId)
    .first<UserRow>();

  return row === null ? null : toUser(row);
}

/**
 * Nama tampilan awal pengrajin baru.
 *
 * Bukan nomor teleponnya: nama tampilan ikut dikirim ke katalog publik
 * (kontrak API bagian 10 menyatakan nomor telepon tidak pernah ke sana), dan
 * menaruh nomor di situ akan membocorkannya lewat pintu belakang.
 *
 * Kontrak API tidak punya endpoint untuk mengubah nama tampilan. Selama itu
 * belum ada, nilai ini yang muncul di setiap ekspor — dan F4-05 menuntut
 * nama pengrajin ada di sana. Dicatat sebagai pertanyaan untuk pemilik
 * kontrak.
 */
export const INITIAL_DISPLAY_NAME = "Pengrajin";

export async function d1CreateUser(
  db: D1Database,
  input: { readonly id: string; readonly phone: string; readonly role: string },
  nowMs: number,
): Promise<AuthUserRecord> {
  await db
    .prepare(
      `INSERT INTO users (id, phone, display_name, role, locale, token_version, created_at)
       VALUES (?, ?, ?, ?, 'id', 0, ?)`,
    )
    .bind(input.id, input.phone, INITIAL_DISPLAY_NAME, input.role, nowMs)
    .run();

  return {
    id: input.id,
    phone: input.phone,
    displayName: INITIAL_DISPLAY_NAME,
    role: input.role,
    locale: "id",
    a11yProfile: null,
    tokenVersion: 0,
    pinHash: null,
    lastSeenAt: nowMs,
  };
}

/**
 * Menaikkan `token_version` dan mengembalikan nilai barunya.
 *
 * Inilah `logout-all` dan pencabutan akses pendamping: satu kenaikan
 * membatalkan seluruh token yang beredar, seketika, tanpa menunggu
 * kedaluwarsa (TC-I-04, TC-SEC-16).
 */
export async function d1BumpTokenVersion(
  db: D1Database,
  userId: string,
): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE users SET token_version = token_version + 1
       WHERE id = ?
       RETURNING token_version`,
    )
    .bind(userId)
    .first<TokenVersionRow>();

  return row?.token_version ?? null;
}

/**
 * Menetapkan peran pengguna.
 *
 * Dipakai saat undangan pendamping diterima: orang yang mengundang adalah
 * pengrajin, dan yang menerima bertindak sebagai pendamping. Satu kolom
 * peran, jadi perannya berpindah — dan token lamanya harus dimatikan,
 * karena peran di dalamnya sudah tidak benar lagi.
 */
export async function d1SetUserRole(
  db: D1Database,
  userId: string,
  role: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET role = ? WHERE id = ?")
    .bind(role, userId)
    .run();
}

export async function d1TouchLastSeen(
  db: D1Database,
  userId: string,
  nowMs: number,
): Promise<void> {
  await db
    .prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
    .bind(nowMs, userId)
    .run();
}

export async function d1SaveA11yProfile(
  db: D1Database,
  userId: string,
  profile: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET a11y_profile = ? WHERE id = ?")
    .bind(profile, userId)
    .run();
}
