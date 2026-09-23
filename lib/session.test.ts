/**
 * Penyimpanan token akses di sisi klien.
 *
 * TC-SEC-01 — tanpa token, pemanggil memperlakukannya sebagai belum masuk,
 *             bukan sebagai kesalahan yang tidak terduga.
 * TC-SEC-05 — yang disimpan hanya tokennya. Tidak ada peran maupun izin di
 *             sisi klien: otorisasi hanya di server, dan apa pun yang
 *             tersimpan di sini dapat disunting dari konsol peramban.
 *
 * Berkas ini 0% tercakup sebelum ini — bukan karena sulit diuji, tetapi
 * karena tidak ada yang menulisnya. Ia dibaca pada setiap pemanggilan API,
 * jadi kesalahan di sini menyentuh seluruh aplikasi.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  clearAccessToken,
  readAccessToken,
  readRefreshToken,
  writeAccessToken,
  writeRefreshToken,
} from "./session";

interface FakeStorage {
  readonly entries: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const globals = globalThis as unknown as Record<string, unknown>;

/** Memasang `window` tiruan; lingkungan uji unit adalah Node tanpa DOM. */
function installWindow(): FakeStorage {
  const entries = new Map<string, string>();
  const storage: FakeStorage = {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };

  globals["window"] = { localStorage: storage };
  return storage;
}

afterEach(() => {
  delete globals["window"];
});

describe("lib/session", () => {
  it("mengembalikan null saat dirender di server", () => {
    // TC-SEC-01. Tanpa jendela, tidak ada sesi — dan itu bukan galat.
    expect(readAccessToken()).toBeNull();
  });

  it("tidak menulis maupun menghapus apa pun saat dirender di server", () => {
    expect(() => {
      writeAccessToken("token-uji");
      clearAccessToken();
    }).not.toThrow();
  });

  it("mengembalikan null saat belum ada token tersimpan", () => {
    // TC-SEC-01.
    installWindow();
    expect(readAccessToken()).toBeNull();
  });

  it("memperlakukan token kosong sebagai belum masuk", () => {
    // String kosong lolos setiap pemeriksaan kebenaran, dan setiap
    // pemanggilan API akan mengirim "Bearer " yang ditolak server dengan 401.
    // Lebih baik diperlakukan sebagai belum masuk sejak di klien.
    const storage = installWindow();
    storage.setItem("katavis.accessToken", "");

    expect(readAccessToken()).toBeNull();
  });

  it("membaca kembali token yang baru ditulis", () => {
    installWindow();
    writeAccessToken("token-uji");

    expect(readAccessToken()).toBe("token-uji");
  });

  it("menyimpan hanya tokennya, tanpa peran atau izin", () => {
    // TC-SEC-05. Kunci apa pun selain token akan menjadi jalur otorisasi
    // kedua yang hidup di klien.
    const storage = installWindow();
    writeAccessToken("token-uji");

    expect(Array.from(storage.entries.keys())).toEqual(["katavis.accessToken"]);
    expect(storage.entries.get("katavis.accessToken")).toBe("token-uji");
  });

  it("menyimpan token penyegar di kunci yang terpisah", () => {
    // Dua token, dua kunci. Menyimpannya di satu kunci akan membuat pembacaan
    // token akses mengembalikan gabungan keduanya.
    const storage = installWindow();
    writeAccessToken("akses");
    writeRefreshToken("segarkan");

    expect(readAccessToken()).toBe("akses");
    expect(readRefreshToken()).toBe("segarkan");
    expect(Array.from(storage.entries.keys()).sort()).toEqual([
      "katavis.accessToken",
      "katavis.refreshToken",
    ]);
  });

  it("memperlakukan token penyegar kosong sebagai belum masuk", () => {
    const storage = installWindow();
    storage.setItem("katavis.refreshToken", "");

    expect(readRefreshToken()).toBeNull();
  });

  it("menghapus token saat pengguna keluar", () => {
    const storage = installWindow();
    writeAccessToken("token-uji");
    clearAccessToken();

    expect(readAccessToken()).toBeNull();
    expect(storage.entries.size).toBe(0);
  });

  it("menghapus kedua token sekaligus saat keluar", () => {
    // Menyisakan token penyegar setelah keluar berarti perangkat itu masih
    // dapat memperoleh akses baru. Pada perangkat yang dipakai bergantian di
    // SLB, itu bukan detail.
    const storage = installWindow();
    writeAccessToken("akses");
    writeRefreshToken("segarkan");
    clearAccessToken();

    expect(readAccessToken()).toBeNull();
    expect(readRefreshToken()).toBeNull();
    expect(storage.entries.size).toBe(0);
  });

  it("menimpa token lama alih-alih menumpuknya", () => {
    const storage = installWindow();
    writeAccessToken("token-lama");
    writeAccessToken("token-baru");

    expect(readAccessToken()).toBe("token-baru");
    expect(storage.entries.size).toBe(1);
  });
});
