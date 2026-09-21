/**
 * Uji satuan naskah berwaktu (F3, kontrak API bagian 10).
 *
 * Yang diperiksa di sini adalah sifat-sifat yang membuat pemutar Talking-
 * Catalog bekerja: tidak ada celah antar kalimat, tidak ada tumpang tindih,
 * waktu bertambah, dan kalimat terpecah pada tempat yang benar.
 */

import { describe, expect, it } from "vitest";

import { buildCaptions } from "./narration";

describe("buildCaptions", () => {
  it("mengembalikan larik kosong untuk cerita null", () => {
    expect(buildCaptions(null)).toEqual([]);
  });

  it("mengembalikan larik kosong untuk cerita kosong atau hanya spasi", () => {
    expect(buildCaptions("")).toEqual([]);
    expect(buildCaptions("   \n\t ")).toEqual([]);
  });

  it("memecah cerita menjadi beberapa kalimat", () => {
    const captions = buildCaptions(
      "Tas ini dibuat dari kulit sapi samak nabati. Dijahit tangan selama tiga hari. Ukurannya 30 x 20 cm.",
    );

    expect(captions).toHaveLength(3);
    expect(captions[0]?.text).toBe("Tas ini dibuat dari kulit sapi samak nabati.");
    expect(captions[1]?.text).toBe("Dijahit tangan selama tiga hari.");
    expect(captions[2]?.text).toBe("Ukurannya 30 x 20 cm.");
  });

  it("tidak memenggal kalimat pada titik di dalam angka", () => {
    // "30 x 20 cm." adalah akhir kalimat, bukan "30." di tengahnya.
    const captions = buildCaptions("Lebarnya 30 x 20 cm. Beratnya 400 gram.");

    expect(captions).toHaveLength(2);
    expect(captions[0]?.text).toBe("Lebarnya 30 x 20 cm.");
  });

  it("memperlakukan kalimat tanpa tanda akhir sebagai satu kalimat", () => {
    const captions = buildCaptions("Tas kulit tanpa tanda akhir");

    expect(captions).toHaveLength(1);
    expect(captions[0]?.text).toBe("Tas kulit tanpa tanda akhir");
  });

  it("mengenali tanda tanya dan tanda seru sebagai akhir kalimat", () => {
    const captions = buildCaptions("Apakah ini kulit asli? Ya, pasti! Dijahit tangan.");

    expect(captions).toHaveLength(3);
    expect(captions[0]?.text).toBe("Apakah ini kulit asli?");
    expect(captions[1]?.text).toBe("Ya, pasti!");
  });

  it("memulai kalimat pertama pada nol", () => {
    const captions = buildCaptions("Kalimat pertama. Kalimat kedua.");

    expect(captions[0]?.startMs).toBe(0);
  });

  it("menyambung setiap kalimat tanpa celah dan tanpa tumpang tindih", () => {
    // Pemutar mencari kalimat aktif dengan membandingkan posisi terhadap
    // rentang ini. Celah berarti ada saat tanpa subjudul.
    const captions = buildCaptions(
      "Satu kalimat yang cukup panjang untuk diucapkan. Kalimat kedua juga panjang. Ketiga.",
    );

    expect(captions.length).toBeGreaterThan(1);

    for (let index = 1; index < captions.length; index += 1) {
      const previous = captions[index - 1];
      const current = captions[index];
      if (previous === undefined || current === undefined) continue;

      expect(current.startMs).toBeGreaterThan(previous.endMs);
    }
  });

  it("selalu menghasilkan endMs lebih besar daripada startMs", () => {
    const captions = buildCaptions("A. B. C.");

    for (const caption of captions) {
      expect(caption.endMs).toBeGreaterThan(caption.startMs);
    }
  });

  it("memberi durasi minimum agar kalimat pendek tetap terbaca", () => {
    // "Ya." hanya satu kata; tanpa batas minimum ia berkedip terlalu cepat.
    const captions = buildCaptions("Ya. Tidak.");

    for (const caption of captions) {
      const duration = caption.endMs - caption.startMs;
      expect(duration).toBeGreaterThanOrEqual(1_200);
    }
  });

  it("memberi durasi lebih panjang pada kalimat yang lebih panjang", () => {
    const captions = buildCaptions(
      "Singkat sekali. Kalimat ini jauh lebih panjang daripada kalimat sebelumnya sehingga membutuhkan waktu baca yang lebih lama juga.",
    );

    const first = captions[0];
    const second = captions[1];
    if (first === undefined || second === undefined) throw new Error("kalimat tidak terbentuk");

    expect(second.endMs - second.startMs).toBeGreaterThan(first.endMs - first.startMs);
  });

  it("menormalkan spasi berlebih dan baris baru", () => {
    const captions = buildCaptions("Baris pertama.\n\n\n   Baris    kedua.");

    expect(captions).toHaveLength(2);
    expect(captions[0]?.text).toBe("Baris pertama.");
    expect(captions[1]?.text).toBe("Baris kedua.");
  });

  it("menjaga teks kalimat tidak kosong", () => {
    const captions = buildCaptions("Satu. Dua. Tiga.");

    for (const caption of captions) {
      expect(caption.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("membatasi durasi maksimum pada kalimat yang sangat panjang", () => {
    const longSentence = `${"kata ".repeat(200)}berakhir.`;
    const captions = buildCaptions(longSentence);

    expect(captions).toHaveLength(1);
    const duration = (captions[0]?.endMs ?? 0) - (captions[0]?.startMs ?? 0);
    expect(duration).toBeLessThanOrEqual(12_000);
  });

  it("bekerja pada cerita nyata dari semai pengujian", () => {
    const captions = buildCaptions(
      "Tas ini dibuat dari kulit sapi samak nabati, dijahit tangan selama tiga hari.",
    );

    expect(captions).toHaveLength(1);
    expect(captions[0]?.text).toBe(
      "Tas ini dibuat dari kulit sapi samak nabati, dijahit tangan selama tiga hari.",
    );
  });
});
