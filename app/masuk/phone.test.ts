/**
 * Layar masuk — bagian yang dapat diuji tanpa peramban.
 *
 * Yang diuji di sini adalah penyaringan nomor telepon dan pemformatan waktu
 * tunggu. Keduanya adalah logika yang menentu, tempat kesalahan menghasilkan
 * pesan yang menyalahkan pengrajin: nomor yang sebenarnya benar ditolak
 * sebagai "belum lengkap", atau hitungan mundur yang berbunyi "0 detik lagi"
 * sementara tombolnya masih mati.
 *
 * Komponennya sendiri diuji lewat Playwright, bukan di sini — `useRouter`
 * dan fokus tidak punya arti di lingkungan Node.
 */

import { describe, expect, it } from "vitest";

import { formatWait, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("menerima bentuk dengan awalan nol", () => {
    // TC-U-AUTH-01
    expect(normalizePhone("08123456789")).toBe("+628123456789");
  });

  it("menerima bentuk dengan awalan enam dua", () => {
    // TC-U-AUTH-01
    expect(normalizePhone("628123456789")).toBe("+628123456789");
  });

  it("menerima bentuk dengan tanda plus", () => {
    // TC-U-AUTH-01
    expect(normalizePhone("+628123456789")).toBe("+628123456789");
  });

  it("menerima bentuk tanpa awalan apa pun", () => {
    // TC-U-AUTH-01
    expect(normalizePhone("8123456789")).toBe("+628123456789");
  });

  it("membuang spasi, tanda hubung, titik, dan tanda kurung", () => {
    // TC-U-AUTH-01. Pengrajin menulis nomor dengan cara yang bermacam-macam,
    // dan menolak "0812-3456-7890" sebagai tidak lengkap adalah kesalahan
    // yang menyalahkan pengguna atas tanda baca.
    expect(normalizePhone("0812-3456-789")).toBe("+628123456789");
    expect(normalizePhone("0812 3456 789")).toBe("+628123456789");
    expect(normalizePhone("(0812) 3456.789")).toBe("+628123456789");
    expect(normalizePhone("+62 812 3456 789")).toBe("+628123456789");
  });

  it("mempertahankan seluruh angka, tidak membuang satu pun", () => {
    // TC-U-AUTH-01. Nomor yang lebih panjang tetap sah selama jumlah
    // angkanya di dalam batas — yang dibuang hanyalah tanda bacanya.
    expect(normalizePhone("0812-3456-7890")).toBe("+6281234567890");
    expect(normalizePhone("+62 812-3456-7890")).toBe("+6281234567890");
  });

  it("menolak masukan kosong", () => {
    // TC-U-AUTH-02
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  it("menolak nomor yang tidak diawali delapan setelah kode negara", () => {
    // TC-U-AUTH-02. Nomor telepon rumah Jakarta ("021...") bukan nomor
    // ponsel, dan tidak dapat menerima SMS.
    expect(normalizePhone("0211234567")).toBeNull();
  });

  it("menolak nomor dengan kode negara lain", () => {
    // TC-U-AUTH-02
    expect(normalizePhone("+14155552671")).toBeNull();
  });

  it("menolak nomor yang terlalu pendek", () => {
    // TC-U-AUTH-02
    expect(normalizePhone("0812")).toBeNull();
    expect(normalizePhone("8")).toBeNull();
  });

  it("menolak nomor yang terlalu panjang", () => {
    // TC-U-AUTH-02
    expect(normalizePhone("0812345678901234")).toBeNull();
  });

  it("menolak masukan yang memuat huruf", () => {
    // TC-U-AUTH-02
    expect(normalizePhone("0812abc6789")).toBeNull();
  });
});

describe("formatWait", () => {
  it("menyebut detik untuk tunggu di bawah satu menit", () => {
    // TC-U-AUTH-03
    expect(formatWait(45_000)).toBe("45 detik lagi");
  });

  it("membulatkan ke atas, bukan ke bawah", () => {
    // TC-U-AUTH-03. Menampilkan "0 detik lagi" sementara tombolnya masih
    // mati membuat pengrajin mengira tombolnya rusak.
    expect(formatWait(1)).toBe("1 detik lagi");
    expect(formatWait(999)).toBe("1 detik lagi");
  });

  it("menyebut menit untuk tunggu yang lebih lama", () => {
    // TC-U-AUTH-03
    expect(formatWait(180_000)).toBe("3 menit lagi");
  });

  it("tidak pernah menampilkan angka negatif", () => {
    // TC-U-AUTH-03
    expect(formatWait(-5_000)).toBe("0 detik lagi");
  });

  it("beralih ke menit tepat pada enam puluh detik", () => {
    // TC-U-AUTH-03
    expect(formatWait(60_000)).toBe("1 menit lagi");
    expect(formatWait(59_000)).toBe("59 detik lagi");
  });
});
