/**
 * Penetapan dan verifikasi PIN 6 digit.
 *
 * PIN adalah alternatif masuk bagi pengguna dengan keterbatasan kognitif
 * (`Fitur pendukung.pdf` hal. 6, PRD bagian 6). Karena itu ia harus mudah
 * diingat — dan justru karena itu ia harus disimpan dengan benar. PIN 6
 * digit hanya punya 10^6 kemungkinan; MD5 atau SHA saja dapat dihabiskan
 * seluruhnya dalam hitungan detik pada satu kartu grafis. Yang dipakai
 * adalah Argon2id.
 *
 * Implementasi Argon2id **disuntikkan**, bukan ditulis di sini. Menulis
 * Argon2id sendiri adalah cara paling andal menghasilkan kriptografi yang
 * bocor, dan menambah pustaka baru dilarang tanpa persetujuan pemilik
 * proyek (AGENTS.md). Yang ada di berkas ini adalah bagian yang justru
 * sering salah: memastikan hash yang tersimpan memang Argon2id,
 * menghitung percobaan gagal, dan mengunci akun.
 */

import { LIMITS, PinSetSchema } from "../../lib/schemas";
import type { ErrorCode } from "../../lib/errors";

/**
 * Port hashing. Implementasi nyatanya memakai Argon2id; berkas ini tidak
 * peduli pustakanya apa, hanya bahwa keluarannya string PHC Argon2id.
 */
export interface PinHasher {
  /** Menghasilkan string PHC Argon2id, misalnya `$argon2id$v=19$m=65536,t=3,p=4$...`. */
  hash(pin: string): Promise<string>;
  /**
   * Membandingkan PIN dengan hash tersimpan.
   *
   * Implementasi wajib memakai perbandingan berwaktu tetap. Perbandingan
   * biasa pada hasil hash tetap membocorkan awalan yang benar.
   */
  verify(pin: string, storedHash: string): Promise<boolean>;
}

/**
 * Bentuk PHC Argon2id. Apa pun yang tidak cocok dengan ini tidak pernah
 * diterima — termasuk hash MD5/SHA lama, hash bcrypt, dan PIN plaintext.
 */
const ARGON2ID_PATTERN = /^\$argon2id\$v=\d+\$[^$]+\$[^$]+\$[^$]+$/;

export function isArgon2idHash(storedHash: string): boolean {
  return ARGON2ID_PATTERN.test(storedHash);
}

// --- Percobaan gagal ---

export interface PinAttemptState {
  readonly failedAttempts: number;
  /** Milidetik epoch. null bila tidak sedang terkunci. */
  readonly lockedUntil: number | null;
}

export const INITIAL_PIN_ATTEMPTS: PinAttemptState = {
  failedAttempts: 0,
  lockedUntil: null,
};

/** Akun sedang terkunci. Perbandingan ketat: tepat pada `lockedUntil` sudah bebas. */
export function isPinLocked(state: PinAttemptState, nowMs: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > nowMs;
}

/**
 * Mencatat satu percobaan gagal.
 *
 * Percobaan kelima yang gagal langsung mengunci (TC-SEC-13): `>=` dipakai,
 * bukan `>`, supaya batasnya persis seperti yang tertulis di dokumen —
 * salah 5 kali, bukan salah 6 kali.
 */
export function registerFailedPinAttempt(
  state: PinAttemptState,
  nowMs: number,
): PinAttemptState {
  const failedAttempts = state.failedAttempts + 1;

  if (failedAttempts >= LIMITS.MAX_PIN_ATTEMPTS) {
    return {
      failedAttempts,
      lockedUntil: nowMs + LIMITS.PIN_LOCKOUT_MS,
    };
  }

  return { failedAttempts, lockedUntil: null };
}

/**
 * Penyimpanan keadaan percobaan gagal.
 *
 * Di produksi ia membaca dan menulis `users.pin_attempts` serta
 * `users.pin_locked_until` (migrations/0002). Dipisah sebagai port supaya
 * aturan penguncian dapat diuji tanpa basis data.
 */
export interface PinAttemptStore {
  /** Pengguna yang tidak ada mengembalikan keadaan awal, bukan null. */
  load(userId: string): Promise<PinAttemptState>;
  save(userId: string, state: PinAttemptState): Promise<void>;
}

// --- Tetapkan ---

export type PinSetResult =
  | { readonly ok: true; readonly hash: string }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Menetapkan PIN baru.
 *
 * PIN lama tidak pernah dibutuhkan di sini: penetapan terjadi setelah
 * pengguna membuktikan dirinya lewat OTP. Yang dijaga fungsi ini adalah
 * bentuk PIN dan bentuk hash yang disimpan.
 */
export async function setPin(
  pin: string,
  hasher: PinHasher,
): Promise<PinSetResult> {
  const parsed = PinSetSchema.safeParse({ pin });
  if (!parsed.success) return { ok: false, code: "UNAUTHENTICATED" };

  const hash = await hasher.hash(parsed.data.pin);

  // Hasher yang mengembalikan sesuatu selain Argon2id ditolak di sini,
  // bukan ditemukan setahun kemudian saat basis data sudah bocor.
  if (!isArgon2idHash(hash)) return { ok: false, code: "INTERNAL_ERROR" };

  return { ok: true, hash };
}

// --- Periksa ---

export type PinVerifyResult =
  | { readonly ok: true; readonly state: PinAttemptState }
  | {
      readonly ok: false;
      readonly code: ErrorCode;
      /** Keadaan yang harus disimpan pemanggil, termasuk saat terkunci. */
      readonly state: PinAttemptState;
    };

/**
 * Memeriksa PIN.
 *
 * Urutan pemeriksaan penting: kunci diperiksa **sebelum** hash disentuh,
 * supaya akun yang terkunci tidak menghabiskan waktu CPU Argon2id dan tidak
 * memberi penyerang pengukuran waktu.
 */
export async function verifyPin(
  pin: string,
  storedHash: string,
  state: PinAttemptState,
  hasher: PinHasher,
  nowMs: number,
): Promise<PinVerifyResult> {
  if (isPinLocked(state, nowMs)) {
    return { ok: false, code: "ACCOUNT_LOCKED", state };
  }

  const parsed = PinSetSchema.safeParse({ pin });
  const matches =
    parsed.success &&
    isArgon2idHash(storedHash) &&
    (await hasher.verify(parsed.data.pin, storedHash));

  if (matches) {
    return { ok: true, state: INITIAL_PIN_ATTEMPTS };
  }

  const nextState = registerFailedPinAttempt(state, nowMs);

  return {
    ok: false,
    code: isPinLocked(nextState, nowMs) ? "ACCOUNT_LOCKED" : "UNAUTHENTICATED",
    state: nextState,
  };
}
