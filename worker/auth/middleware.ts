/**
 * verifyToken — middleware pemeriksaan sesi.
 *
 * Dipanggil di awal setiap rute yang butuh identitas. Ia menjawab satu
 * pertanyaan: "siapa ini, dan apakah sesinya masih sah?" — bukan "boleh
 * melakukan apa". Yang kedua adalah tugas `worker/rbac`, dan pemisahan itu
 * disengaja: rbac menguji aturannya tanpa basis data, auth menyediakan
 * datanya.
 *
 * Peran HANYA diambil dari token yang tanda tangannya sudah diperiksa.
 * Apa pun yang dikirim klien di badan permintaan atau header lain diabaikan
 * sepenuhnya — memeriksa peran dari klien bukan otorisasi, melainkan
 * kesopanan (TC-SEC-05).
 */

import { apiError, type ErrorCode } from "../../lib/errors";

import { isTokenVersionCurrent, verifyJwt } from "./token";

/**
 * Hasil pemeriksaan, sudah dalam bentuk yang dibutuhkan `worker/rbac.Actor`.
 *
 * `sessionTokenVersion` adalah versi di dalam token, `currentTokenVersion`
 * versi terkini di basis data. Keduanya diteruskan apa adanya supaya rbac
 * dapat memeriksanya sendiri pada setiap fungsi izin — pencabutan akses
 * pendamping menaikkan versi, dan token lama harus berhenti berlaku
 * seketika, bukan menunggu kedaluwarsa.
 */
export interface VerifiedSession {
  readonly userId: string;
  readonly role: string;
  readonly sessionTokenVersion: number;
  readonly currentTokenVersion: number;
}

export interface UserSessionLookup {
  /** null bila pengguna tidak ada. */
  findTokenVersion(userId: string): Promise<number | null>;
}

export type TokenVerification =
  | { readonly ok: true; readonly session: VerifiedSession }
  | { readonly ok: false; readonly response: Response };

function deny(code: ErrorCode): TokenVerification {
  return { ok: false, response: apiError(code) };
}

/** `Authorization: Bearer <token>`. Skema dibandingkan tanpa peduli huruf besar-kecil. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header === null) return null;

  const separator = header.indexOf(" ");
  if (separator === -1) return null;

  const scheme = header.slice(0, separator);
  const value = header.slice(separator + 1).trim();

  if (scheme.toLowerCase() !== "bearer" || value.length === 0) return null;

  return value;
}

/**
 * Memeriksa permintaan dan mengembalikan sesinya.
 *
 * Empat penolakan, satu kode: tanpa token (TC-SEC-01), token kedaluwarsa
 * (TC-SEC-02), tanda tangan tidak cocok atau token dirusak (TC-SEC-03), dan
 * `token_version` tidak lagi cocok (TC-SEC-16). Semuanya `UNAUTHENTICATED`
 * dengan pesan yang sama — penyerang tidak perlu tahu yang mana yang gagal.
 */
export async function verifyToken(
  request: Request,
  lookup: UserSessionLookup,
  signingKey: string,
  nowMs: number,
): Promise<TokenVerification> {
  const token = bearerToken(request);
  if (token === null) return deny("UNAUTHENTICATED");

  const payload = await verifyJwt(token, signingKey, nowMs);
  if (payload === null) return deny("UNAUTHENTICATED");

  // Refresh token tidak pernah membuka rute biasa. Kalau ini tidak
  // diperiksa, refresh token berumur 30 hari menjadi kunci induk.
  if (payload.kind !== "access") return deny("UNAUTHENTICATED");

  const currentTokenVersion = await lookup.findTokenVersion(payload.sub);
  if (currentTokenVersion === null) return deny("UNAUTHENTICATED");

  if (!isTokenVersionCurrent(payload, currentTokenVersion)) {
    return deny("UNAUTHENTICATED");
  }

  return {
    ok: true,
    session: {
      userId: payload.sub,
      role: payload.role,
      sessionTokenVersion: payload.tokenVersion,
      currentTokenVersion,
    },
  };
}
