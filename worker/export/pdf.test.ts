/**
 * Kasus uji PDF bertag struktur — TC-E2E-07 dan F4-01, F4-02, F4-05.
 *
 * Uji di sini tidak memakai pembaca PDF, dan itu disengaja: yang diperiksa
 * adalah hal-hal yang membuat sebuah PDF disebut bertag — keberadaan
 * `/MarkInfo`, `/StructTreeRoot`, `/StructElem` dengan perannya, `/Alt` pada
 * gambar, dan `/ParentTree` yang menghubungkan keduanya. Substring saja
 * tidak cukup, jadi tabel `xref`-nya pun diperiksa terhadap offset objek
 * yang sebenarnya.
 */

import { describe, expect, it } from "vitest";

import { buildTaggedPdf, type PdfBlock } from "./pdf";

/** Berkas PDF sebagian besar ASCII; sisanya dibaca apa adanya per bita. */
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** Bita JPEG tiruan. Isinya tidak perlu gambar sungguhan — ia disalin apa adanya. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);

const BLOCKS: readonly PdfBlock[] = [
  { kind: "heading", level: 1, text: "Tas Kulit Nusantara" },
  { kind: "paragraph", text: "Dibuat dari kulit sapi nabati selama dua minggu." },
  { kind: "paragraph", text: "Kulit sapi nabati · Jahitan tangan" },
  {
    kind: "figure",
    jpeg: JPEG_BYTES,
    pixelWidth: 1200,
    pixelHeight: 900,
    altText: "Tas kulit cokelat di atas meja marmer",
  },
];

function build(blocks: readonly PdfBlock[] = BLOCKS): ReturnType<typeof buildTaggedPdf> {
  return buildTaggedPdf({
    title: "Tas Kulit Nusantara",
    locale: "id",
    artisanName: "Irsyad",
    blocks,
  });
}

/**
 * Membaca tabel `xref` dan mengembalikan offset setiap objek.
 *
 * Inilah pemeriksaan yang sesungguhnya: PDF yang tabel rujukannya salah
 * akan terbuka sebagai berkas rusak, dan tidak ada substring yang dapat
 * menunjukkan hal itu.
 */
function xrefOffsets(text: string): readonly number[] {
  const marker = text.lastIndexOf("startxref");
  const offset = Number(text.slice(marker + "startxref".length).trim().split(/\s+/)[0]);

  const header = /^xref\n0 (\d+)\n/.exec(text.slice(offset));
  expect(header).not.toBeNull();
  if (header === null) return [];

  const count = Number(header[1]);
  const body = text.slice(offset + header[0].length);
  const offsets: number[] = [];

  // Entri pertama adalah objek kosong bernomor 0, jadi dimulai dari 1.
  for (let index = 1; index < count; index += 1) {
    offsets.push(Number(body.slice(index * 20, index * 20 + 10)));
  }

  return offsets;
}

describe("export — PDF bertag struktur", () => {
  it("menghasilkan berkas PDF yang lengkap", () => {
    const { bytes } = build();
    const text = latin1(bytes);

    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(text).toContain("trailer");
    // Komentar biner menandai berkas ini memuat bita di luar ASCII.
    expect(text).toContain("%\u00e2\u00e3\u00cf\u00d3");
  });

  it("menandai dokumen sebagai bertag", () => {
    // F4-01
    // Tanpa /MarkInfo dan /StructTreeRoot, pohon struktur di bawahnya tidak
    // akan dibaca pembaca layar sama sekali — PDF-nya tampak biasa.
    const text = latin1(build().bytes);

    expect(text).toContain("/MarkInfo << /Marked true >>");
    expect(text).toContain("/StructTreeRoot");
    expect(text).toContain("/Type /StructTreeRoot");
    expect(text).toContain("/ParentTree");
  });

  it("memberi peran pada setiap blok", () => {
    // F4-01
    const text = latin1(build().bytes);

    expect(text).toContain("/Type /StructElem /S /H1");
    expect(text).toContain("/Type /StructElem /S /P");
    expect(text).toContain("/Type /StructElem /S /Figure");
    // Penanda di dalam aliran isi, yang menghubungkan teks ke perannya.
    // MCID 0 adalah baris judul dan nama pengrajin, yang selalu mendahului
    // blok pertama.
    expect(text).toContain("/H1 <</MCID 0>> BDC");
    expect(text).toContain("/P <</MCID 2>> BDC");
    expect(text).toContain("/Figure <</MCID 4>> BDC");
    expect(text).toContain("EMC");
  });

  it("menjadikan baris judul elemen struktur tersendiri", () => {
    // F4-05. Sebagai elemen tersendiri, nama pengrajin terbaca pembaca layar
    // sebagai bagian dari judul dokumen, bukan tenggelam di paragraf pertama.
    const text = latin1(build().bytes);
    const structTreeRoot = /\/Type \/StructTreeRoot \/K \[([^\]]*)\]/.exec(text);

    expect(structTreeRoot).not.toBeNull();
    // Satu rujukan untuk baris judul, ditambah satu untuk setiap blok.
    const references = structTreeRoot?.[1]?.match(/\d+ 0 R/g) ?? [];
    expect(references).toHaveLength(BLOCKS.length + 1);
  });

  it("menyertakan teks alternatif pada setiap gambar", () => {
    // F4-02
    const text = latin1(build().bytes);

    expect(text).toContain("/Alt (Tas kulit cokelat di atas meja marmer)");
    // Gambar disematkan apa adanya sebagai JPEG.
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Filter /DCTDecode");
  });

  it("mencantumkan nama pengrajin", () => {
    // F4-05
    const text = latin1(build().bytes);
    // Tanda pisah panjang ditulis sebagai oktal \227: di luar ASCII, setiap
    // bita dilolosikan tiga digit sesuai spesifikasi PDF.
    expect(text).toContain("Tas Kulit Nusantara \\227 Irsyad");
  });

  it("mengodekan tanda baca tipografis, bukan menggantinya", () => {
    // WinAnsi bukan Latin-1: tanda pisah, tanda kutip melengkung, dan
    // elipsis ada di rentang 0x80–0x9F. Tulisan Indonesia memakainya, dan
    // menggantinya dengan "?" akan membuat laporan karakter penuh padahal
    // teksnya biasa saja.
    const { bytes, replacedCharacters } = build([
      { kind: "paragraph", text: "\u201cTas\u201d \u2013 \u2026 \u2022" },
    ]);

    expect(replacedCharacters).toEqual([]);
    expect(latin1(bytes)).toContain("\\223Tas\\224 \\226 \\205 \\225");
  });

  it("menyatakan bahasa dokumen", () => {
    // Pembaca layar memakai /Lang untuk memilih pelafalan.
    const { bytes } = buildTaggedPdf({
      title: "Nusantara Bag",
      locale: "en",
      artisanName: "Irsyad",
      blocks: BLOCKS,
    });

    expect(latin1(bytes)).toContain("/Lang (en)");
  });

  it("menyusun tabel xref yang menunjuk objek sebenarnya", () => {
    const { bytes } = build();
    const text = latin1(bytes);
    const offsets = xrefOffsets(text);

    expect(offsets.length).toBeGreaterThan(0);

    offsets.forEach((offset, index) => {
      expect(text.startsWith(`${index + 1} 0 obj`, offset)).toBe(true);
    });
  });

  it("menuliskan panjang aliran isi yang benar", () => {
    // /Length yang salah membuat pembaca PDF memotong halaman di tengah.
    const text = latin1(build().bytes);
    const declared = [...text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];

    expect(declared.length).toBeGreaterThan(0);
    for (const match of declared) {
      const start = (match.index ?? 0) + match[0].length;
      const end = text.indexOf("\nendstream", start);
      expect(end - start).toBe(Number(match[1]));
    }
  });

  it("memisahkan halaman saat isinya panjang, dan tetap menautkannya", () => {
    // Isi katalog bisa lebih dari satu halaman. Setiap halaman memerlukan
    // /StructParents sendiri, dan ParentTree harus memuat satu entri untuk
    // setiap indeks itu — kalau tidak, halaman kedua kehilangan strukturnya.
    const long: readonly PdfBlock[] = Array.from({ length: 60 }, (_value, index) => ({
      kind: "paragraph" as const,
      text: `Paragraf ${index} yang cukup panjang untuk memakan satu baris penuh di halaman.`,
    }));

    const { bytes } = build(long);
    const text = latin1(bytes);

    const count = /\/Type \/Pages [^>]*\/Count (\d+)/.exec(text);
    expect(Number(count?.[1] ?? "0")).toBeGreaterThan(1);

    expect(text).toContain("/StructParents 0");
    expect(text).toContain("/StructParents 1");
    expect(text).toContain("/ParentTreeNextKey");
  });

  it("melaporkan karakter yang tidak dapat dikodekan, bukan mendiamkannya", () => {
    // Font inti Helvetica tidak memuat aksara Jepang. Berkasnya tetap
    // dihasilkan, tetapi pemanggil harus tahu isinya tidak utuh.
    const { bytes, replacedCharacters } = build([
      { kind: "heading", level: 1, text: "革のバッグ" },
      { kind: "paragraph", text: "Tas kulit" },
    ]);

    expect(replacedCharacters.length).toBeGreaterThan(0);
    expect(replacedCharacters).toContain("革");
    expect(latin1(bytes)).toContain("Tas kulit");
  });

  it("mengosongkan daftar laporan untuk teks yang seluruhnya dapat dikodekan", () => {
    expect(build().replacedCharacters).toEqual([]);
  });

  it("mengembalikan tanda baca khusus dengan benar", () => {
    // Kurung dan garis miring terbalik harus dilolosikan; tanpa itu,
    // muatan teks akan merusak struktur berkasnya.
    const { bytes, replacedCharacters } = build([
      { kind: "paragraph", text: 'Harga (nego) \\ diskon' },
    ]);

    expect(replacedCharacters).toEqual([]);
    expect(latin1(bytes)).toContain("Harga \\(nego\\) \\\\ diskon");
  });

  it("tetap menghasilkan satu halaman saat tidak ada blok sama sekali", () => {
    const { bytes } = build([]);
    const text = latin1(bytes);

    expect(text).toContain("/Count 1");
    expect(text).toContain("/StructTreeRoot");
  });
});
