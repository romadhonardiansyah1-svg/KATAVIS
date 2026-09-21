/**
 * Uji Argon2id terhadap implementasi sebenarnya.
 *
 * Berbeda dari `pin.test.ts` yang memakai hasher palsu, di sini hash benar-
 * benar diturunkan. Yang diuji adalah hal-hal yang tidak dapat diuji dengan
 * ganda: keluarannya memang Argon2id yang sah, garamnya acak, dan verifikasi
 * memakai parameter dari hash tersimpan.
 */

import { argon2id } from "hash-wasm";
import { describe, expect, it } from "vitest";

import { LIMITS } from "../../lib/schemas";

import { createArgon2idPinHasher } from "./argon2id";
import {
  INITIAL_PIN_ATTEMPTS,
  isArgon2idHash,
  setPin,
  verifyPin,
  type PinAttemptState,
} from "./pin";

const NOW_MS = 1_700_000_000_000;
const PIN = "123456";

describe("auth — Argon2id sebenarnya", () => {
  it("menghasilkan hash PHC Argon2id yang diterima penjaga di pin.ts", async () => {
    const result = await setPin(PIN, createArgon2idPinHasher());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Penjaga di pin.ts dan implementasi di argon2id.ts harus sepakat soal
    // apa yang disebut "hash Argon2id". Kalau tidak, seluruh alur PIN mati
    // dan penyebabnya sulit terlihat.
    expect(isArgon2idHash(result.hash)).toBe(true);
    expect(result.hash.startsWith("$argon2id$v=19$")).toBe(true);
    expect(result.hash).not.toContain(PIN);
  });

  it("memberi hash berbeda untuk PIN yang sama", async () => {
    // Garam acak: dua pengrajin dengan PIN sama tidak boleh terlihat sama
    // di basis data.
    const hasher = createArgon2idPinHasher();
    const first = await hasher.hash(PIN);
    const second = await hasher.hash(PIN);

    expect(first).not.toBe(second);
    expect(await hasher.verify(PIN, first)).toBe(true);
    expect(await hasher.verify(PIN, second)).toBe(true);
  });

  it("menerima PIN yang benar dan menolak yang salah", async () => {
    const hasher = createArgon2idPinHasher();
    const hash = await hasher.hash(PIN);

    expect(await hasher.verify(PIN, hash)).toBe(true);
    expect(await hasher.verify("123457", hash)).toBe(false);
    expect(await hasher.verify("654321", hash)).toBe(false);
    expect(await hasher.verify("", hash)).toBe(false);
  });

  it.each([
    ["", "kosong"],
    ["$argon2id$v=19$m=19456,t=2,p=1$c2FsdA", "bagian kurang"],
    ["$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA$ekstra", "bagian lebih"],
    ["$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA", "algoritme lain"],
    ["$argon2id$v=19$m=0,t=2,p=1$c2FsdA$aGFzaA", "memori nol"],
    ["$argon2id$v=19$m=19456,t=0,p=1$c2FsdA$aGFzaA", "iterasi nol"],
    ["$argon2id$v=19$m=19456,t=2,p=1$!!!$aGFzaA", "garam bukan base64"],
    ["$argon2id$v=19$m=19456,t=2,p=1$$aGFzaA", "garam kosong"],
  ])("menolak hash %s (%s) tanpa melempar", async (broken) => {
    const hasher = createArgon2idPinHasher();
    expect(await hasher.verify(PIN, broken)).toBe(false);
  });

  it("memakai parameter dari hash tersimpan, bukan dari konstanta", async () => {
    // Hash lama yang dibuat dengan parameter berbeda tetap dapat
    // diverifikasi setelah konstanta di kode berubah. Tanpa ini, setiap
    // penyesuaian parameter akan mengunci seluruh pengguna.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const legacy = await argon2id({
      password: PIN,
      salt,
      parallelism: 2,
      iterations: 1,
      memorySize: 8192,
      hashLength: 16,
      outputType: "encoded",
    });

    const hasher = createArgon2idPinHasher();
    expect(isArgon2idHash(legacy)).toBe(true);
    expect(await hasher.verify(PIN, legacy)).toBe(true);
    expect(await hasher.verify("000000", legacy)).toBe(false);
  });

  it("bekerja bersama verifyPin sampai akun terkunci", async () => {
    const hasher = createArgon2idPinHasher();
    const stored = await setPin(PIN, hasher);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;

    const accepted = await verifyPin(PIN, stored.hash, INITIAL_PIN_ATTEMPTS, hasher, NOW_MS);
    expect(accepted.ok).toBe(true);

    let state: PinAttemptState = INITIAL_PIN_ATTEMPTS;
    for (let attempt = 0; attempt < LIMITS.MAX_PIN_ATTEMPTS; attempt += 1) {
      const result = await verifyPin("000000", stored.hash, state, hasher, NOW_MS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      state = result.state;
    }

    expect(state.failedAttempts).toBe(LIMITS.MAX_PIN_ATTEMPTS);
    expect(state.lockedUntil).toBe(NOW_MS + LIMITS.PIN_LOCKOUT_MS);
  });
});
