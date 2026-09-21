/**
 * Implementasi Argon2id untuk PIN.
 *
 * Ini satu-satunya berkas di modul auth yang menyentuh pustaka kriptografi.
 * Ia dipisah dari `pin.ts` dengan sengaja: aturan PIN (bentuk hash yang
 * sah, hitungan gagal, penguncian) dapat diuji tanpa WASM, dan berkas ini
 * dapat diuji terhadap Argon2id yang sebenarnya tanpa menyeret aturan itu.
 *
 * Verifikasi TIDAK memakai `argon2Verify` dari pustaka. Fungsi itu
 * membandingkan hasilnya dengan perbandingan biasa, dan perbandingan biasa
 * pada hasil hash tetap membocorkan awalan yang benar. Di sini hash
 * diturunkan ulang dari parameter yang tersimpan, lalu dibandingkan dengan
 * `constantTimeEqual` — jebakan yang disebut eksplisit di prompt P4.
 */

import { argon2id } from "hash-wasm";

import { constantTimeEqual } from "./token";
import type { PinHasher } from "./pin";

/**
 * Parameter Argon2id.
 *
 * m=19456 KiB (19 MiB), t=2, p=1 — titik awal yang direkomendasikan OWASP
 * untuk Argon2id. Batas memorinya dipilih dengan sadar: isolat Cloudflare
 * Workers dibatasi 128 MB, jadi m=65536 (64 MiB) terlalu dekat ke tepi
 * untuk dijalankan beberapa permintaan sekaligus.
 *
 * Parameter ini disimpan di dalam string PHC, jadi mengubahnya tidak
 * membatalkan PIN yang sudah ada — verifikasi memakai parameter dari hash
 * tersimpan, bukan dari konstanta ini.
 */
const ARGON2ID_PARAMETERS = {
  parallelism: 1,
  iterations: 2,
  memorySize: 19_456,
} as const;

const SALT_BYTES = 16;
const DIGEST_BYTES = 32;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  // Argon2 menulis base64 tanpa padding; atob menuntut panjang kelipatan 4.
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    // Bukan base64 yang sah. Hash yang tidak dapat dibaca tidak pernah
    // cocok dengan apa pun; tidak ada galat yang ditelan.
    return null;
  }
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface Argon2idHashParts {
  readonly memorySize: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly digestHex: string;
  readonly digestBytes: number;
}

/** Membaca `$argon2id$v=19$m=...,t=...,p=...$salt$hash`. */
function parseArgon2idHash(storedHash: string): Argon2idHashParts | null {
  const parts = storedHash.split("$");
  // ["", "argon2id", "v=19", "m=...,t=...,p=...", salt, hash]
  if (parts.length !== 6) return null;
  if (parts[1] !== "argon2id") return null;

  const parameters = parts[3] ?? "";
  const memorySize = Number(/m=(\d+)/.exec(parameters)?.[1]);
  const iterations = Number(/t=(\d+)/.exec(parameters)?.[1]);
  const parallelism = Number(/p=(\d+)/.exec(parameters)?.[1]);

  if (!Number.isInteger(memorySize) || memorySize <= 0) return null;
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  if (!Number.isInteger(parallelism) || parallelism <= 0) return null;

  const salt = decodeBase64(parts[4] ?? "");
  const digest = decodeBase64(parts[5] ?? "");
  if (salt === null || digest === null) return null;
  if (salt.length === 0 || digest.length === 0) return null;

  return {
    memorySize,
    iterations,
    parallelism,
    salt,
    digestHex: toHex(digest),
    digestBytes: digest.length,
  };
}

/**
 * Hasher Argon2id untuk produksi.
 *
 * `hash` memakai garam acak 16 bita dari `crypto.getRandomValues`, jadi dua
 * PIN yang sama menghasilkan hash yang berbeda — tanpa itu, dua pengrajin
 * dengan PIN yang sama akan terlihat sama di basis data.
 */
export function createArgon2idPinHasher(): PinHasher {
  return {
    hash: async (pin) => {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));

      return argon2id({
        password: pin,
        salt,
        parallelism: ARGON2ID_PARAMETERS.parallelism,
        iterations: ARGON2ID_PARAMETERS.iterations,
        memorySize: ARGON2ID_PARAMETERS.memorySize,
        hashLength: DIGEST_BYTES,
        outputType: "encoded",
      });
    },

    verify: async (pin, storedHash) => {
      const parts = parseArgon2idHash(storedHash);
      if (parts === null) return false;

      let derived: string;
      try {
        derived = await argon2id({
          password: pin,
          salt: parts.salt,
          parallelism: parts.parallelism,
          iterations: parts.iterations,
          memorySize: parts.memorySize,
          hashLength: parts.digestBytes,
          outputType: "hex",
        });
      } catch {
        // Pustaka melempar pada masukan yang tidak dapat diprosesnya —
        // misalnya kata sandi kosong. Verifier tidak boleh melempar: galat
        // yang lolos dari sini akan menjadi 500 di rute, dan 500 berbeda
        // dari 401 sehingga dapat dipakai membedakan masukan. Gagal
        // menutup, tanpa suara.
        return false;
      }

      return constantTimeEqual(derived, parts.digestHex);
    },
  };
}
