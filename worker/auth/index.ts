/**
 * Ekspor publik modul auth.
 *
 * Modul lain hanya boleh memanggil lewat berkas ini (ADR-001). Isinya:
 *
 *   otp.ts        permintaan dan verifikasi kode, batas laju
 *   pin.ts        penetapan dan verifikasi PIN, penguncian akun
 *   argon2id.ts   implementasi Argon2id untuk PIN
 *   token.ts      terbit, periksa, segarkan, batalkan token
 *   middleware.ts verifyToken untuk dipasang di awal rute
 *   d1-stores.ts  satu-satunya berkas yang menulis SQL
 *
 * Aturan di `otp.ts`, `pin.ts`, `token.ts`, dan `middleware.ts` tidak
 * menyentuh basis data sama sekali. Itulah yang membuat kasus ujinya
 * berjalan tanpa D1, dan yang membuat penggantian penyimpanan kelak tidak
 * menyentuh satu pun aturan keamanannya.
 */

export { createArgon2idPinHasher } from "./argon2id";

export {
  DEFAULT_OTP_POLICY,
  OTP_RATE_LIMIT,
  ipRateLimitKey,
  phoneRateLimitKey,
  requestOtp,
  verifyOtp,
} from "./otp";

export type {
  OtpChallenge,
  OtpPolicy,
  OtpRequestDeps,
  OtpRequestResult,
  OtpStore,
  OtpVerifyResult,
  RateLimitStore,
} from "./otp";

export {
  INITIAL_PIN_ATTEMPTS,
  isArgon2idHash,
  isPinLocked,
  registerFailedPinAttempt,
  setPin,
  verifyPin,
} from "./pin";

export type {
  PinAttemptState,
  PinAttemptStore,
  PinHasher,
  PinSetResult,
  PinVerifyResult,
} from "./pin";

export {
  canRefreshToken,
  constantTimeEqual,
  isRefreshWithinIdleWindow,
  isTokenVersionCurrent,
  issueTokens,
  nextTokenVersion,
  verifyJwt,
} from "./token";

export type {
  TokenIssuer,
  TokenKind,
  TokenPair,
  TokenPayload,
} from "./token";

export { verifyToken } from "./middleware";

export type {
  TokenVerification,
  UserSessionLookup,
  VerifiedSession,
} from "./middleware";

export {
  d1OtpStore,
  d1PinAttemptStore,
  d1RateLimitStore,
  d1SavePinHash,
  d1SessionLookup,
  d1BumpTokenVersion,
  d1CreateUser,
  d1FindUserByPhone,
  d1FindUserById,
  d1SaveA11yProfile,
  d1SetUserRole,
  d1TouchLastSeen,
} from "./d1-stores";
