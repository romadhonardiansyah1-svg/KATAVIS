/**
 * Penyajian objek media ke peramban.
 *
 * MENGAPA BERKAS INI ADA
 * ---------------------
 * Sebelum ini tidak ada satu pun rute yang mengirimkan byte gambar ke
 * peramban. Satu-satunya pembacaan R2 di seluruh Worker ada di
 * `/media/:mediaId/confirm`, dan itu pun untuk memeriksa magic bytes di
 * server — hasilnya tidak pernah keluar.
 *
 * Sementara itu `GET /public/catalog/:slug` dan `GET /products/:id`
 * mengembalikan `media[].url` berisi KUNCI R2 mentah, misalnya
 * `products/<ulid>/foto-asli.jpg`. Peramban membacanya sebagai alamat
 * relatif terhadap origin aplikasi, sehingga setiap `<img>` meminta
 * `http://<origin>/products/<ulid>/foto-asli.jpg` dan menerima 404.
 * Akibatnya foto tidak pernah tampil di halaman katalog publik maupun di
 * layar tinjau — pada demo, ini terlihat sebagai gambar rusak di tempat
 * yang paling dilihat juri.
 *
 * Kontrak API bagian 5 sudah memakai URL bertanda tangan untuk UNGGAH.
 * Berkas ini memakai pola yang sama untuk MEMBACA, dengan alasan yang sama:
 * presigned URL dari API S3 R2 menuntut kredensial yang belum ada dan tidak
 * dapat diuji di Miniflare (catatan di `upload.ts` baris 293–306), sedangkan
 * URL bertanda tangan milik sendiri sudah terbukti dan teruji.
 *
 * KENAPA BERTANDA TANGAN, BUKAN RUTE PUBLIK TERBUKA
 * -------------------------------------------------
 * Kunci R2 memuat ULID produk. Rute terbuka tanpa tanda tangan berarti
 * siapa pun yang menebak atau melihat satu kunci dapat menyusuri aset
 * produk lain, termasuk produk yang masih draf dan belum pernah terbit.
 * Tanda tangan mengikat URL ke satu kunci dan satu masa berlaku, sehingga
 * URL yang bocor mati dengan sendirinya.
 *
 * Masa berlakunya lebih panjang daripada URL unggah: URL unggah hanya
 * dipakai sekali dalam hitungan detik, sedangkan URL baca tertanam di HTML
 * halaman katalog dan tersimpan di cache peramban pembeli.
 */

import { bytesToBase64Url, base64UrlToBytes, hmacSign, hmacVerify } from "../../lib/crypto";
import type { ErrorCode } from "../../lib/errors";

import { isSafeMediaKey } from "./upload";

/**
 * Masa berlaku URL baca — 24 jam.
 *
 * Tidak diambil dari `LIMITS.UPLOAD_URL_TTL_MS` (15 menit, ditetapkan untuk
 * satu kali `PUT`). URL ini tertanam di HTML yang di-cache peramban pembeli,
 * dan tautan katalog dibagikan lewat WhatsApp lalu dibuka berjam-jam
 * kemudian. Angka 15 menit akan membuat gambar hilang di tengah percakapan
 * jual-beli, dan itu bukan kegagalan yang terlihat saat pengujian.
 */
export const MEDIA_READ_TTL_MS = 24 * 60 * 60 * 1000;

/** Awalan rute baca. Bentuknya ditetapkan di sini, seperti `UPLOAD_PATH`. */
const MEDIA_READ_PATH = "/api/v1/media/";

/**
 * Jenis MIME yang boleh disajikan.
 *
 * Sengaja daftar tertutup, bukan nilai apa pun dari basis data. Baris
 * `media_assets.mime_type` sudah diperiksa magic bytes-nya saat konfirmasi,
 * tetapi `Content-Type` yang ditentukan penyerang dapat memicu sniffing di
 * peramban. Nilai yang tidak dikenal jatuh ke `application/octet-stream`
 * lewat `mediaContentType`, bukan diteruskan apa adanya.
 */
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Jenis yang aman dikirim apa adanya. Selain ini menjadi octet-stream. */
export function mediaContentType(mimeType: string): string {
  return INLINE_TYPES.has(mimeType) ? mimeType : "application/octet-stream";
}

interface MediaReadTokenPayload {
  readonly key: string;
  readonly expiresAt: number;
}

/**
 * Menerbitkan URL baca bertanda tangan untuk satu kunci R2.
 *
 * Mengembalikan `null` bila kuncinya tidak aman. Pemanggil yang menerima
 * `null` tidak boleh mengarang URL: lebih baik tidak ada gambar daripada
 * ada URL yang dapat dipakai menyusuri aset produk lain.
 */
export async function createSignedMediaUrl(
  input: { readonly r2Key: string; readonly nowMs: number },
  origin: string,
  signingKey: string,
): Promise<string | null> {
  if (!isSafeMediaKey(input.r2Key)) return null;

  const payload: MediaReadTokenPayload = {
    key: input.r2Key,
    expiresAt: input.nowMs + MEDIA_READ_TTL_MS,
  };

  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmacSign(body, signingKey));

  return `${origin.replace(/\/+$/, "")}${MEDIA_READ_PATH}${body}.${signature}`;
}

export type MediaReadVerification =
  | { readonly ok: true; readonly r2Key: string }
  | { readonly ok: false; readonly code: ErrorCode };

function decodeMediaReadPayload(body: string): MediaReadTokenPayload | null {
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

  // Kunci dari dalam token diperiksa ulang terhadap awalan `products/`.
  // Tanda tangan membuktikan token ini pernah kita terbitkan, bukan bahwa
  // isinya masih masuk akal bila penerbitnya kelak berubah — pemeriksaan
  // yang sama dilakukan `decodeUploadPayload`.
  if (typeof candidate.key !== "string" || !isSafeMediaKey(candidate.key)) return null;
  if (typeof candidate.expiresAt !== "number") return null;

  return { key: candidate.key, expiresAt: candidate.expiresAt };
}

/**
 * Memeriksa token baca.
 *
 * Tepat pada `expiresAt` sudah dianggap lewat, konsisten dengan
 * `verifyUploadToken` dan pemeriksaan masa berlaku token sesi.
 *
 * Seluruh kegagalan mengembalikan satu kode yang sama. Penyerang tidak perlu
 * tahu apakah tanda tangannya salah, tokennya cacat, atau sudah
 * kedaluwarsa — dan pembeli yang menemui tautan mati tidak dapat berbuat
 * apa-apa terhadap ketiganya selain memuat ulang halaman.
 */
export async function verifyMediaReadToken(
  token: string,
  signingKey: string,
  nowMs: number,
): Promise<MediaReadVerification> {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, code: "FORBIDDEN" };

  const [body, signaturePart] = parts;
  if (body === undefined || signaturePart === undefined) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const signature = base64UrlToBytes(signaturePart);
  if (signature === null) return { ok: false, code: "FORBIDDEN" };
  if (!(await hmacVerify(body, signature, signingKey))) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const payload = decodeMediaReadPayload(body);
  if (payload === null) return { ok: false, code: "FORBIDDEN" };
  if (payload.expiresAt <= nowMs) return { ok: false, code: "FORBIDDEN" };

  return { ok: true, r2Key: payload.key };
}
