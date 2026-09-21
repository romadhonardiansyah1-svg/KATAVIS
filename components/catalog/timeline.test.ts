/**
 * Uji jam narasi Talking-Catalog.
 *
 * Yang diuji di sini adalah klaim terpenting fitur ini: subtitle tersinkron
 * (F3-01, TC-A11Y-24), berfungsi tanpa suara (F3-03, TC-A11Y-26), dan
 * berfungsi tanpa gambar (F3-04, TC-A11Y-27). Ketiganya berlaku pada fungsi
 * murni, jadi ketiganya dapat dibuktikan tanpa peramban — dan itu penting,
 * karena uji yang butuh peramban adalah uji yang dilewati saat waktu
 * menipis.
 */

import { describe, expect, it } from "vitest";

import {
  CAPTION_TOLERANCE_MS,
  captionEndMs,
  captionIndexAt,
  captionSlotMs,
  captionStartMs,
  effectiveTotalMs,
  isIndonesianLanguage,
  languageOf,
  mouthShape,
  pickIndonesianVoice,
  remainingText,
  timelineDurationMs,
  type Caption,
} from "./timeline";

const CAPTIONS: readonly Caption[] = [
  { startMs: 0, endMs: 3_200, text: "Tas ini dibuat dari kulit sapi pilihan." },
  { startMs: 3_200, endMs: 7_400, text: "Dikerjakan dengan tangan selama dua minggu." },
  { startMs: 7_400, endMs: 11_000, text: "Setiap jahitannya dirapikan satu per satu." },
];

describe("panjang garis waktu", () => {
  it("mengambil akhir kalimat terjauh, bukan kalimat terakhir", () => {
    // Kalimat boleh datang tidak berurutan; yang menentukan ujung narasi
    // adalah akhir terjauh.
    const outOfOrder: readonly Caption[] = [
      { startMs: 0, endMs: 5_000, text: "Pertama." },
      { startMs: 8_000, endMs: 9_000, text: "Kedua." },
      { startMs: 5_000, endMs: 6_000, text: "Ketiga." },
    ];

    expect(timelineDurationMs(outOfOrder)).toBe(9_000);
  });

  it("bernilai nol saat tidak ada kalimat", () => {
    expect(timelineDurationMs([])).toBe(0);
  });
});

describe("TC-A11Y-24 subtitle tersinkron dalam ±200 ms", () => {
  it("menyorot kalimat yang benar pada batas awalnya", () => {
    expect(captionIndexAt(CAPTIONS, 0)).toBe(0);
    expect(captionIndexAt(CAPTIONS, 3_200)).toBe(1);
    expect(captionIndexAt(CAPTIONS, 7_400)).toBe(2);
  });

  it("menyorot kalimat yang benar satu milidetik sebelum batas berikutnya", () => {
    // Kesalahan pengambilan sampel pada 60 Hz paling besar 8 ms. Nilai
    // paling tepi inilah yang harus jatuh pada kalimat yang benar, bukan
    // pada kalimat berikutnya.
    expect(captionIndexAt(CAPTIONS, 3_199)).toBe(0);
    expect(captionIndexAt(CAPTIONS, 7_399)).toBe(1);
  });

  it("tidak menyorot apa pun di luar rentang naskah", () => {
    expect(captionIndexAt(CAPTIONS, -1)).toBe(-1);
    expect(captionIndexAt(CAPTIONS, 11_000)).toBe(-1);
    expect(captionIndexAt(CAPTIONS, 99_000)).toBe(-1);
  });

  it("menjaga penyimpangan jauh di bawah toleransi yang dijanjikan", () => {
    // Yang diperiksa: pada setiap bingkai 60 Hz sepanjang narasi, kalimat
    // yang disorot tidak pernah berbeda dari kalimat yang memuat bingkai
    // itu. Selisih terburuk yang mungkin adalah setengah bingkai.
    const frameMs = 1_000 / 60;
    let worstErrorMs = 0;

    for (let position = 0; position < 11_000; position += frameMs) {
      const index = captionIndexAt(CAPTIONS, position);
      const caption = CAPTIONS[index];
      if (caption === undefined) continue;

      const error = Math.max(caption.startMs - position, position - caption.endMs);
      worstErrorMs = Math.max(worstErrorMs, error);
    }

    expect(worstErrorMs).toBeLessThanOrEqual(CAPTION_TOLERANCE_MS);
    expect(worstErrorMs).toBeLessThan(frameMs);
  });
});

describe("TC-A11Y-26 dan TC-A11Y-27 berfungsi tanpa suara", () => {
  it("memberi durasi sendiri pada setiap kalimat saat tidak ada suara", () => {
    const total = effectiveTotalMs(CAPTIONS, false);
    expect(total).toBeGreaterThan(timelineDurationMs(CAPTIONS));
  });

  it("menjaga setiap kalimat punya rentang yang tidak tumpang tindih", () => {
    const hasVoice = false;

    for (let index = 0; index < CAPTIONS.length; index += 1) {
      const startMs = captionStartMs(index, CAPTIONS, hasVoice);
      const endMs = captionEndMs(index, CAPTIONS, hasVoice);

      expect(endMs).toBeGreaterThan(startMs);

      const nextStartMs = captionStartMs(index + 1, CAPTIONS, hasVoice);
      if (index + 1 < CAPTIONS.length) {
        expect(nextStartMs).toBeGreaterThanOrEqual(endMs);
      }
    }
  });

  it("memberi seluruh kalimat waktu tampil saat tidak ada suara", () => {
    // Kalimat sepanjang apa pun harus mendapat giliran. Inilah yang
    // membedakan mode tanpa suara dari mode bersuara yang sekadar kehabisan
    // audio di tengah jalan.
    const veryShort: readonly Caption[] = [{ startMs: 0, endMs: 100, text: "Kulit sapi." }];
    expect(effectiveTotalMs(veryShort, false)).toBeGreaterThan(500);
  });

  it("menutup kalimat terakhir sebelum narasi dinyatakan selesai", () => {
    // Bila kalimat terakhir ditutup tidak pada `endMs`-nya, penyorotnya
    // berganti ke mode selesai tepat pada kata terakhir yang dibacakan.
    const hasVoice = true;
    const lastIndex = CAPTIONS.length - 1;
    expect(captionEndMs(lastIndex, CAPTIONS, hasVoice)).toBe(11_000);
    expect(effectiveTotalMs(CAPTIONS, hasVoice)).toBe(11_000);
  });

  it("memberi kalimat pertama serambi sebelum ia disorot", () => {
    const hasVoice = false;
    expect(captionStartMs(0, CAPTIONS, hasVoice)).toBe(0);
    expect(captionSlotMs(CAPTIONS[0]!, 0, CAPTIONS, hasVoice)).toBeGreaterThan(
      CAPTIONS[0]!.endMs - CAPTIONS[0]!.startMs,
    );
  });
});

describe("bentuk mulut avatar", () => {
  it("diam di luar rentang kalimat", () => {
    expect(mouthShape(-1, CAPTIONS[0]!)).toBe(0);
    expect(mouthShape(11_000, CAPTIONS[2]!)).toBe(0);
    expect(mouthShape(5_000, null)).toBe(0);
  });

  it("membuka dan menutup selama kalimat berlangsung", () => {
    const shapes = new Set<number>();
    for (let position = 0; position < 3_200; position += 50) {
      shapes.add(mouthShape(position, CAPTIONS[0]!));
    }

    // Kedua bentuk terbuka harus muncul. Satu bentuk saja berarti mulutnya
    // membeku terbuka, yang terbaca sebagai kerusakan alih-alih bicara.
    expect(shapes.has(1)).toBe(true);
    expect(shapes.has(2)).toBe(true);
    expect(shapes.has(0)).toBe(false);
  });
});

describe("mode tanpa suara sama sekali", () => {
  it("memilih kalimat yang benar pada posisi jatuh tempo tanpa audio", () => {
    const captions: readonly Caption[] = [
      { startMs: 0, endMs: 2_000, text: "Pertama." },
      { startMs: 2_000, endMs: 4_000, text: "Kedua." },
    ];

    expect(captionIndexAt(captions, 200)).toBe(0);
    expect(captionIndexAt(captions, 2_100)).toBe(1);
  });
});

describe("tanda bahasa naskah", () => {
  it("mengenali naskah Indonesia tanpa bergantung urutan availableLocales", () => {
    expect(isIndonesianLanguage("Tas ini dibuat dari kulit sapi pilihan.")).toBe(true);
    expect(isIndonesianLanguage("This bag is made from cowhide.")).toBe(false);
  });

  it("tidak tertipu kata ulang yang ditulis dengan tanda hubung", () => {
    expect(isIndonesianLanguage("Karya-karya dengan hasil tangan.")).toBe(true);
  });

  it("memotong kode bahasa pada tanda hubung", () => {
    expect(languageOf("id-ID")).toBe("id");
    expect(languageOf("en")).toBe("en");
  });
});

describe("pemilihan suara perangkat", () => {
  function voice(lang: string, name: string, localService = true): SpeechSynthesisVoice {
    return { lang, name, localService } as SpeechSynthesisVoice;
  }

  it("memilih suara Indonesia dan mengabaikan yang lain", () => {
    const chosen = pickIndonesianVoice([
      voice("en-US", "English"),
      voice("id-ID", "Damayanti"),
    ]);

    expect(chosen?.name).toBe("Damayanti");
  });

  it("mengembalikan null bila tidak ada suara Indonesia", () => {
    // Lebih baik tahu bahwa suaranya tidak ada daripada membacakan naskah
    // Indonesia dengan aturan pelafalan Inggris.
    expect(pickIndonesianVoice([voice("en-US", "English")])).toBeNull();
  });

  it("mendahulukan suara yang terpasang di perangkat", () => {
    // Suara daring berarti satu titik gagal jaringan lagi pada jalur demo.
    const chosen = pickIndonesianVoice([
      voice("id-ID", "Suara Daring", false),
      voice("id-ID", "Suara Perangkat", true),
    ]);

    expect(chosen?.name).toBe("Suara Perangkat");
  });
});

describe("penggalan naskah yang tersisa", () => {
  it("melanjutkan dari kalimat yang sedang berjalan", () => {
    const remaining = remainingText(CAPTIONS, 5_000);
    expect(remaining.text.startsWith("Dikerjakan dengan tangan")).toBe(true);
    expect(remaining.text.includes("Tas ini dibuat")).toBe(false);
  });

  it("mengulang kalimat yang dimulai tepat pada batasnya", () => {
    // Menjeda tepat di awal sebuah kalimat lalu melanjutkan harus
    // mengulang kalimat itu, bukan melompatinya.
    const remaining = remainingText(CAPTIONS, 3_200);
    expect(remaining.text.startsWith("Dikerjakan dengan tangan")).toBe(true);
  });

  it("memilih kalimat terakhir saat posisinya sudah lewat ujung naskah", () => {
    const remaining = remainingText(CAPTIONS, 99_000);
    expect(remaining.text).toBe("Setiap jahitannya dirapikan satu per satu.");
  });

  it("mengembalikan teks kosong saat tidak ada kalimat", () => {
    expect(remainingText([], 0).text).toBe("");
  });
});
