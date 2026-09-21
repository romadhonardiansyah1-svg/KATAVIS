/**
 * Primitif kriptografi bersama.
 *
 * Berkas ini ada karena dua modul membutuhkan hal yang sama: `auth`
 * menandatangani token sesi, `media` menandatangani URL unggah. Keduanya
 * memakai HMAC-SHA256 lewat Web Crypto, dan keduanya membutuhkan pengodean
 * base64url serta perbandingan berwaktu tetap.
 *
 * Menyalin potongan-potongan ini ke dua tempat berarti ada dua kesempatan
 * untuk salah pada hal yang paling tidak boleh salah. Karena itu ia tinggal
 * di `lib`, satu-satunya lapisan yang boleh dipakai seluruh modul
 * (ADR-001).
 *
 * Tidak ada dependensi baru di sini: seluruhnya Web Crypto, yang tersedia
 * di Workers maupun di Node sejak versi 18.
 */

/**
 * Perbandingan berwaktu tetap.
 *
 * `===` pada string berhenti di karakter pertama yang berbeda, dan selisih
 * waktunya cukup untuk menebak rahasia karakter demi karakter. Panjang yang
 * berbeda pun tetap dihitung sampai habis, bukan keluar lebih awal.
 */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);

  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * null bila masukan bukan base64url yang sah — masukan yang dirusak berakhir
 * di sini.
 *
 * Tipe kembalian menyebut `ArrayBuffer` secara eksplisit: `Uint8Array` tanpa
 * parameter berarti `ArrayBufferLike`, yang dapat berupa `SharedArrayBuffer`
 * dan karena itu tidak diterima `crypto.subtle`.
 */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalised.length % 4)) % 4);

  try {
    const binary = atob(normalised + padding);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    // atob melempar pada panjang atau karakter yang tidak sah. Masukan yang
    // tidak dapat didekode tidak pernah sah; tidak ada yang ditelan.
    return null;
  }
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacKey(signingKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function hmacSign(
  signingInput: string,
  signingKey: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(signingKey),
    new TextEncoder().encode(signingInput),
  );
  return new Uint8Array(signature);
}

/**
 * Memeriksa tanda tangan.
 *
 * Memakai `crypto.subtle.verify`, bukan membandingkan hasil HMAC sendiri:
 * verify sudah berwaktu tetap, sementara perbandingan yang ditulis tangan
 * akan mengembalikan persoalan yang justru dihindari `constantTimeEqual`.
 */
export async function hmacVerify(
  signingInput: string,
  signature: Uint8Array<ArrayBuffer>,
  signingKey: string,
): Promise<boolean> {
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(signingKey),
    signature,
    new TextEncoder().encode(signingInput),
  );
}
