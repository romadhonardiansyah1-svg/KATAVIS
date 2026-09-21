/**
 * Validasi unggahan media dan kunci R2.
 *
 * Dua hal yang menentukan seluruh berkas ini:
 *
 *   1. **Yang diperiksa isinya, bukan namanya.** Ekstensi dan MIME yang
 *      dikirim klien keduanya dapat ditulis apa saja oleh klien. Berkas
 *      `.jpg` berisi HTML akan lolos setiap pemeriksaan berbasis nama.
 *      Yang dipakai di sini adalah magic bytes (TC-U-CAT-06, TC-SEC-09).
 *
 *   2. **Kunci R2 tidak pernah disusun dari masukan mentah.** Kunci dibentuk
 *      dari ULID yang sudah divalidasi bentuknya, lalu diperiksa sekali lagi
 *      sebelum dikembalikan. Kunci yang memuat `..` atau diawali `/` dapat
 *      menulis di luar awalan `products/` (TC-SEC-10).
 *
 * Berkas ini murni: tidak ada D1, R2, maupun jaringan. Yang berhubungan
 * dengan penyimpanan objek dan URL bertanda tangan menunggu keputusan
 * pemilik proyek soal jalur transfer berkas — lihat catatan di akhir
 * berkas.
 */

import { apiError, apiOk, type ErrorCode } from "../../lib/errors";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  hmacSign,
  hmacVerify,
} from "../../lib/crypto";
import {
  ALLOWED_IMAGE_MIME,
  IMAGE_MAGIC_BYTES,
  LIMITS,
  MediaPatchSchema,
  UlidSchema,
  UploadUrlRequestSchema,
  type MediaKind,
} from "../../lib/schemas";

/** Turunan dari tabel di lib/schemas.ts, bukan daftar baru. */
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

const EXTENSION_BY_MIME: Readonly<Record<AllowedImageMime, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Awalan kunci. Semua objek media berada di bawah `products/`. */
const MEDIA_KEY_PREFIX = "products/";

/** Awalan berkas per jenis aset. Foto asli dan hasil generate tidak pernah berbagi awalan. */
const LABEL_BY_KIND: Readonly<Record<MediaKind, string>> = {
  photo_original: "original",
  photo_studio: "studio",
  audio_raw: "audio",
  audio_tts: "tts",
};

// --- Validasi permintaan unggah ---

/**
 * Muatan mentah dari klien.
 *
 * Ketiga bidangnya opsional karena memang bisa hilang: ini badan permintaan
 * yang datang dari luar, dan bentuk yang tidak lengkap adalah hal yang wajar
 * ditemui, bukan pengecualian yang perlu ditangani terpisah.
 */
export interface UploadRequestInput {
  readonly kind?: unknown;
  readonly mimeType?: unknown;
  readonly bytes?: unknown;
}

export type UploadRequestResult =
  | {
      readonly ok: true;
      readonly kind: MediaKind;
      readonly mimeType: AllowedImageMime;
      readonly bytes: number;
    }
  | { readonly ok: false; readonly code: ErrorCode };

function isAllowedImageMime(value: unknown): value is AllowedImageMime {
  return (
    typeof value === "string" &&
    (ALLOWED_IMAGE_MIME as readonly string[]).includes(value)
  );
}

/**
 * Memeriksa permintaan `POST /products/:id/media/upload-url`.
 *
 * Urutannya disengaja: ukuran dan format diperiksa lebih dulu supaya galat
 * yang keluar tepat, bukan seragam. Kontrak API bagian 5 memetakan
 * `bytes > 10 MB` ke `FILE_TOO_LARGE` dan MIME di luar daftar ke
 * `UNSUPPORTED_FORMAT` — dua kalimat berbeda untuk dua masalah berbeda.
 *
 * `image/svg+xml` jatuh ke `UNSUPPORTED_FORMAT` bukan karena ia bukan
 * gambar, melainkan karena SVG dapat memuat skrip dan akan berjalan di
 * domain yang sama dengan katalog (TC-SEC-09).
 */
export function validateUploadRequest(
  input: UploadRequestInput,
): UploadRequestResult {
  if (typeof input.bytes === "number" && input.bytes > LIMITS.MAX_UPLOAD_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE" };
  }

  if (typeof input.mimeType === "string" && !isAllowedImageMime(input.mimeType)) {
    return { ok: false, code: "UNSUPPORTED_FORMAT" };
  }

  const parsed = UploadUrlRequestSchema.safeParse(input);
  if (!parsed.success) {
    // Sisa kemungkinan adalah bentuk permintaan yang tidak sah: `kind` di
    // luar skema, `bytes` bukan bilangan bulat positif, atau `mimeType`
    // bukan teks. Katalog galat tidak punya kode untuk validasi masukan,
    // jadi yang dipakai adalah kode terdekat — dan ini dicatat sebagai
    // pertanyaan untuk pemilik kontrak API.
    return { ok: false, code: "UNSUPPORTED_FORMAT" };
  }

  return {
    ok: true,
    kind: parsed.data.kind,
    mimeType: parsed.data.mimeType,
    bytes: parsed.data.bytes,
  };
}

// --- Magic bytes ---

/**
 * Menentukan jenis gambar dari isinya.
 *
 * null berarti tidak ada tanda tangan yang cocok — dan itu berarti berkasnya
 * bukan gambar yang didukung, apa pun namanya.
 *
 * Satu pelengkap di luar tabel: `IMAGE_MAGIC_BYTES` memberi empat bita
 * pertama untuk WebP, yaitu `RIFF`. Empat bita itu juga dipakai WAV dan AVI,
 * sehingga berkas suara yang dinamai `.webp` akan lolos. Spesifikasi RIFF
 * menaruh penanda format di offset 8, jadi pemeriksaan itu ditambahkan.
 * Tabelnya tetap dari lib/schemas.ts; yang dilengkapi hanya satu entri yang
 * memang belum lengkap.
 */
export function detectImageMime(bytes: Uint8Array): AllowedImageMime | null {
  for (const mimeType of ALLOWED_IMAGE_MIME) {
    const signature = IMAGE_MAGIC_BYTES[mimeType];
    if (signature === undefined || signature.length > bytes.length) continue;

    const matches = signature.every(
      (byte, index) => bytes[index] === byte,
    );
    if (!matches) continue;

    if (mimeType === "image/webp" && !hasWebpChunkType(bytes)) continue;

    return mimeType;
  }

  return null;
}

/** `WEBP` pada offset 8, sesuai spesifikasi RIFF. */
function hasWebpChunkType(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export type ImageContentResult =
  | { readonly ok: true; readonly mimeType: AllowedImageMime }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Memeriksa isi berkas terhadap jenis yang dinyatakan klien.
 *
 * Dipanggil pada `POST /products/:id/media/:mediaId/confirm`, setelah `PUT`
 * selesai. Isi yang cocok dengan jenis lain tetap ditolak: berkas PNG yang
 * dinyatakan sebagai JPEG berarti klien salah menamai, dan menyimpannya
 * dengan jenis yang salah akan merusak tampilan katalog di kemudian hari.
 */
export function verifyImageContent(
  bytes: Uint8Array,
  declaredMime: string,
): ImageContentResult {
  const detected = detectImageMime(bytes);
  if (detected === null) return { ok: false, code: "CONTENT_MISMATCH" };
  if (detected !== declaredMime) return { ok: false, code: "CONTENT_MISMATCH" };

  return { ok: true, mimeType: detected };
}

// --- Kunci R2 ---

export interface MediaKeyInput {
  readonly productId: string;
  readonly mediaId: string;
  readonly kind: MediaKind;
  readonly mimeType: AllowedImageMime;
}

export type MediaKeyResult =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Kunci objek yang aman, atau penolakan.
 *
 * `productId` dan `mediaId` datang dari URL, jadi keduanya diperlakukan
 * sebagai masukan yang tidak dipercaya. Bentuk ULID sudah cukup untuk
 * menutup path traversal — ULID hanya berisi huruf dan angka Crockford,
 * tanpa `/` maupun `.` — tetapi hasilnya tetap diperiksa sekali lagi.
 * Satu pemeriksaan yang bergantung pada asumsi tunggal adalah pemeriksaan
 * yang gagal diam-diam saat asumsinya berubah.
 */
export function buildMediaKey(input: MediaKeyInput): MediaKeyResult {
  const productId = UlidSchema.safeParse(input.productId);
  const mediaId = UlidSchema.safeParse(input.mediaId);
  if (!productId.success || !mediaId.success) {
    // Bukan ULID berarti tidak ada sumber daya seperti itu.
    return { ok: false, code: "NOT_FOUND" };
  }

  const key = `${MEDIA_KEY_PREFIX}${productId.data}/${LABEL_BY_KIND[input.kind]}-${mediaId.data}.${EXTENSION_BY_MIME[input.mimeType]}`;

  if (!isSafeMediaKey(key)) return { ok: false, code: "NOT_FOUND" };

  return { ok: true, key };
}

/**
 * Kunci berada di dalam awalan `products/` dan tidak memuat bagian relatif.
 *
 * Dipisah dan diekspor supaya invariannya dapat diuji langsung, dan supaya
 * pemanggil lain yang menyusun kunci sendiri dapat memeriksanya.
 */
export function isSafeMediaKey(key: string): boolean {
  if (!key.startsWith(MEDIA_KEY_PREFIX)) return false;
  if (key.includes("..")) return false;
  if (key.includes("//")) return false;
  // Backslash tidak berarti apa-apa bagi R2, tetapi ia menyembunyikan
  // maksud pada tinjauan kode dan pada sistem berkas yang menyalinnya.
  if (key.includes("\\")) return false;
  return key.length > MEDIA_KEY_PREFIX.length;
}

/**
 * Kunci untuk aset hasil generate.
 *
 * Selalu aset BARU dengan `mediaId` baru, dan selalu berawalan `studio-`.
 * Foto asli tidak pernah ditimpa: kegagalan generate mempertahankan foto
 * pengrajin, dan keberhasilan menambahkan berkas kedua di sebelahnya
 * (AGENTS.md aturan 7, TC-E2E-13).
 */
export function buildGeneratedMediaKey(
  input: Omit<MediaKeyInput, "kind">,
): MediaKeyResult {
  return buildMediaKey({ ...input, kind: "photo_studio" });
}

// --- Suntingan media ---

export interface MediaPatchInput {
  readonly altText?: unknown;
  readonly isPrimary?: unknown;
}

export type MediaPatchResult =
  | {
      readonly ok: true;
      readonly altText: string | undefined;
      readonly isPrimary: boolean | undefined;
    }
  | { readonly ok: false; readonly code: ErrorCode };

/** Memeriksa `PATCH /products/:id/media/:mediaId`. */
export function parseMediaPatch(input: MediaPatchInput): MediaPatchResult {
  const parsed = MediaPatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "UNSUPPORTED_FORMAT" };

  return {
    ok: true,
    altText: parsed.data.altText,
    isPrimary: parsed.data.isPrimary,
  };
}

// --- URL bertanda tangan ---
//
// Kontrak API bagian 5 menyatakan klien `PUT` langsung ke `uploadUrl`.
// Yang dipakai di sini adalah URL bertanda tangan milik kita sendiri:
// tanda tangan HMAC-SHA256 atas (kunci objek, jenis MIME, masa berlaku),
// diperiksa sebuah rute Worker sebelum isi permintaan diteruskan ke R2.
//
// Alternatifnya, presigned URL dari API S3 R2, akan lebih sesuai dengan
// kalimat "Worker tidak pernah menyalurkan berkas" di kontrak. Ia tidak
// dipilih karena menuntut kredensial R2 yang belum ada di `.env.example`
// maupun daftar `wrangler secret put`, dan karena Miniflare tidak
// menyediakan API S3 — sehingga kode penandatangannya tidak akan pernah
// diuji sebelum hari-H. Untuk berkas maksimal 10 MB, meneruskan isi
// permintaan tanpa buffering berada jauh di dalam batas Workers.

/**
 * Masa berlaku URL unggah.
 *
 * Diambil dari `LIMITS.UPLOAD_URL_TTL_MS` — 15 menit, dan komentar di sana
 * sudah menunjuk TC-I-06. Angka itu tidak diketik ulang di sini.
 */
export const UPLOAD_TOKEN_TTL_MS = LIMITS.UPLOAD_URL_TTL_MS;

/** Awalan rute. `uploadUrl` di kontrak hanya ditulis "https://...", jadi bentuknya ditetapkan di sini. */
const UPLOAD_PATH = "/api/v1/media/upload/";

export interface SignedUpload {
  readonly uploadUrl: string;
  readonly expiresAt: number;
}

interface UploadTokenPayload {
  readonly key: string;
  readonly mimeType: AllowedImageMime;
  readonly expiresAt: number;
}

/**
 * Menerbitkan URL unggah bertanda tangan.
 *
 * Masa berlaku memakai MILIDETIK epoch, konsisten dengan seluruh sistem
 * (AGENTS.md: "Waktu epoch milidetik"). Token ini tidak mengikuti RFC mana
 * pun, jadi tidak ada alasan mengadopsi detik seperti pada klaim JWT.
 */
export async function createSignedUpload(
  input: { readonly r2Key: string; readonly mimeType: AllowedImageMime; readonly nowMs: number },
  origin: string,
  signingKey: string,
): Promise<SignedUpload> {
  const expiresAt = input.nowMs + UPLOAD_TOKEN_TTL_MS;
  const payload: UploadTokenPayload = {
    key: input.r2Key,
    mimeType: input.mimeType,
    expiresAt,
  };

  const body = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = bytesToBase64Url(await hmacSign(body, signingKey));

  return {
    uploadUrl: `${origin.replace(/\/+$/, "")}${UPLOAD_PATH}${body}.${signature}`,
    expiresAt,
  };
}

export type UploadVerification =
  | {
      readonly ok: true;
      readonly r2Key: string;
      readonly mimeType: AllowedImageMime;
    }
  | { readonly ok: false; readonly code: ErrorCode };

function denyUpload(): UploadVerification {
  // Satu kode untuk seluruh kegagalan — tanda tangan tidak cocok, token
  // tidak berbentuk, dan sudah kedaluwarsa. Penyerang tidak perlu tahu yang
  // mana, dan pengrajin tidak dapat berbuat apa-apa terhadap ketiganya
  // selain meminta URL baru.
  return { ok: false, code: "FORBIDDEN" };
}

function decodeUploadPayload(body: string): UploadTokenPayload | null {
  const bytes = base64UrlToBytes(body);
  if (bytes === null) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }

  if (typeof decoded !== "object" || decoded === null) return null;
  const candidate = decoded as Record<string, unknown>;

  // Kunci dari dalam token tetap diperiksa terhadap awalan `products/`.
  // Tanda tangan membuktikan token ini pernah kita terbitkan, bukan bahwa
  // isinya masih masuk akal bila penerbitnya kelak berubah.
  if (typeof candidate.key !== "string" || !isSafeMediaKey(candidate.key)) {
    return null;
  }
  if (!isAllowedImageMime(candidate.mimeType)) return null;
  if (typeof candidate.expiresAt !== "number") return null;

  return {
    key: candidate.key,
    mimeType: candidate.mimeType,
    expiresAt: candidate.expiresAt,
  };
}

/**
 * Memeriksa token unggah.
 *
 * Tepat pada `expiresAt` sudah dianggap lewat, sama seperti masa berlaku
 * token sesi. Diuji di TC-I-06 dan TC-SEC-11.
 */
export async function verifyUploadToken(
  token: string,
  signingKey: string,
  nowMs: number,
): Promise<UploadVerification> {
  const parts = token.split(".");
  if (parts.length !== 2) return denyUpload();

  const [body, signaturePart] = parts;
  if (body === undefined || signaturePart === undefined) return denyUpload();

  const signature = base64UrlToBytes(signaturePart);
  if (signature === null) return denyUpload();
  if (!(await hmacVerify(body, signature, signingKey))) return denyUpload();

  const payload = decodeUploadPayload(body);
  if (payload === null) return denyUpload();
  if (payload.expiresAt <= nowMs) return denyUpload();

  return { ok: true, r2Key: payload.key, mimeType: payload.mimeType };
}

// --- Rute unggah ---

export interface UploadRouteDeps {
  readonly signingKey: string;
  readonly nowMs: number;
}

function tokenFromRequest(request: Request): string | null {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(UPLOAD_PATH)) return null;

  const token = pathname.slice(UPLOAD_PATH.length);
  return token.length === 0 ? null : token;
}

function declaredLength(request: Request): number | null {
  const header = request.headers.get("Content-Length");
  if (header === null) return null;

  const value = Number(header);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Menangani `PUT` ke URL bertanda tangan.
 *
 * Isi permintaan diteruskan ke R2 tanpa dibuffer: `request.body` adalah
 * stream, dan R2 menerima stream. Berkas 10 MB tidak pernah utuh di memori
 * isolat.
 *
 * Magic bytes TIDAK diperiksa di sini. Kontrak API bagian 5 menaruh
 * pemeriksaan itu di `POST .../confirm`, dan pemisahan itu masuk akal:
 * unggahan yang gagal di tengah jalan tidak perlu menahan seluruh isinya
 * hanya untuk ditolak.
 */
export async function handleSignedUpload(
  request: Request,
  media: R2Bucket,
  deps: UploadRouteDeps,
): Promise<Response> {
  if (request.method !== "PUT") return apiError("FORBIDDEN");

  const token = tokenFromRequest(request);
  if (token === null) return apiError("FORBIDDEN");

  const verified = await verifyUploadToken(token, deps.signingKey, deps.nowMs);
  if (!verified.ok) return apiError(verified.code);

  // Ukuran yang tidak dapat dipastikan sebelum ditulis diperlakukan sebagai
  // terlalu besar. Menulis objek yang tidak dapat dibatasi lebih buruk
  // daripada menolak unggahan.
  const bytes = declaredLength(request);
  if (bytes === null || bytes > LIMITS.MAX_UPLOAD_BYTES) {
    return apiError("FILE_TOO_LARGE");
  }

  if (request.body === null) return apiError("CONTENT_MISMATCH");

  await media.put(verified.r2Key, request.body, {
    httpMetadata: { contentType: verified.mimeType },
  });

  // Bentuk respons ini tidak diatur kontrak — `uploadUrl` hanya ditulis
  // "https://..." di sana. Yang dikembalikan adalah dua hal yang dibutuhkan
  // klien sebelum memanggil `/confirm`: kunci objeknya dan ukurannya.
  return apiOk({ key: verified.r2Key, bytes });
}
