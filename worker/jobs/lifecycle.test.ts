/**
 * Siklus hidup pekerjaan AI — transisi status.
 *
 * TC-U-JOB-08 — `queued` → `running` → `succeeded` sah.
 * TC-U-JOB-09 — `succeeded` → `running` ditolak.
 * TC-I-08    — pekerjaan masuk antrian dan dikonsumsi; statusnya hanya maju.
 *
 * Satu aturan menentukan seluruh berkas ini: **transisi hanya maju**.
 * Pekerjaan yang sudah selesai tidak pernah berjalan lagi, dan pekerjaan
 * yang sedang berjalan tidak pernah dianggap gagal hanya karena satu lapisan
 * penyedia melambat.
 *
 * Cabang yang belum tercakup sebelum ini adalah penolakan nilai tak dikenal —
 * perilaku default-deny. Ia justru yang paling perlu diuji: status yang tidak
 * dikenali datang dari baris basis data yang ditulis versi lain, dan jawaban
 * yang salah di situ berarti pekerjaan yang tidak seharusnya berjalan tetap
 * berjalan.
 */

import { describe, expect, it } from "vitest";

import { LIMITS, type JobStatus } from "../../lib/schemas";

import { canRetryJob, canTransition, isTerminal } from "./lifecycle";

const ALL_STATUSES: readonly JobStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
];

describe("jobs/lifecycle — canTransition", () => {
  it("mengizinkan urutan normal queued → running → succeeded", () => {
    // TC-U-JOB-08.
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "succeeded")).toBe(true);
  });

  it("mengizinkan pembatalan dari queued maupun running", () => {
    // TC-E2E-11. Agen yang menggantung melewati 45 detik dibatalkan, dan
    // pembatalan harus sah dari kedua keadaan itu.
    expect(canTransition("queued", "cancelled")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(true);
  });

  it("menolak pekerjaan yang selesai berjalan lagi", () => {
    // TC-U-JOB-09.
    expect(canTransition("succeeded", "running")).toBe(false);
    expect(canTransition("succeeded", "queued")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
  });

  it("menolak pekerjaan yang selesai tanpa pernah tercatat berjalan", () => {
    // `queued → succeeded` terlihat tidak berbahaya, tetapi berarti ada
    // langkah yang terlewat — dan menyembunyikannya memindahkan masalah ke
    // tempat yang lebih sulit ditemukan.
    expect(canTransition("queued", "succeeded")).toBe(false);
  });

  it("mengizinkan satu-satunya jalan kembali: failed → queued", () => {
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("failed", "running")).toBe(false);
  });

  it("menolak transisi ke dirinya sendiri", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status), `${status} → ${status}`).toBe(false);
    }
  });

  it("menolak status yang tidak dikenal — default menolak, bukan mengizinkan", () => {
    // Nilai dari baris basis data yang ditulis versi lain. Jawaban yang
    // salah di sini berarti pekerjaan yang tidak seharusnya berjalan tetap
    // berjalan.
    const unknown = "menunggu" as JobStatus;

    expect(canTransition(unknown, "running")).toBe(false);
    expect(canTransition("queued", unknown)).toBe(false);
  });
});

describe("jobs/lifecycle — isTerminal", () => {
  it("menyebut succeeded dan cancelled sebagai keadaan akhir", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });

  it("menyebut queued, running, dan failed sebagai belum akhir", () => {
    // `failed` belum akhir: ia punya satu tujuan, yaitu kembali ke antrian.
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("failed")).toBe(false);
  });

  it("memperlakukan status tak dikenal sebagai keadaan akhir", () => {
    // Konsumen antrian memakainya untuk memastikan ia tidak mengambil
    // pekerjaan yang sudah selesai. Status yang tidak dikenali tidak boleh
    // membuatnya mengambil pekerjaan yang mungkin sudah selesai.
    expect(isTerminal("entah" as JobStatus)).toBe(true);
  });
});

describe("jobs/lifecycle — canRetryJob", () => {
  it("mengizinkan percobaan selama belum mencapai batas", () => {
    expect(canRetryJob(0)).toBe(true);
    expect(canRetryJob(LIMITS.MAX_JOB_ATTEMPTS - 1)).toBe(true);
  });

  it("menolak percobaan pada dan sesudah batas", () => {
    // Tidak ada pengecualian untuk penyedia yang membalas 429 — justru di
    // situ percobaan ulang tanpa batas paling mudah terjadi.
    expect(canRetryJob(LIMITS.MAX_JOB_ATTEMPTS)).toBe(false);
    expect(canRetryJob(LIMITS.MAX_JOB_ATTEMPTS + 5)).toBe(false);
  });
});
