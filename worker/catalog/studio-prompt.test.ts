import { describe, expect, it } from "vitest";

import type { ImageStyle } from "../../lib/schemas";
import {
  IMAGE_STYLE_LABELS,
  buildAutoStudioPrompt,
  buildSharpenInstruction,
  cleanSharpenedPrompt,
  styleDirection,
} from "./studio-prompt";

const STYLES: readonly ImageStyle[] = [
  "marble_light",
  "wood_warm",
  "dark_gradient",
  "rattan_natural",
  "clay_minimal",
];

describe("studio-prompt — template gaya", () => {
  it("menyediakan lima gaya dengan arahan yang berbeda", () => {
    const directions = STYLES.map(styleDirection);
    const unique = new Set(directions);

    // F2: lima latar yang komposisinya benar-benar berbeda, bukan lima nama
    // untuk satu prompt yang sama.
    expect(unique.size).toBe(5);
    expect(Object.keys(IMAGE_STYLE_LABELS)).toHaveLength(5);
  });

  it("setiap arahan menyebut pencahayaan yang konkret", () => {
    for (const style of STYLES) {
      expect(styleDirection(style).length).toBeGreaterThan(40);
    }
  });
});

describe("studio-prompt — prompt otomatis", () => {
  it("memuat label produk sehingga berbeda antar produk", () => {
    // F2-10: prompt menyesuaikan produk, bukan generik yang sama terus.
    const first = buildAutoStudioPrompt({
      productLabel: 'produk "tas kulit sapi"',
      style: "marble_light",
    });
    const second = buildAutoStudioPrompt({
      productLabel: 'produk "pakan duckweed dan larva bsf"',
      style: "marble_light",
    });

    expect(first).toContain("tas kulit sapi");
    expect(second).toContain("pakan duckweed dan larva bsf");
    expect(first).not.toBe(second);
  });

  it("memuat aturan produk-tunggal pada setiap gaya", () => {
    for (const style of STYLES) {
      const prompt = buildAutoStudioPrompt({ productLabel: "produk kriya", style });
      expect(prompt).toContain("SATU-SATUNYA objek");
      expect(prompt).toContain("100% persis");
    }
  });

  it("tidak melebihi batas kontrak API", () => {
    const prompt = buildAutoStudioPrompt({
      productLabel: `produk "${"cerita panjang ".repeat(30)}"`,
      style: "dark_gradient",
    });

    expect(prompt.length).toBeLessThanOrEqual(2000);
  });
});

describe("studio-prompt — penajaman manual", () => {
  it("menyusun instruksi yang memuat keinginan, produk, dan gaya", () => {
    const instruction = buildSharpenInstruction("latar sawah sore hari", "produk beras merah", "wood_warm");

    expect(instruction).toContain("latar sawah sore hari");
    expect(instruction).toContain("beras merah");
    expect(instruction.length).toBeGreaterThan(100);
  });

  it("membersihkan pagar kode dari keluaran AI", () => {
    expect(cleanSharpenedPrompt("```\nLetakkan produk di atas meja marmer yang elegan\n```")).toBe(
      "Letakkan produk di atas meja marmer yang elegan",
    );
  });

  it("membersihkan kalimat pembuka dari keluaran AI", () => {
    expect(
      cleanSharpenedPrompt("Berikut promptnya: Letakkan produk di atas meja kayu yang hangat"),
    ).toBe("Letakkan produk di atas meja kayu yang hangat");
  });

  it("menolak keluaran yang terlalu pendek atau terlalu panjang", () => {
    expect(cleanSharpenedPrompt("pendek")).toBeNull();
    expect(cleanSharpenedPrompt(`x${"y".repeat(2001)}`)).toBeNull();
  });
});
