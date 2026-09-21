/**
 * Kasus uji OTP — TC-SEC-12, TC-SEC-14.
 *
 * Penyimpanan dan batas laju memakai ganda uji di dalam berkas ini. Itu
 * bukan tiruan D1: port `OtpStore` dan `RateLimitStore` memang ada supaya
 * aturan di `otp.ts` dapat diuji tanpa basis data, dan supaya batas laju
 * tidak pernah diam-diam pindah ke memori Worker.
 */

import { describe, expect, it } from "vitest";

import { apiOk } from "../../lib/errors";

import {
  OTP_RATE_LIMIT,
  requestOtp,
  verifyOtp,
  type OtpChallenge,
  type OtpRequestDeps,
  type OtpStore,
  type RateLimitStore,
} from "./otp";

const NOW_MS = 1_700_000_000_000;
const PHONE = "+628123456789";

/**
 * Nilai kebijakan untuk uji. Nilai produksinya belum ditetapkan di dokumen
 * mana pun, jadi `otp.ts` menerimanya sebagai parameter.
 */
const TEST_POLICY = { codeTtlMs: 300_000, resendAfterMs: 60_000 };

interface FakeStores {
  readonly store: OtpStore;
  readonly rateLimit: RateLimitStore;
  /** Urutan operasi yang dijalankan, tanpa kunci — untuk membandingkan dua jalur. */
  readonly calls: string[];
  readonly sent: { readonly phone: string; readonly code: string }[];
}

function fakeStores(): FakeStores {
  const challenges = new Map<string, OtpChallenge>();
  const events = new Map<string, number[]>();
  const calls: string[] = [];
  const sent: { phone: string; code: string }[] = [];

  return {
    store: {
      save: async (challenge) => {
        calls.push("save");
        challenges.set(challenge.phone, challenge);
      },
      find: async (phone) => {
        calls.push("find");
        return challenges.get(phone) ?? null;
      },
      remove: async (phone) => {
        calls.push("remove");
        challenges.delete(phone);
      },
    },
    rateLimit: {
      record: async (key, at) => {
        calls.push("record");
        events.set(key, [...(events.get(key) ?? []), at]);
      },
      countSince: async (key, since) => {
        calls.push("countSince");
        return (events.get(key) ?? []).filter((at) => at >= since).length;
      },
      prune: async (before) => {
        calls.push("prune");
        for (const [key, times] of events) {
          events.set(
            key,
            times.filter((at) => at >= before),
          );
        }
      },
    },
    calls,
    sent,
  };
}

function depsFor(stores: FakeStores, code = "123456"): OtpRequestDeps {
  return {
    store: stores.store,
    rateLimit: stores.rateLimit,
    policy: TEST_POLICY,
    generateCode: () => code,
    sendCode: async (phone, sentCode) => {
      stores.calls.push("sendCode");
      stores.sent.push({ phone, code: sentCode });
    },
  };
}

describe("auth — keseragaman respons OTP", () => {
  it("memberi respons yang sama untuk nomor terdaftar dan tidak terdaftar", async () => {
    // TC-SEC-14
    const registered = fakeStores();
    const unregistered = fakeStores();

    const registeredResult = await requestOtp(
      { phone: PHONE, clientIp: "10.0.0.1" },
      depsFor(registered),
      NOW_MS,
    );
    const unregisteredResult = await requestOtp(
      { phone: "+628999999999", clientIp: "10.0.0.1" },
      depsFor(unregistered),
      NOW_MS,
    );

    expect(registeredResult).toEqual({
      ok: true,
      expiresAt: NOW_MS + TEST_POLICY.codeTtlMs,
      resendAfter: NOW_MS + TEST_POLICY.resendAfterMs,
    });
    expect(unregisteredResult).toEqual(registeredResult);

    // Sampai ke bentuk respons kontrak API bagian 2, keduanya identik.
    expect(await apiOk(unregisteredResult).text()).toBe(
      await apiOk(registeredResult).text(),
    );

    // Mekanismenya bukan penyamaan keluaran di akhir, melainkan ketiadaan
    // pemeriksaan: `requestOtp` tidak pernah menyentuh tabel `users`, jadi
    // tidak ada cabang yang bisa membocorkan keberadaan sebuah nomor.
    // Urutan operasi yang dijalankan kedua jalur pun sama persis.
    expect(unregistered.calls).toEqual(registered.calls);
    expect(registered.calls).toEqual([
      "prune",
      "countSince",
      "countSince",
      "record",
      "record",
      "save",
      "sendCode",
    ]);
  });
});

describe("auth — batas laju OTP", () => {
  it("membatasi 3 permintaan per nomor per jam", async () => {
    // TC-SEC-12
    const stores = fakeStores();
    const deps = depsFor(stores);

    for (let attempt = 0; attempt < OTP_RATE_LIMIT.perPhonePerHour; attempt += 1) {
      const result = await requestOtp(
        { phone: PHONE, clientIp: `10.0.0.${attempt + 1}` },
        deps,
        NOW_MS,
      );
      expect(result.ok).toBe(true);
    }

    const blocked = await requestOtp(
      { phone: PHONE, clientIp: "10.0.0.99" },
      deps,
      NOW_MS,
    );
    expect(blocked).toEqual({ ok: false, code: "RATE_LIMITED" });

    // SMS tidak dikirim saat batas terlampaui.
    expect(stores.sent).toHaveLength(OTP_RATE_LIMIT.perPhonePerHour);

    // Jendela bergeser: satu jam lebih sedikit masih terhitung, lewat satu
    // jam sudah bebas lagi.
    const stillInside = await requestOtp(
      { phone: PHONE, clientIp: "10.0.0.99" },
      deps,
      NOW_MS + OTP_RATE_LIMIT.windowMs - 1,
    );
    expect(stillInside).toEqual({ ok: false, code: "RATE_LIMITED" });

    const afterWindow = await requestOtp(
      { phone: PHONE, clientIp: "10.0.0.99" },
      deps,
      NOW_MS + OTP_RATE_LIMIT.windowMs + 1,
    );
    expect(afterWindow.ok).toBe(true);
  });

  it("membatasi 10 permintaan per IP per jam meski nomornya berbeda-beda", async () => {
    // TC-SEC-12
    const stores = fakeStores();
    const deps = depsFor(stores);
    const clientIp = "203.0.113.7";

    for (let index = 0; index < OTP_RATE_LIMIT.perIpPerHour; index += 1) {
      const phone = `+62812345${String(index).padStart(4, "0")}`;
      const result = await requestOtp({ phone, clientIp }, deps, NOW_MS);
      expect(result.ok).toBe(true);
    }

    const blocked = await requestOtp(
      { phone: "+628123459999", clientIp },
      deps,
      NOW_MS,
    );
    expect(blocked).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(stores.sent).toHaveLength(OTP_RATE_LIMIT.perIpPerHour);
  });

  it("menolak nomor yang bentuknya tidak sah tanpa menyentuh penyimpanan", async () => {
    const stores = fakeStores();

    for (const phone of ["08123456789", "+18123456789", "+62", "bukan-nomor"]) {
      const result = await requestOtp(
        { phone, clientIp: "10.0.0.1" },
        depsFor(stores),
        NOW_MS,
      );
      expect(result.ok).toBe(false);
    }

    expect(stores.calls).toEqual([]);
    expect(stores.sent).toEqual([]);
  });
});

describe("auth — verifikasi kode", () => {
  it("menerima kode yang benar tepat satu kali", async () => {
    const stores = fakeStores();
    await requestOtp({ phone: PHONE, clientIp: "10.0.0.1" }, depsFor(stores, "654321"), NOW_MS);

    expect(await verifyOtp({ phone: PHONE, code: "654321" }, stores.store, NOW_MS)).toEqual({
      ok: true,
    });
    // Sekali pakai: kode yang sama tidak berlaku lagi.
    expect(await verifyOtp({ phone: PHONE, code: "654321" }, stores.store, NOW_MS)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
  });

  it("menolak kode yang salah, kode kedaluwarsa, dan nomor yang tidak pernah meminta", async () => {
    const stores = fakeStores();
    const deps = depsFor(stores, "654321");
    await requestOtp({ phone: PHONE, clientIp: "10.0.0.1" }, deps, NOW_MS);

    expect(await verifyOtp({ phone: PHONE, code: "654322" }, stores.store, NOW_MS)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await verifyOtp({ phone: PHONE, code: "65432" }, stores.store, NOW_MS)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(
      await verifyOtp(
        { phone: PHONE, code: "654321" },
        stores.store,
        NOW_MS + TEST_POLICY.codeTtlMs,
      ),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(
      await verifyOtp({ phone: "+628999999999", code: "654321" }, stores.store, NOW_MS),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("tidak menyimpan kode mentah", async () => {
    const stores = fakeStores();
    await requestOtp({ phone: PHONE, clientIp: "10.0.0.1" }, depsFor(stores, "654321"), NOW_MS);

    const challenge = await stores.store.find(PHONE);
    expect(challenge?.codeHash).not.toContain("654321");
    // SHA-256 heksadesimal.
    expect(challenge?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    // Kode yang dikirim ke pengrajin tetap kode aslinya.
    expect(stores.sent[0]?.code).toBe("654321");
  });
});
