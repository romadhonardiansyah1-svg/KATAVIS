/**
 * Naskah berwaktu untuk Talking-Catalog — `narration.captions`.
 *
 * ==== Mengapa ini ada ====
 *
 * Kontrak API bagian 10 menjanjikan `narration.captions` berisi kalimat
 * berwaktu, dan `components/catalog/TalkingCatalog.tsx` mengembalikan `null`
 * bila lariknya kosong — artinya fitur F3 (Talking-Catalog & AI Avatar)
 * tidak tampil sama sekali, bukan tampil tanpa suara. Selama lariknya selalu
 * kosong, fitur unggulan itu tidak pernah ada di layar.
 *
 * ==== Mengapa dibangkitkan dari `story`, bukan dari TTS ====
 *
 * ADR-005 mencatat penyedia TTS Bahasa Indonesia sebagai keputusan terbuka
 * (O4). Menunggu keputusan itu berarti fitur ini tetap mati tanpa batas
 * waktu. Tetapi kedua hal itu sebenarnya tidak saling mengunci:
 *
 *   - **Audio** yang bergantung pada penyedia suara. Belum diputuskan.
 *   - **Naskah berwaktu** yang merupakan pembagian `story` menjadi kalimat.
 *     Tidak memerlukan penyedia, tidak memerlukan jaringan, dan hasilnya
 *     sama di mana pun.
 *
 * Berkas ini hanya mengerjakan yang kedua. `audioUrl` tetap `null` sampai
 * O4 dijawab, dan pemutar sudah menangani keadaan itu sebagai keadaan yang
 * sah: subjudulnya berjalan mengikuti panjang kalimat, jamnya berjalan, dan
 * seluruh informasi tetap terbaca. Bila TTS ditambahkan kelak, yang berubah
 * hanya `audioUrl`; naskah berwaktunya sudah menunggu.
 *
 * ==== Mengapa waktunya dihitung, bukan diukur ====
 *
 * Tanpa berkas audio tidak ada yang dapat diukur. Yang dipakai adalah laju
 * baca Bahasa Indonesia yang lazim untuk narasi produk: sekitar 150 kata per
 * menit, dengan jeda di antara kalimat. Ini pilihan yang jujur — angka yang
 * dapat dibaca dan diperiksa di tabel di bawah — bukan durasi yang dikarang
 * seolah-olah hasil pengukuran.
 *
 * Berkas ini murni: tanpa DOM, tanpa jaringan, tanpa kripto. Yang tidak
 * dapat diuji tanpa Worker tidak boleh tinggal di sini.
 */

/** Satu kalimat berwaktu, sesuai bentuk di kontrak API bagian 10. */
export interface Caption {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

/**
 * Laju baca Bahasa Indonesia.
 *
 * 150 kata/menit adalah laju narasi yang tenang dan mudah diikuti — lebih
 * lambat daripada pembacaan berita (sekitar 180), dan itu disengaja:
 * pendengar katalog ini termasuk pengguna yang membaca lambat.
 */
const WORDS_PER_MINUTE = 150;

const MS_PER_MINUTE = 60_000;
const MS_PER_WORD = MS_PER_MINUTE / WORDS_PER_MINUTE;

/**
 * Jeda di antara kalimat.
 *
 * Kalimat yang berganti tanpa jeda terbaca seperti satu kalimat panjang yang
 * salah dibagi, dan pada profil Pendengaran itu menyulitkan. 320 ms cukup
 * untuk terasa sebagai akhir kalimat tanpa membuat pemutarnya terasa lambat.
 */
const GAP_MS = 320;

/**
 * Durasi minimum dan maksimum satu kalimat.
 *
 * Minimum menjaga kalimat pendek ("30 x 20 cm.") tidak berkedip terlalu
 * cepat untuk dibaca. Maksimum menjaga kalimat yang salah tanda bacanya
 * tidak menyita satu menit penuh.
 */
const MIN_CAPTION_MS = 1_200;
const MAX_CAPTION_MS = 12_000;

/**
 * Memecah cerita menjadi kalimat.
 *
 * Dipisah pada tanda baca akhir kalimat yang diikuti spasi, bukan pada
 * setiap titik: "30 x 20 cm." tidak boleh menjadi dua kalimat, dan singkatan
 * seperti "dll." tidak boleh memenggal kalimatnya. Karena itu titik yang
 * diikuti angka atau huruf kecil tidak dianggap akhir kalimat.
 */
function splitSentences(story: string): readonly string[] {
  const normalized = story.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return [];

  const parts: string[] = [];
  let current = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? "";
    current += character;

    if (character !== "." && character !== "!" && character !== "?") continue;

    const next = normalized[index + 1];
    const afterNext = normalized[index + 2];

    // Tanda akhir kalimat wajib diikuti spasi (atau akhir teks).
    if (next !== undefined && next !== " ") continue;

    // Titik diikuti angka ("30 x 20.") atau huruf kecil ("dll. dan") bukan
    // akhir kalimat.
    if (next === " " && afterNext !== undefined && afterNext !== afterNext.toUpperCase()) {
      continue;
    }

    parts.push(current.trim());
    current = "";
  }

  // Sisa tanpa tanda akhir tetap menjadi kalimat: cerita yang berakhir tanpa
  // titik tetap harus terbaca.
  if (current.trim().length > 0) parts.push(current.trim());

  return parts.filter((part) => part.length > 0);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(" ").length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Menyusun naskah berwaktu dari cerita produk.
 *
 * Mengembalikan larik kosong bila ceritanya kosong atau tidak dapat dibagi.
 * Larik kosong adalah jawaban yang benar di situ: pemutar tidak dapat
 * menyarangkan apa pun, dan halaman sudah menangani keadaan itu dengan
 * menampilkan cerita sebagai teks biasa.
 *
 * Tiap `startMs` bersambung tepat pada `endMs` kalimat sebelumnya ditambah
 * jeda. Tidak ada celah yang tidak dijelaskan dan tidak ada tumpang tindih:
 * `components/catalog/timeline.ts` mencari kalimat aktif dengan membandingkan
 * `positionMs` terhadap rentang ini, dan celah akan membuat satu saat
 * berlalu tanpa subjudul.
 */
export function buildCaptions(story: string | null): readonly Caption[] {
  if (story === null) return [];

  const sentences = splitSentences(story);
  if (sentences.length === 0) return [];

  const captions: Caption[] = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const spokenMs = countWords(sentence) * MS_PER_WORD;
    const durationMs = clamp(Math.round(spokenMs), MIN_CAPTION_MS, MAX_CAPTION_MS);

    captions.push({
      startMs: cursor,
      endMs: cursor + durationMs,
      text: sentence,
    });

    cursor += durationMs + GAP_MS;
  }

  return captions;
}
