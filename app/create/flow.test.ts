/**
 * Kasus uji alur enam langkah — S2-01 sampai S2-05.
 *
 * `flow.ts` adalah satu-satunya tempat aturan "melompati langkah ditolak"
 * hidup. Keenam halaman memanggilnya, jadi satu kesalahan di sini berarti
 * enam halaman yang salah — dan kesalahannya tidak akan terlihat sampai ada
 * yang mencoba membuka langkah 4 lewat URL.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  FLOW_STEPS,
  TOTAL_STEPS,
  canOpenStep,
  draftHasWork,
  furthestAllowedStep,
  stepById,
  stepPath,
  withDraftChange,
  type Draft,
} from "./flow";

function draftWith(patch: Partial<Draft>): Draft {
  return { ...EMPTY_DRAFT, ...patch };
}

describe("alur — urutan langkah", () => {
  it("memuat enam langkah dalam urutan tetap", () => {
    // S2-01
    expect(FLOW_STEPS.map((step) => step.id)).toEqual([
      "photo",
      "record",
      "transcript",
      "process",
      "review",
      "publish",
    ]);
    expect(TOTAL_STEPS).toBe(6);
  });

  it("memberi posisi satu sampai enam tanpa lompatan", () => {
    // S2-05: indikator "Langkah 2 dari 6" bergantung pada nomor ini.
    expect(FLOW_STEPS.map((step) => step.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("memakai kalimat panduan dari dokumen, bukan nama fitur", () => {
    // Dikutip dari FEATURE-SPECS S2, yang meneruskannya dari
    // `Fitur pendukung.pdf` halaman 2-3. Judul yang menjelaskan apa yang
    // harus dilakukan, bukan nama fitur.
    expect(FLOW_STEPS.map((step) => step.title)).toEqual([
      "Arahkan kamera ke produk Anda",
      "Tekan tombol dan ceritakan produk Anda",
      "Apakah ini yang Anda ceritakan?",
      "KATAVIS sedang membuat katalog Anda",
      "Apakah katalog sudah sesuai?",
      "Katalog siap dilihat pembeli",
    ]);
  });

  it("menyusun alamat dari id langkah", () => {
    expect(stepPath("photo")).toBe("/create/photo");
    expect(stepPath("publish")).toBe("/create/publish");
    expect(stepById("transcript").position).toBe(3);
  });
});

describe("alur — penjagaan langkah", () => {
  it("selalu mengizinkan langkah pertama", () => {
    expect(canOpenStep(EMPTY_DRAFT, "photo")).toBe(true);
  });

  it("menolak setiap langkah sebelum syaratnya terpenuhi", () => {
    // S2-04. Inilah yang membuat lompatan lewat URL berakhir di tempat lain.
    expect(canOpenStep(EMPTY_DRAFT, "record")).toBe(false);
    expect(canOpenStep(EMPTY_DRAFT, "transcript")).toBe(false);
    expect(canOpenStep(EMPTY_DRAFT, "process")).toBe(false);
    expect(canOpenStep(EMPTY_DRAFT, "review")).toBe(false);
    expect(canOpenStep(EMPTY_DRAFT, "publish")).toBe(false);
  });

  it("membuka langkah berikutnya tepat setelah syaratnya terpenuhi", () => {
    expect(canOpenStep(draftWith({ productId: "01J" }), "record")).toBe(true);
    expect(canOpenStep(draftWith({ photoMediaId: "01M" }), "transcript")).toBe(true);
    expect(canOpenStep(draftWith({ transcriptReviewed: true }), "process")).toBe(true);
    expect(canOpenStep(draftWith({ generatedAt: 1 }), "review")).toBe(true);
    expect(canOpenStep(draftWith({ contentReviewedAt: 1 }), "publish")).toBe(true);
  });

  it("tidak membuka langkah jauh hanya karena langkah dekatnya siap", () => {
    const halfway = draftWith({ productId: "01J", photoMediaId: "01M" });

    expect(canOpenStep(halfway, "transcript")).toBe(true);
    expect(canOpenStep(halfway, "process")).toBe(false);
    expect(canOpenStep(halfway, "publish")).toBe(false);
  });

  it("menempatkan pengrajin di langkah terjauh yang sah", () => {
    expect(furthestAllowedStep(EMPTY_DRAFT)).toBe("photo");
    expect(furthestAllowedStep(draftWith({ productId: "01J" }))).toBe("record");
    expect(
      furthestAllowedStep(draftWith({ productId: "01J", photoMediaId: "01M" })),
    ).toBe("transcript");
    expect(
      furthestAllowedStep(
        draftWith({
          productId: "01J",
          photoMediaId: "01M",
          transcriptReviewed: true,
          generatedAt: 1,
          contentReviewedAt: 1,
        }),
      ),
    ).toBe("publish");
  });

  it("tidak melompati celah di tengah", () => {
    // Draf yang punya hasil pemrosesan tetapi transkripnya belum ditinjau
    // tidak boleh membuka langkah 5. Urutannya tetap, dan celah di tengah
    // menghentikan perjalanan di situ.
    const inconsistent = draftWith({ generatedAt: 1 });

    expect(furthestAllowedStep(inconsistent)).toBe("photo");
  });
});

describe("alur — draf", () => {
  it("menganggap draf kosong belum berisi pekerjaan", () => {
    expect(draftHasWork(EMPTY_DRAFT)).toBe(false);
  });

  it("menganggap draf dengan produk atau cerita layak dilanjutkan", () => {
    // S5: draf yang belum selesai ditawarkan untuk dilanjutkan.
    expect(draftHasWork(draftWith({ productId: "01J" }))).toBe(true);
    expect(draftHasWork(draftWith({ transcript: "Tas dari kulit kerbau." }))).toBe(true);
  });

  it("memperbarui cap waktu pada setiap perubahan", () => {
    const updated = withDraftChange(EMPTY_DRAFT, { productId: "01J" }, 1_700_000_000_000);

    expect(updated.productId).toBe("01J");
    expect(updated.updatedAt).toBe(1_700_000_000_000);
    // Bidang lain tidak tersentuh.
    expect(updated.transcript).toBe(EMPTY_DRAFT.transcript);
  });
});
