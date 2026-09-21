/**
 * PDF bertag struktur.
 *
 * F4-01 dan F4-02 menuntut dua hal yang tidak terlihat pada PDF biasa:
 * dokumennya punya **tag struktur**, dan setiap gambar punya **teks
 * alternatif**. Keduanya adalah syarat agar pembaca layar dapat membacakan
 * katalog dengan urutan yang benar — bukan sekadar agar berkasnya terbuka.
 *
 * Yang ditulis di sini adalah PDF 1.7 minimal namun lengkap secara struktur:
 *
 *   /MarkInfo << /Marked true >>   menandai dokumen sebagai bertag
 *   /StructTreeRoot                akar pohon struktur
 *   /StructElem /S /H1 /S /P       satu elemen per blok, dengan peran
 *   /Alt pada elemen /Figure       teks alternatif gambar
 *   /ParentTree                    memetakan halaman ke elemennya
 *   /MCID di dalam aliran isi      penanda yang menghubungkan keduanya
 *
 * Seluruh penulisan dilakukan sendiri, tanpa pustaka. Menambah pustaka PDF
 * dilarang tanpa persetujuan pemilik proyek (AGENTS.md), dan pustaka yang
 * ada pun tidak semuanya menghasilkan PDF bertag.
 *
 * BATAS YANG DISADARI: teks dikodekan WinAnsi (Latin-1), dan font inti
 * Helvetica tidak memuat aksara Jepang, Tionghoa, maupun Arab. Karakter di
 * luar jangkauan itu **dilaporkan** lewat `replacedCharacters`, bukan
 * didiamkan — pemanggil dapat memutuskan untuk menolak ekspor tersebut
 * alih-alih menyerahkan katalog yang salah baca.
 */

/** Blok isi dokumen. Perannya di pohon struktur ditentukan oleh jenisnya. */
export type PdfBlock =
  | { readonly kind: "heading"; readonly level: 1 | 2; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string }
  | {
      readonly kind: "figure";
      /** Bita JPEG apa adanya. PDF mengenali DCTDecode tanpa penguraian ulang. */
      readonly jpeg: Uint8Array;
      readonly pixelWidth: number;
      readonly pixelHeight: number;
      readonly altText: string;
    };

export interface PdfDocumentInput {
  readonly title: string;
  /** Kode BCP-47. Dibaca pembaca layar untuk memilih pelafalan. */
  readonly locale: string;
  /** Nama pengrajin. F4-05: setiap ekspor mencantumkannya. */
  readonly artisanName: string;
  readonly blocks: readonly PdfBlock[];
}

export interface PdfBuildResult {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /**
   * Karakter yang tidak dapat dikodekan dan digantikan `?`.
   *
   * Ada supaya pemanggil dapat menolak ekspor yang tidak terbaca, alih-alih
   * menerima berkas yang tampak baik-baik saja.
   */
  readonly replacedCharacters: readonly string[];
}

// --- Tata letak ---

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const FONT_SIZE = { heading1: 20, heading2: 14, paragraph: 11 } as const;
const LEADING = { heading1: 28, heading2: 22, paragraph: 16 } as const;

/**
 * Lebar rata-rata Helvetica sebagai pecahan dari ukuran font.
 *
 * Perkiraan, bukan metrik sebenarnya: tabel lebar AFM Helvetica memuat lebih
 * dari dua ratus angka, dan menyalinnya ke sini berarti memelihara tabel yang
 * tidak akan ada yang memeriksa. Akibatnya baris dapat sedikit lebih pendek
 * atau lebih panjang dari seharusnya — dan itu tidak merusak struktur maupun
 * keterbacaan.
 */
const AVERAGE_GLYPH_WIDTH = 0.52;

function wrap(text: string, fontSize: number): readonly string[] {
  const maxCharacters = Math.max(
    8,
    Math.floor(CONTENT_WIDTH / (fontSize * AVERAGE_GLYPH_WIDTH)),
  );

  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxCharacters) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = word;
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

interface PlacedLine {
  readonly text: string;
  readonly fontSize: number;
  readonly x: number;
  readonly y: number;
}

interface PlacedFigure {
  readonly imageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Satu blok yang sudah diletakkan di sebuah halaman.
 *
 * `mcid` adalah penanda di dalam aliran isi. Struktur pohon menunjuk ke
 * nomor ini, dan nomor ini pula yang membuat urutan baca pembaca layar sama
 * dengan urutan penulisan.
 */
interface PlacedBlock {
  readonly blockIndex: number;
  readonly mcid: number;
  readonly lines: readonly PlacedLine[];
  readonly figure: PlacedFigure | null;
}

interface LaidOutPage {
  readonly placed: readonly PlacedBlock[];
}

function layout(blocks: readonly PdfBlock[]): readonly LaidOutPage[] {
  const pages: PlacedBlock[][] = [];
  let placed: PlacedBlock[] = [];
  let cursor = PAGE_HEIGHT - MARGIN;
  let imageIndex = 0;

  const flush = (): void => {
    pages.push(placed);
    placed = [];
    cursor = PAGE_HEIGHT - MARGIN;
  };

  blocks.forEach((block, blockIndex) => {
    const heading = block.kind === "heading";
    const size = heading
      ? FONT_SIZE[block.level === 1 ? "heading1" : "heading2"]
      : FONT_SIZE.paragraph;
    const leading = heading
      ? LEADING[block.level === 1 ? "heading1" : "heading2"]
      : LEADING.paragraph;

    if (block.kind === "figure") {
      const scale = Math.min(1, CONTENT_WIDTH / block.pixelWidth);
      const width = block.pixelWidth * scale;
      const height = block.pixelHeight * scale;

      if (cursor - height < MARGIN && placed.length > 0) flush();

      placed.push({
        blockIndex,
        mcid: placed.length,
        lines: [],
        figure: { imageIndex, x: MARGIN, y: cursor - height, width, height },
      });
      imageIndex += 1;
      cursor -= height + LEADING.paragraph;
      return;
    }

    if (cursor - leading < MARGIN && placed.length > 0) flush();

    const lines: PlacedLine[] = [];
    for (const line of wrap(block.text, size)) {
      lines.push({ text: line, fontSize: size, x: MARGIN, y: cursor });
      cursor -= leading;
    }

    placed.push({ blockIndex, mcid: placed.length, lines, figure: null });
  });

  if (placed.length > 0) flush();
  if (pages.length === 0) flush();

  return pages.map((page) => ({ placed: page }));
}

// --- Pengodean ---

interface EncodedText {
  readonly bytes: readonly number[];
  readonly replaced: readonly string[];
}

/**
 * WinAnsi untuk rentang 0x80–0x9F.
 *
 * WinAnsi bukan Latin-1. Rentang itu memuat tanda baca tipografis yang
 * justru lazim dalam tulisan Indonesia — tanda pisah panjang, tanda kutip
 * melengkung, elipsis, dan tanda bullet. Tanpa tabel ini ketiganya diganti
 * "?", dan laporan karakter akan penuh padahal teksnya biasa saja.
 */
const WIN_ANSI_UPPER: Readonly<Record<number, number>> = {
  0x20ac: 0x80, // €
  0x201a: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201e: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02c6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8a, // Š
  0x2039: 0x8b, // ‹
  0x0152: 0x8c, // Œ
  0x017d: 0x8e, // Ž
  0x2018: 0x91, // ‘
  0x2019: 0x92, // ’
  0x201c: 0x93, // “
  0x201d: 0x94, // ”
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9a, // š
  0x203a: 0x9b, // ›
  0x0153: 0x9c, // œ
  0x017e: 0x9e, // ž
  0x0178: 0x9f, // Ÿ
};

/**
 * WinAnsi: ASCII, rentang 0x80–0x9F di atas, dan Latin-1 atas.
 *
 * Cukup untuk Bahasa Indonesia dan sebagian besar bahasa Eropa. Di luar itu
 * karakter diganti `?` dan dicatat — melaporkannya lebih berguna daripada
 * menghasilkan berkas yang diam-diam salah.
 */
function encodeWinAnsi(text: string): EncodedText {
  const bytes: number[] = [];
  const replaced: string[] = [];

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) {
      bytes.push(code);
      continue;
    }
    if (code >= 0xa0 && code <= 0xff) {
      bytes.push(code);
      continue;
    }

    const upper = WIN_ANSI_UPPER[code];
    if (upper !== undefined) {
      bytes.push(upper);
      continue;
    }

    replaced.push(character);
    bytes.push(0x3f);
  }

  return { bytes, replaced };
}

function escapePdfString(bytes: readonly number[]): string {
  let escaped = "";
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      escaped += `\\${String.fromCharCode(byte)}`;
    } else if (byte >= 0x20 && byte <= 0x7e) {
      escaped += String.fromCharCode(byte);
    } else {
      // Di luar ASCII ditulis sebagai oktal tiga digit, sesuai spesifikasi.
      escaped += `\\${byte.toString(8).padStart(3, "0")}`;
    }
  }
  return escaped;
}

// --- Penyusun bita ---

class ByteWriter {
  private readonly chunks: number[] = [];

  get length(): number {
    return this.chunks.length;
  }

  ascii(text: string): void {
    for (let index = 0; index < text.length; index += 1) {
      this.chunks.push(text.charCodeAt(index) & 0xff);
    }
  }

  raw(values: Uint8Array): void {
    for (const value of values) this.chunks.push(value);
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.chunks);
  }
}

interface PdfObject {
  readonly header: string;
  readonly stream?: Uint8Array;
}

// --- Penyusunan ---

/**
 * Menyusun PDF bertag dari blok isi.
 *
 * Nomor objek dialokasikan lebih dulu supaya rujukan antar-objek dapat
 * ditulis tanpa dua lintasan. Urutannya:
 *
 *   1..5          katalog, halaman, font, akar struktur, ParentTree
 *   6..           pasangan halaman dan aliran isinya
 *   lalu          elemen struktur, satu per blok
 *   terakhir      objek gambar, satu per blok gambar
 *
 * Setiap halaman memakai DUA objek — kamus halaman dan aliran isinya — dan
 * itulah sebabnya nomor elemen struktur dihitung dari `pages.length * 2`.
 */
export function buildTaggedPdf(input: PdfDocumentInput): PdfBuildResult {
  // Baris judul adalah elemen struktur tersendiri, bukan tempelan pada blok
  // pertama. F4-05 menuntut nama pengrajin ada di setiap ekspor, dan sebagai
  // elemen tersendiri ia terbaca pembaca layar sebagai judul dokumen — bukan
  // tenggelam di dalam paragraf pertama. Menempelkannya ke blok pertama juga
  // akan membuang teks blok itu, dan teks yang hilang diam-diam lebih buruk
  // daripada satu baris berlebih.
  const blocks: readonly PdfBlock[] = [
    { kind: "heading", level: 1, text: `${input.title} \u2014 ${input.artisanName}` },
    ...input.blocks,
  ];

  const pages = layout(blocks);
  const replaced: string[] = [];

  const encode = (text: string): string => {
    const encoded = encodeWinAnsi(text);
    replaced.push(...encoded.replaced);
    return escapePdfString(encoded.bytes);
  };

  const pageCount = pages.length;
  const blockCount = blocks.length;
  const figureCount = blocks.filter((block) => block.kind === "figure").length;

  const CATALOG_ID = 1;
  const PAGES_ID = 2;
  const FONT_ID = 3;
  const STRUCT_TREE_ROOT_ID = 4;
  const PARENT_TREE_ID = 5;
  const FIRST_PAGE_ID = 6;
  const FIRST_STRUCT_ELEM_ID = FIRST_PAGE_ID + pageCount * 2;
  const FIRST_IMAGE_ID = FIRST_STRUCT_ELEM_ID + blockCount;

  const pageId = (index: number): number => FIRST_PAGE_ID + index * 2;
  const contentId = (index: number): number => FIRST_PAGE_ID + index * 2 + 1;
  const structElemId = (blockIndex: number): number => FIRST_STRUCT_ELEM_ID + blockIndex;
  const imageId = (index: number): number => FIRST_IMAGE_ID + index;

  const objects: PdfObject[] = [];

  // 1. Katalog. /MarkInfo dan /StructTreeRoot inilah yang membuat dokumen ini
  //    disebut bertag; tanpa keduanya, pohon struktur di bawahnya tidak akan
  //    dibaca pembaca layar sama sekali.
  objects.push({
    header:
      `<< /Type /Catalog /Pages ${PAGES_ID} 0 R ` +
      `/MarkInfo << /Marked true >> /StructTreeRoot ${STRUCT_TREE_ROOT_ID} 0 R ` +
      `/Lang (${encode(input.locale)}) /ViewerPreferences << /DisplayDocTitle true >> >>`,
  });

  // 2. Daftar halaman.
  objects.push({
    header:
      `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_value, index) => `${pageId(index)} 0 R`).join(" ")}] ` +
      `/Count ${pageCount} >>`,
  });

  // 3. Font inti. Tidak disematkan karena setiap pembaca PDF menyediakannya,
  //    dan itu menghindari membawa berkas font di bundel Worker.
  objects.push({
    header:
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica " +
      "/Encoding /WinAnsiEncoding >>",
  });

  // 4. Akar pohon struktur.
  objects.push({
    header:
      `<< /Type /StructTreeRoot /K [${blocks
        .map((_block, index) => `${structElemId(index)} 0 R`)
        .join(" ")}] /ParentTree ${PARENT_TREE_ID} 0 R /ParentTreeNextKey ${pageCount} >>`,
  });

  // 5. ParentTree memetakan /StructParents sebuah halaman ke elemen yang
  //    isinya ada di halaman itu. Inilah penghubung antara penanda di dalam
  //    aliran isi dan perannya.
  objects.push({
    header: `<< /Nums [${pages
      .map(
        (page, index) =>
          `${index} [${page.placed.map((block) => `${structElemId(block.blockIndex)} 0 R`).join(" ")}]`,
      )
      .join(" ")}] >>`,
  });

  // 6.. Pasangan halaman dan aliran isinya.
  pages.forEach((page, index) => {
    const writer = new ByteWriter();

    for (const block of page.placed) {
      const role =
        block.figure !== null
          ? "Figure"
          : blocks[block.blockIndex]?.kind === "heading"
            ? (blocks[block.blockIndex] as { level: 1 | 2 }).level === 1
              ? "H1"
              : "H2"
            : "P";

      // Satu pasangan BDC/EMC per blok, bukan per baris: satu elemen struktur
      // boleh memuat banyak baris, dan memecahnya akan membuat pembaca layar
      // membacakan setiap baris sebagai paragraf tersendiri.
      writer.ascii(`/${role} <</MCID ${block.mcid}>> BDC\n`);

      if (block.figure !== null) {
        const figure = block.figure;
        writer.ascii(
          `q ${figure.width.toFixed(2)} 0 0 ${figure.height.toFixed(2)} ` +
            `${figure.x.toFixed(2)} ${figure.y.toFixed(2)} cm /Im${figure.imageIndex} Do Q\n`,
        );
      }

      for (const line of block.lines) {
        writer.ascii(
          `BT /F1 ${line.fontSize} Tf ${line.x.toFixed(2)} ${line.y.toFixed(2)} Td ` +
            `(${encode(line.text)}) Tj ET\n`,
        );
      }

      writer.ascii("EMC\n");
    }

    const content = writer.toUint8Array();

    objects.push({
      header:
        `<< /Type /Page /Parent ${PAGES_ID} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${FONT_ID} 0 R >> /XObject << ${page.placed
          .filter((block) => block.figure !== null)
          .map((block) => `/Im${block.figure?.imageIndex ?? 0} ${imageId(block.figure?.imageIndex ?? 0)} 0 R`)
          .join(" ")} >> >> ` +
        `/Contents ${contentId(index)} 0 R /StructParents ${index} >>`,
    });

    objects.push({ header: `<< /Length ${content.length} >>`, stream: content });
  });

  // Elemen struktur. Satu per blok, berurutan sesuai urutan pembacaan.
  blocks.forEach((block, index) => {
    const pageIndex = pages.findIndex((page) =>
      page.placed.some((placed) => placed.blockIndex === index),
    );
    const ownerPageId = pageId(Math.max(0, pageIndex));

    if (block.kind === "figure") {
      const mcid = pages[pageIndex]?.placed.find((placed) => placed.blockIndex === index)?.mcid ?? 0;

      // /Alt inilah yang dibacakan pembaca layar menggantikan gambarnya.
      objects.push({
        header:
          `<< /Type /StructElem /S /Figure /P ${STRUCT_TREE_ROOT_ID} 0 R /Pg ${ownerPageId} 0 R ` +
          `/Alt (${encode(block.altText)}) /A << /O /Layout /Placement /Block >> /K ${mcid} >>`,
      });
      return;
    }

    const role = block.kind === "heading" ? (block.level === 1 ? "H1" : "H2") : "P";
    const mcid = pages[pageIndex]?.placed.find((placed) => placed.blockIndex === index)?.mcid ?? 0;

    objects.push({
      header:
        `<< /Type /StructElem /S /${role} /P ${STRUCT_TREE_ROOT_ID} 0 R ` +
        `/Pg ${ownerPageId} 0 R /K ${mcid} >>`,
    });
  });

  // Objek gambar. JPEG disematkan apa adanya dengan DCTDecode: PDF mengenali
  // aliran JPEG tanpa penguraian ulang, sehingga tidak ada dekode di Worker.
  for (const block of blocks) {
    if (block.kind !== "figure") continue;

    objects.push({
      header:
        `<< /Type /XObject /Subtype /Image /Width ${block.pixelWidth} ` +
        `/Height ${block.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${block.jpeg.length} >>`,
      stream: block.jpeg,
    });
  }

  const expectedObjects = FIRST_IMAGE_ID + figureCount - 1;
  if (objects.length !== expectedObjects) {
    // Penjagaan terhadap perubahan tata letak objek. Kalau jumlahnya tidak
    // lagi cocok, rujukan antar-objek di atas pasti salah — dan PDF yang
    // salah lebih buruk daripada ekspor yang gagal.
    throw new Error(
      `Susunan objek PDF tidak konsisten: ${objects.length} dari ${expectedObjects}`,
    );
  }

  // --- Serialisasi ---

  const writer = new ByteWriter();
  const offsets: number[] = [];

  writer.ascii("%PDF-1.7\n");
  // Komentar biner menandai berkas ini memuat bita di luar ASCII, sehingga
  // alat yang menyalinnya memperlakukannya sebagai biner.
  writer.ascii("%\u00e2\u00e3\u00cf\u00d3\n");

  objects.forEach((object, index) => {
    offsets.push(writer.length);
    writer.ascii(`${index + 1} 0 obj\n${object.header}\n`);

    if (object.stream !== undefined) {
      writer.ascii("stream\n");
      writer.raw(object.stream);
      writer.ascii("\nendstream\n");
    }

    writer.ascii("endobj\n");
  });

  const xrefOffset = writer.length;
  writer.ascii(`xref\n0 ${objects.length + 1}\n`);
  writer.ascii("0000000000 65535 f \n");
  for (const offset of offsets) {
    writer.ascii(`${offset.toString().padStart(10, "0")} 00000 n \n`);
  }
  writer.ascii(
    `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG_ID} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return {
    bytes: writer.toUint8Array(),
    replacedCharacters: [...new Set(replaced)],
  };
}
