/**
 * Penerbitan, penyegaran, dan pembatalan token.
 *
 * Token ditandatangani HS256 lewat Web Crypto — tidak ada dependensi baru,
 * dan tidak ada pustaka JWT yang perlu dipercaya. Karena seluruh verifikasi
 * ada di berkas ini, bentuk klaimnya pun ditetapkan di sini.
 *
 * DUA SATUAN WAKTU, dan ini disengaja:
 *
 *   - Klaim `iat` dan `exp` memakai DETIK epoch, sesuai RFC 7519
 *     (NumericDate). `LIMITS.ACCESS_TOKEN_TTL_S` juga sudah dalam detik,
 *     dan kontrak API bagian 2 menampilkan `expiresIn: 900`.
 *   - Argumen `nowMs` pada fungsi di berkas ini memakai MILIDETIK, karena
 *     seluruh modul lain memakai `now: number` dalam milidetik
 *     (AGENTS.md: "Waktu epoch milidetik (integer)").
 *
 * Percampuran ini adalah tempat kesalahan paling mudah terjadi, jadi
 * konversinya hanya ada di satu fungsi: `toSeconds`. Jangan menambahkan
 * konversi di tempat lain.
 */

import {
  base64UrlToBytes,
  bytesToBase64Url,
  hmacSign,
  hmacVerify,
} from "../../lib/crypto";
import { LIMITS, RoleSchema, UlidSchema, type Role } from "../../lib/schemas";

export type TokenKind = "access" | "refresh";

export interface TokenPayload {
  /** ULID pengguna. */
  readonly sub: string;
  readonly role: Role;
  /**
   * Versi token saat token diterbitkan. Setiap permintaan membandingkannya
   * dengan nilai terkini di `users.token_version`.
   */
  readonly tokenVersion: number;
  readonly kind: TokenKind;
  /** Detik epoch (RFC 7519 NumericDate). */
  readonly iat: number;
  /** Detik epoch (RFC 7519 NumericDate). */
  readonly exp: number;
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Detik. Kontrak API bagian 2 menampilkan `expiresIn: 900`. */
  readonly expiresIn: number;
}

export interface TokenIssuer {
  readonly subject: string;
  readonly role: Role;
  readonly tokenVersion: number;
}

const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;
const MS_PER_SECOND = 1000;

/** Turunan dari LIMITS, bukan angka baru. */
const REFRESH_TOKEN_TTL_S = LIMITS.REFRESH_TOKEN_TTL_MS / MS_PER_SECOND;

function toSeconds(epochMs: number): number {
  return Math.floor(epochMs / MS_PER_SECOND);
}

// --- Primitif ---

/**
 * Diteruskan dari `lib/crypto` untuk pemanggil yang sudah ada.
 *
 * Implementasinya pindah ke `lib` karena `worker/media` membutuhkan
 * primitif yang sama untuk menandatangani URL unggah. Menyalinnya berarti
 * ada dua kesempatan untuk salah pada hal yang paling tidak boleh salah.
 */
export { constantTimeEqual } from "../../lib/crypto";

// --- Terbitkan ---

async function signToken(payload: TokenPayload, signingKey: string): Promise<string> {
  const header = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(JWT_HEADER)),
  );
  const body = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signingInput = `${header}.${body}`;
  const signature = await hmacSign(signingInput, signingKey);

  return `${signingInput}.${bytesToBase64Url(signature)}`;
}

/**
 * Menerbitkan pasangan token.
 *
 * Keduanya memuat `tokenVersion` yang sama. Itulah yang membuat
 * `logout-all` berlaku untuk access DAN refresh token sekaligus: satu
 * kenaikan versi, dua-duanya mati.
 */
export async function issueTokens(
  issuer: TokenIssuer,
  signingKey: string,
  nowMs: number,
): Promise<TokenPair> {
  const issuedAt = toSeconds(nowMs);

  const accessToken = await signToken(
    {
      sub: issuer.subject,
      role: issuer.role,
      tokenVersion: issuer.tokenVersion,
      kind: "access",
      iat: issuedAt,
      exp: issuedAt + LIMITS.ACCESS_TOKEN_TTL_S,
    },
    signingKey,
  );

  const refreshToken = await signToken(
    {
      sub: issuer.subject,
      role: issuer.role,
      tokenVersion: issuer.tokenVersion,
      kind: "refresh",
      iat: issuedAt,
      exp: issuedAt + REFRESH_TOKEN_TTL_S,
    },
    signingKey,
  );

  return { accessToken, refreshToken, expiresIn: LIMITS.ACCESS_TOKEN_TTL_S };
}

// --- Periksa ---

function decodePayload(bodyPart: string): TokenPayload | null {
  const bytes = base64UrlToBytes(bodyPart);
  if (bytes === null) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // Muatan bukan JSON. Token tidak sah; tidak ada yang ditelan.
    return null;
  }

  if (typeof decoded !== "object" || decoded === null) return null;
  const candidate = decoded as Record<string, unknown>;

  // Tanda tangan hanya membuktikan token ini pernah kita terbitkan. Isinya
  // tetap diperiksa terhadap skema yang sama seperti data luar lainnya.
  const subject = UlidSchema.safeParse(candidate.sub);
  const role = RoleSchema.safeParse(candidate.role);
  const kind =
    candidate.kind === "access" || candidate.kind === "refresh"
      ? candidate.kind
      : null;
  const issuedAt = typeof candidate.iat === "number" ? candidate.iat : null;
  const expiresAt = typeof candidate.exp === "number" ? candidate.exp : null;
  const tokenVersion =
    typeof candidate.tokenVersion === "number" ? candidate.tokenVersion : null;

  if (
    !subject.success ||
    !role.success ||
    kind === null ||
    issuedAt === null ||
    expiresAt === null ||
    tokenVersion === null
  ) {
    return null;
  }

  return {
    sub: subject.data,
    role: role.data,
    tokenVersion,
    kind,
    iat: issuedAt,
    exp: expiresAt,
  };
}

/**
 * Memeriksa tanda tangan dan masa berlaku. null berarti ditolak.
 *
 * Seluruh kegagalan mengembalikan nilai yang sama — bentuk token yang
 * salah, tanda tangan yang tidak cocok, dan token kedaluwarsa tidak dapat
 * dibedakan dari luar. Tidak ada satu pun jalur yang melempar.
 */
export async function verifyJwt(
  token: string,
  signingKey: string,
  nowMs: number,
): Promise<TokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerPart, bodyPart, signaturePart] = parts;
  if (headerPart === undefined || bodyPart === undefined) return null;
  if (signaturePart === undefined || signaturePart.length === 0) return null;

  const signature = base64UrlToBytes(signaturePart);
  if (signature === null) return null;

  // `hmacVerify` membandingkan tanda tangan tanpa membocorkan waktu;
  // membandingkannya sendiri dengan `===` akan mengembalikan masalah yang
  // justru dihindari constantTimeEqual.
  const signatureIsValid = await hmacVerify(
    `${headerPart}.${bodyPart}`,
    signature,
    signingKey,
  );
  if (!signatureIsValid) return null;

  const payload = decodePayload(bodyPart);
  if (payload === null) return null;
  if (payload.exp <= toSeconds(nowMs)) return null;

  return payload;
}

// --- Pembatalan ---

/**
 * Token masih cocok dengan keadaan pengguna saat ini.
 *
 * Perbandingan **kesamaan**, bukan `>=`. Token dengan versi lebih tinggi
 * dari basis data tidak mungkin diterbitkan oleh sistem ini, jadi ia pasti
 * dipalsukan — dan menolaknya sama pentingnya dengan menolak versi lama.
 */
export function isTokenVersionCurrent(
  payload: TokenPayload,
  currentTokenVersion: number,
): boolean {
  return payload.tokenVersion === currentTokenVersion;
}

/**
 * `logout-all`: satu kenaikan versi membatalkan seluruh token yang beredar.
 *
 * Inilah yang membuat pencabutan berlaku seketika. Tanpa kenaikan ini,
 * logout-all hanya menghapus baris refresh token di basis data sementara
 * access token lama tetap sah sampai kedaluwarsa.
 */
export function nextTokenVersion(current: number): number {
  return current + 1;
}

/**
 * Refresh masih dalam jendela 30 hari sejak aktivitas terakhir.
 *
 * PRD bagian 6: "Habis masa setelah 30 hari tidak aktif". Yang dihitung
 * adalah aktivitas terakhir, bukan waktu token diterbitkan — sesi yang
 * dipakai setiap hari tidak boleh mati hanya karena tokennya berumur 30
 * hari. Diuji di TC-SEC-21.
 */
export function isRefreshWithinIdleWindow(
  lastSeenAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - lastSeenAtMs <= LIMITS.REFRESH_TOKEN_TTL_MS;
}

/**
 * Penyegaran token diizinkan.
 *
 * Ketiga syarat diperiksa di sini, bukan di pemanggil: tokennya memang
 * refresh token, versinya masih cocok, dan sesinya belum menganggur terlalu
 * lama. Memeriksa `tokenVersion` pada jalur refresh adalah yang paling
 * mudah terlupa — access token mungkin sudah ditolak sementara refresh
 * token yang sama masih diterima.
 */
export function canRefreshToken(
  payload: TokenPayload,
  user: { readonly tokenVersion: number; readonly lastSeenAtMs: number },
  nowMs: number,
): boolean {
  return (
    payload.kind === "refresh" &&
    isTokenVersionCurrent(payload, user.tokenVersion) &&
    isRefreshWithinIdleWindow(user.lastSeenAtMs, nowMs)
  );
}
