/**
 * Kasus uji PIN — TC-SEC-13.
 *
 * Hasher di sini adalah ganda uji, bukan kriptografi. Implementasi Argon2id
 * yang sebenarnya disuntikkan dari luar `pin.ts`; yang diuji di sini adalah
 * aturan yang justru sering salah: hash yang tersimpan harus benar-benar
 * Argon2id, percobaan gagal dihitung, dan akun terkunci pada percobaan
 * kelima.
 */

import { describe, expect, it } from "vitest";

import { LIMITS } from "../../lib/schemas";

import {
  INITIAL_PIN_ATTEMPTS,
  isArgon2idHash,
  isPinLocked,
  registerFailedPinAttempt,
  setPin,
  verifyPin,
  type PinAttemptState,
  type PinHasher,
} from "./pin";

const NOW_MS = 1_700_000_000_000;
const PIN = "123456";

/**
 * Hasher palsu UNTUK UJI SAJA.
 *
 * Ia TIDAK melakukan Argon2id dan tidak boleh dipakai di produksi. Tugasnya
 * hanya menghasilkan string berbentuk PHC yang sah, supaya aturan di
 * `pin.ts` dapat diuji tanpa dependensi kriptografi. Implementasi
 * sebenarnya disuntikkan dari luar.
 */
const PHC_PREFIX = "$argon2id$v=19$m=19456,t=2,p=1$";

interface FakeHasher extends PinHasher {
  readonly calls: { hash: number; verify: number };
}

function fakeHasher(): FakeHasher {
  const calls = { hash: 0, verify: 0 };

  const encode = (value: string): string =>
    `${PHC_PREFIX}${btoa(`salt:${value}`)}$${btoa(`digest:${value}`)}`;

  return {
    calls,
    hash: async (pin) => {
      calls.hash += 1;
      return encode(pin);
    },
    verify: async (pin, storedHash) => {
      calls.verify += 1;
      return storedHash === encode(pin);
    },
  };
}

/** Menetapkan PIN dan mengembalikan hash tersimpannya. */
async function storedPin(hasher: PinHasher): Promise<string> {
  const result = await setPin(PIN, hasher);
  if (!result.ok) throw new Error("Penetapan PIN uji gagal");
  return result.hash;
}

describe("auth — bentuk hash PIN", () => {
  it("menyimpan PIN sebagai hash Argon2id", async () => {
    const hasher = fakeHasher();
    const result = await setPin(PIN, hasher);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isArgon2idHash(result.hash)).toBe(true);
    expect(result.hash.startsWith("$argon2id$")).toBe(true);
    expect(result.hash).not.toContain(PIN);
  });

  it("menolak PIN yang bukan 6 angka", async () => {
    const hasher = fakeHasher();

    for (const pin of ["12345", "1234567", "12345a", "", "12 456"]) {
      const result = await setPin(pin, hasher);
      expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    }

    // PIN yang tidak sah tidak pernah sampai ke hasher.
    expect(hasher.calls.hash).toBe(0);
  });

  it("menolak hasher yang mengembalikan sesuatu selain Argon2id", async () => {
    const broken: PinHasher = {
      hash: async () => "5f4dcc3b5aa765d61d8327deb882cf99",
      verify: async () => false,
    };

    // Hash yang salah algoritme ditolak saat penetapan, bukan ditemukan
    // setahun kemudian saat basis data sudah bocor.
    expect(await setPin(PIN, broken)).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
    });
  });

  it.each([
    ["$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA", "PHC Argon2id", true],
    ["$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA", "parameter lain", true],
    ["$argon2i$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA", "Argon2i", false],
    ["$argon2d$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA", "Argon2d", false],
    ["$2b$10$N9qo8uLOickgx2ZMRZoMye", "bcrypt", false],
    ["5f4dcc3b5aa765d61d8327deb882cf99", "MD5", false],
    ["123456", "plaintext", false],
    ["", "kosong", false],
  ])("mengenali %s sebagai %s: %s", (storedHash, _label, expected) => {
    expect(isArgon2idHash(storedHash)).toBe(expected);
  });
});

describe("auth — penguncian setelah percobaan gagal", () => {
  it("mengunci akun 15 menit setelah 5 percobaan gagal", async () => {
    // TC-SEC-13
    const hasher = fakeHasher();
    const hash = await storedPin(hasher);
    let state: PinAttemptState = INITIAL_PIN_ATTEMPTS;

    for (let attempt = 1; attempt < LIMITS.MAX_PIN_ATTEMPTS; attempt += 1) {
      const result = await verifyPin("000000", hash, state, hasher, NOW_MS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("UNAUTHENTICATED");
      state = result.state;
    }

    // Percobaan kelima yang gagal langsung mengunci.
    const fifth = await verifyPin("000000", hash, state, hasher, NOW_MS);
    expect(fifth.ok).toBe(false);
    if (fifth.ok) return;

    expect(fifth.code).toBe("ACCOUNT_LOCKED");
    expect(fifth.state.failedAttempts).toBe(LIMITS.MAX_PIN_ATTEMPTS);
    expect(fifth.state.lockedUntil).toBe(NOW_MS + LIMITS.PIN_LOCKOUT_MS);
    expect(LIMITS.MAX_PIN_ATTEMPTS).toBe(5);
    expect(LIMITS.PIN_LOCKOUT_MS).toBe(15 * 60 * 1000);
  });

  it("menolak PIN yang benar selama akun terkunci, tanpa menghitung hash", async () => {
    const hasher = fakeHasher();
    const hash = await storedPin(hasher);
    const locked: PinAttemptState = {
      failedAttempts: LIMITS.MAX_PIN_ATTEMPTS,
      lockedUntil: NOW_MS + LIMITS.PIN_LOCKOUT_MS,
    };

    const verificationsBefore = hasher.calls.verify;
    const result = await verifyPin(PIN, hash, locked, hasher, NOW_MS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ACCOUNT_LOCKED");
    // Hash tidak disentuh sama sekali: akun terkunci tidak menghabiskan
    // waktu CPU Argon2id dan tidak memberi penyerang pengukuran waktu.
    expect(hasher.calls.verify).toBe(verificationsBefore);
  });

  it("membuka kunci setelah 15 menit berlalu", () => {
    const state = registerFailedPinAttempt(
      { failedAttempts: 4, lockedUntil: null },
      NOW_MS,
    );
    const unlockedAt = NOW_MS + LIMITS.PIN_LOCKOUT_MS;

    expect(isPinLocked(state, NOW_MS)).toBe(true);
    expect(isPinLocked(state, unlockedAt - 1)).toBe(true);
    // Tepat pada lockedUntil sudah bebas.
    expect(isPinLocked(state, unlockedAt)).toBe(false);
  });

  it("menerima PIN yang benar dan mengosongkan hitungan gagal", async () => {
    const hasher = fakeHasher();
    const hash = await storedPin(hasher);
    const afterThreeFailures: PinAttemptState = {
      failedAttempts: 3,
      lockedUntil: null,
    };

    const result = await verifyPin(PIN, hash, afterThreeFailures, hasher, NOW_MS);

    expect(result).toEqual({ ok: true, state: INITIAL_PIN_ATTEMPTS });
    expect(result.state.failedAttempts).toBe(0);
  });

  it.each([
    ["5f4dcc3b5aa765d61d8327deb882cf99", "MD5"],
    ["$2b$10$N9qo8uLOickgx2ZMRZoMye", "bcrypt"],
    ["$argon2i$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA", "Argon2i"],
    [PIN, "PIN plaintext"],
    ["", "kosong"],
  ])("menolak hash tersimpan %s (%s) tanpa memanggil hasher", async (storedHash, _label) => {
    const hasher = fakeHasher();
    const result = await verifyPin(
      PIN,
      storedHash,
      INITIAL_PIN_ATTEMPTS,
      hasher,
      NOW_MS,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNAUTHENTICATED");
    // Hash yang salah algoritme tidak pernah dipercaya sebagai pembanding.
    expect(hasher.calls.verify).toBe(0);
  });

  it("menolak PIN yang bentuknya tidak sah", async () => {
    const hasher = fakeHasher();
    const hash = await storedPin(hasher);
    const verificationsBefore = hasher.calls.verify;

    const result = await verifyPin("12345", hash, INITIAL_PIN_ATTEMPTS, hasher, NOW_MS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNAUTHENTICATED");
    expect(hasher.calls.verify).toBe(verificationsBefore);
  });
});
