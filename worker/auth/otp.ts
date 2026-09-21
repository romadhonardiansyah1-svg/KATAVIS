/**
 * Permintaan dan verifikasi OTP.
 *
 * Nomor HP adalah identitas, dan OTP adalah satu-satunya cara masuk tanpa
 * PIN. Dua hal menentukan bentuk berkas ini:
 *
 *   1. Respons permintaan OTP **seragam** untuk nomor terdaftar maupun
 *      tidak (TC-SEC-14). Mekanismenya bukan penyamaan keluaran di akhir,
 *      melainkan ketiadaan pemeriksaan: `requestOtp` tidak pernah menyentuh
 *      tabel `users`, sehingga tidak ada cabang yang bisa membocorkan
 *      keberadaan sebuah nomor. Untuk platform yang melayani kelompok
 *      rentan, ini bukan masalah kecil.
 *
 *   2. Batas laju disimpan lewat port `RateLimitStore`, bukan di memori
 *      Worker. Isolat dapat dimatikan kapan saja dan hitungannya akan
 *      hilang bersama prosesnya — batas laju yang hidup di memori adalah
 *      batas laju yang tidak ada.
 */

import type { ErrorCode } from "../../lib/errors";
import { OtpRequestSchema, OtpVerifySchema } from "../../lib/schemas";

import { constantTimeEqual } from "./token";

/**
 * Batas laju dari kontrak API bagian 2: "3 permintaan per nomor per jam,
 * 10 per IP per jam. Terlampaui → 429, RATE_LIMITED".
 */
export const OTP_RATE_LIMIT = {
  perPhonePerHour: 3,
  perIpPerHour: 10,
  windowMs: 60 * 60 * 1000,
} as const;

/**
 * Kebijakan masa berlaku kode.
 *
 * Angka-angka ini tidak ada di dokumen mana pun — kontrak API bagian 2
 * hanya menampilkan `expiresAt` dan `resendAfter` tanpa menyebut nilainya,
 * dan `LIMITS` di lib/schemas.ts tidak memuatnya. Nilai di bawah diputuskan
 * pemilik proyek pada 17 September 2026; sebelum itu `otp.ts` menerimanya
 * sebagai parameter murni dan tidak mengarang apa pun.
 */
export interface OtpPolicy {
  readonly codeTtlMs: number;
  readonly resendAfterMs: number;
}

/** Kode berlaku 5 menit; kirim ulang boleh setelah 60 detik. */
export const DEFAULT_OTP_POLICY: OtpPolicy = {
  codeTtlMs: 5 * 60 * 1000,
  resendAfterMs: 60 * 1000,
};

export interface OtpChallenge {
  readonly phone: string;
  /** SHA-256 heksadesimal dari kode. Kode mentah tidak pernah disimpan. */
  readonly codeHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface OtpStore {
  /** Menyimpan tantangan, menggantikan yang lama untuk nomor yang sama. */
  save(challenge: OtpChallenge): Promise<void>;
  find(phone: string): Promise<OtpChallenge | null>;
  remove(phone: string): Promise<void>;
}

export interface RateLimitStore {
  /** Mencatat satu kejadian pada kunci tertentu. */
  record(key: string, at: number): Promise<void>;
  /** Menghitung kejadian pada kunci sejak waktu tertentu. */
  countSince(key: string, since: number): Promise<number>;
  /**
   * Membuang kejadian yang lebih tua dari `before`.
   *
   * Dipanggil sekali per permintaan, bukan per pencatatan. Tanpa ini tabel
   * batas laju tumbuh selamanya — setiap permintaan menambah dua baris yang
   * tidak akan pernah dibaca lagi.
   */
  prune(before: number): Promise<void>;
}

export interface OtpRequestDeps {
  readonly store: OtpStore;
  readonly rateLimit: RateLimitStore;
  readonly policy: OtpPolicy;
  /** Pembangkit kode 6 digit. Disuntikkan agar uji dapat menentukan kodenya. */
  readonly generateCode: () => string;
  /** Pengiriman SMS. Tidak dipanggil bila batas laju terlampaui. */
  readonly sendCode: (phone: string, code: string) => Promise<void>;
}

/** Kunci batas laju. Sengaja memuat nomor dan IP apa adanya agar dapat ditelusuri saat demo. */
export function phoneRateLimitKey(phone: string): string {
  return `otp:phone:${phone}`;
}

export function ipRateLimitKey(clientIp: string): string {
  return `otp:ip:${clientIp}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type OtpRequestResult =
  | {
      readonly ok: true;
      readonly expiresAt: number;
      readonly resendAfter: number;
    }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Meminta kode OTP.
 *
 * Bentuk keberhasilan selalu sama, dan dihitung dari `nowMs` yang sama,
 * sehingga dua permintaan yang berbeda nomor tidak dapat dibedakan dari
 * responsnya.
 */
export async function requestOtp(
  input: { readonly phone: string; readonly clientIp: string },
  deps: OtpRequestDeps,
  nowMs: number,
): Promise<OtpRequestResult> {
  const parsed = OtpRequestSchema.safeParse({ phone: input.phone });
  if (!parsed.success) return { ok: false, code: "UNAUTHENTICATED" };

  const phoneKey = phoneRateLimitKey(parsed.data.phone);
  const ipKey = ipRateLimitKey(input.clientIp);
  const windowStart = nowMs - OTP_RATE_LIMIT.windowMs;

  await deps.rateLimit.prune(windowStart);

  const phoneCount = await deps.rateLimit.countSince(phoneKey, windowStart);
  const ipCount = await deps.rateLimit.countSince(ipKey, windowStart);

  if (
    phoneCount >= OTP_RATE_LIMIT.perPhonePerHour ||
    ipCount >= OTP_RATE_LIMIT.perIpPerHour
  ) {
    return { ok: false, code: "RATE_LIMITED" };
  }

  await deps.rateLimit.record(phoneKey, nowMs);
  await deps.rateLimit.record(ipKey, nowMs);

  const code = deps.generateCode();
  const expiresAt = nowMs + deps.policy.codeTtlMs;

  await deps.store.save({
    phone: parsed.data.phone,
    codeHash: await sha256Hex(code),
    createdAt: nowMs,
    expiresAt,
  });
  await deps.sendCode(parsed.data.phone, code);

  return {
    ok: true,
    expiresAt,
    resendAfter: nowMs + deps.policy.resendAfterMs,
  };
}

export type OtpVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Memeriksa kode OTP.
 *
 * Kode yang benar langsung dihapus: sekali pakai. Kode yang kedaluwarsa juga
 * dihapus, supaya tidak ada sisa yang bisa dicoba lagi setelah waktunya
 * lewat.
 */
export async function verifyOtp(
  input: { readonly phone: string; readonly code: string },
  store: OtpStore,
  nowMs: number,
): Promise<OtpVerifyResult> {
  const parsed = OtpVerifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "UNAUTHENTICATED" };

  const challenge = await store.find(parsed.data.phone);
  if (challenge === null) return { ok: false, code: "UNAUTHENTICATED" };

  if (challenge.expiresAt <= nowMs) {
    await store.remove(parsed.data.phone);
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  // Perbandingan berwaktu tetap: `===` pada kode berhenti di digit pertama
  // yang berbeda, dan selisih waktunya cukup untuk menebak kode digit demi
  // digit.
  const submittedHash = await sha256Hex(parsed.data.code);
  if (!constantTimeEqual(submittedHash, challenge.codeHash)) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  await store.remove(parsed.data.phone);
  return { ok: true };
}
