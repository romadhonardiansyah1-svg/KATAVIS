/**
 * Uji logika murni Studio Agent.
 *
 * Yang diuji di sini adalah keputusan yang tidak membutuhkan Chrome, jaringan,
 * atau Gemini: penerjemahan kegagalan menjadi alasan, pembacaan bentuk
 * pekerjaan, dan penegakan tenggat. Ketiganya adalah tempat kesalahan yang
 * paling mahal — alasan yang salah membuat operator memperbaiki hal yang
 * salah, dan tenggat yang salah membuat agen bekerja melewati batas yang
 * ditetapkan server.
 *
 * Perilaku yang menuntut Chrome asli dan sesi Gemini sungguhan diuji di
 * docs/testing/TEST-PLAN.md bagian 9, dijalankan manual. Memberi tiruan pada
 * CDP hanya akan menguji tiruannya.
 */

import { describe, expect, it } from "vitest";

import { AgentRuntimeError, GEMINI_SELECTORS, reasonFromFailure } from "./chrome.js";
import { buildGeminiEditPrompt, imageExtension, isExpired, parseJob } from "./worker.js";

describe("agent — prompt edit foto", () => {
  it("menggunakan konteks produk dan mengizinkan latar terpilih tanpa menambah barang", () => {
    const prompt = buildGeminiEditPrompt("Tas anyaman pandan di atas permukaan rotan.");
    expect(prompt).toContain("Tas anyaman pandan");
    expect(prompt).toContain("foto yang dilampirkan");
    expect(prompt).toContain("permukaan");
    expect(prompt).not.toContain("SATU-SATUNYA objek di foto");
    expect(prompt).toContain("Jangan mengubah bentuk, warna, tekstur");
  });
});

describe("agent — berkas foto sumber", () => {
  it("memakai ekstensi yang sesuai dengan isi berkas saat melampirkan foto", () => {
    expect(imageExtension(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("jpg");
    expect(imageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("png");
    expect(imageExtension(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("webp");
    expect(imageExtension(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("agent — penerjemahan kegagalan menjadi alasan", () => {
  it("meneruskan alasan yang sudah ditetapkan AgentRuntimeError", () => {
    // TC-SA-03, TC-SA-04
    const cases: readonly (readonly [string, string])[] = [
      ["selector_not_found", "Kotak masukan tidak ditemukan."],
      ["session_expired", "Sesi sudah tidak masuk."],
      ["timeout", "Tenggat lewat."],
      ["generation_refused", "Gemini menolak."],
    ];

    for (const [reason, message] of cases) {
      expect(reasonFromFailure(new AgentRuntimeError(message, reason))).toBe(reason);
    }
  });

  it("menghasilkan alasan yang termasuk daftar lima nilai kontrak", () => {
    // TC-SA-03. Kontrak API bagian 8 membatasi lima nilai. Alasan di luar
    // daftar akan ditolak server, dan kegagalan yang ditolak server berarti
    // pekerjaan tidak kembali ke antrian.
    const allowed = new Set([
      "selector_not_found",
      "session_expired",
      "timeout",
      "generation_refused",
      "unknown",
    ]);

    const inputs = [
      new Error("Timeout 45000ms exceeded"),
      new Error("Target page, context or browser has been closed"),
      new Error("waiting for element to be visible"),
      new Error("sesuatu yang tidak dikenal"),
      "bukan objek galat",
      null,
      undefined,
    ];

    for (const input of inputs) {
      expect(allowed.has(reasonFromFailure(input))).toBe(true);
    }
  });

  it("tidak menebak alasan spesifik dari galat yang tidak dikenali", () => {
    // Galat tak dikenal menjadi `unknown`, bukan `selector_not_found`.
    // Menebak akan mengirim operator memperbaiki selector padahal masalahnya
    // di tempat lain.
    expect(reasonFromFailure(new Error("koneksi ditolak"))).toBe("unknown");
  });
});

describe("agent — bentuk pekerjaan dari klaim", () => {
  const validJob = {
    id: "01J8ZQFX9K7YWVTN3MABCDJ901",
    productId: "01J8ZQFX9K7YWVTN3MABCDJ902",
    sourceImageUrl: "https://contoh.example/foto.jpg",
    prompt: "Tempatkan produk ini persis seperti aslinya pada marmer terang.",
    deadlineAt: 1_758_000_045_000,
  };

  it("membaca pekerjaan yang lengkap", () => {
    const job = parseJob(validJob);

    expect(job).not.toBeNull();
    expect(job?.id).toBe(validJob.id);
    expect(job?.productId).toBe(validJob.productId);
    expect(job?.prompt).toBe(validJob.prompt);
    expect(job?.deadlineAt).toBe(validJob.deadlineAt);
    // Waktu klaim dicatat agen karena kontrak hanya mengirim tenggat.
    expect(typeof job?.startedAt).toBe("number");
  });

  it("menolak pekerjaan tanpa deadlineAt alih-alih mengarang nilai bawaan", () => {
    // Pekerjaan tanpa tenggat akan berjalan tanpa batas, dan itu justru yang
    // dicegah seluruh rancangan ini.
    const withoutDeadline = { ...validJob, deadlineAt: undefined };
    expect(parseJob(withoutDeadline)).toBeNull();
  });

  it("menolak pekerjaan yang kehilangan bidang wajib lain", () => {
    for (const field of ["id", "productId", "prompt"]) {
      expect(parseJob({ ...validJob, [field]: undefined })).toBeNull();
    }
  });

  it("menerima sourceImageUrl null sebagai keadaan yang sah", () => {
    // Server mengirim null bila produk belum punya foto yang dikonfirmasi.
    const job = parseJob({ ...validJob, sourceImageUrl: null });

    expect(job).not.toBeNull();
    expect(job?.sourceImageUrl).toBeNull();
  });

  it("menolak nilai yang bukan pekerjaan", () => {
    for (const value of [null, undefined, "teks", 42, {}]) {
      expect(parseJob(value)).toBeNull();
    }
  });
});

describe("agent — tenggat absolut dari server", () => {
  const job = { deadlineAt: 1_000_000 };

  it("menganggap pekerjaan belum lewat saat tenggat masih tersisa", () => {
    expect(isExpired(job, 999_999)).toBe(false);
  });

  it("menganggap pekerjaan lewat tepat pada tenggat", () => {
    // Batas 45 detik adalah batas KERAS (ADR-004). Tepat pada tenggat,
    // pekerjaan sudah menjadi milik penyedia cadangan.
    expect(isExpired(job, 1_000_000)).toBe(true);
  });

  it("menganggap pekerjaan lewat saat tenggat sudah dilampaui", () => {
    expect(isExpired(job, 1_000_001)).toBe(true);
  });
});

describe("agent — selector Gemini", () => {
  it("menyediakan lebih dari satu alternatif untuk setiap selector kritis", () => {
    // Nama kelas Gemini diobfuskasi dan berubah setiap penerapan. Satu
    // selector berarti satu titik kegagalan; beberapa alternatif membuat
    // perubahan satu atribut tidak mematikan seluruh jalur.
    const critical: readonly (keyof typeof GEMINI_SELECTORS)[] = [
      "promptInput",
      "sendButton",
      "generatedImage",
      "signedInMarker",
    ];

    for (const name of critical) {
      expect(GEMINI_SELECTORS[name].length).toBeGreaterThan(1);
    }
  });

  it("tidak memakai nama kelas hash pada selector masukan", () => {
    // Kelas seperti .gds-button-abc123 berubah setiap penerapan. Selector
    // yang memakainya akan pecah tanpa peringatan.
    for (const selector of GEMINI_SELECTORS.promptInput) {
      expect(selector).not.toMatch(/[a-z]{2,}-\d{4,}/);
    }
  });
});
