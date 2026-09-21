/**
 * Jam narasi Talking-Catalog.
 *
 * `narration.captions` dari `GET /public/catalog/:slug` tidak membawa
 * durasi total — kontrak API bagian 10 hanya menyebut `startMs` dan
 * `endMs` per kalimat. Karena itu jamnya diambil dari larik `captions`
 * sendiri: sebuah kalimat aktif selama `endMs`-nya, dan audio hanya
 * menyetel jarnya. Bentuk yang sama dipakai pemutar subtitle mana pun,
 * dan tidak ada bidang baru yang perlu ditambahkan ke kontrak.
 *
 * Berkas ini murni: tanpa DOM, tanpa React, tanpa jaringan. Yang tidak
 * dapat diuji tanpa peramban tidak boleh tinggal di sini.
 */

import { z } from "zod";

const DEFAULT_LOCALE = "id";

/**
 * Satu kalimat berwaktu.
 *
 * `text` tidak boleh kosong: kalimat tanpa teks akan menyorot baris yang
 * tidak mengatakan apa pun, dan pada profil Pendengaran itu berarti
 * kehilangan informasi, bukan sekadar tampilan yang jelek.
 */
export const CaptionSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().min(1),
  })
  .refine((caption) => caption.endMs > caption.startMs, {
    message: "Kalimat harus berakhir setelah ia dimulai",
  });

export const NarrationSchema = z.object({
  audioUrl: z.string().nullable(),
  captions: z.array(CaptionSchema),
});

export const CatalogMediaSchema = z.object({
  url: z.string().min(1),
  altText: z.string().nullable(),
});

/**
 * Bentuk respons `GET /public/catalog/:slug`.
 *
 * `slug` sengaja TIDAK ada di sini meski halaman membutuhkannya: kontrak
 * API bagian 10 tidak mencantumkannya, dan menambahkannya berarti
 * mengarang bidang yang tidak dimiliki server. Halaman mengambil slug dari
 * parameter rutenya sendiri.
 */
export const PublicCatalogSchema = z.object({
  name: z.string().nullable(),
  story: z.string().nullable(),
  specs: z.array(z.string()),
  artisan: z.object({ displayName: z.string() }),
  media: z.array(CatalogMediaSchema),
  narration: NarrationSchema,
  availableLocales: z.array(z.string()),
});

export type Caption = z.infer<typeof CaptionSchema>;
export type Narration = z.infer<typeof NarrationSchema>;
export type CatalogMedia = z.infer<typeof CatalogMediaSchema>;
export type PublicCatalog = z.infer<typeof PublicCatalogSchema>;

/**
 * Batas atas pengambilan posisi ke kalimat.
 *
 * Kesalahan pengambilan sampel pada 60 Hz paling besar setengah bingkai,
 * yaitu sekitar 8 ms. 200 ms memberi ruang jauh di atasnya — TC-A11Y-24
 * menuntut toleransi ±200 ms — sehingga pengambilan sampel tidak pernah
 * menjadi penyebab kegagalannya.
 */
export const CAPTION_TOLERANCE_MS = 200;

/** Jeda sebelum maju ke kalimat berikutnya pada mode tanpa suara. */
export const READING_PAUSE_MS = 140;

/** Jeda awal sebelum kalimat pertama dibacakan pada mode tanpa suara. */
export const READING_LEAD_IN_MS = 400;

/** Jeda setelah kalimat terakhir sebelum narasi dinyatakan selesai. */
export const READING_TAIL_MS = 900;

/**
 * Perkiraan tempo baca untuk mode tanpa suara sama sekali.
 *
 * Angka ini TIDAK dipakai bila ada sumber suara apa pun — bila ada, jamnya
 * datang dari audio atau dari TTS yang benar-benar berbunyi. Ia hanya
 * menjaga subtitle tetap bergerak saat suara tidak dapat dibunyikan
 * (TC-A11Y-26, TC-A11Y-27).
 */
const FALLBACK_CHARS_PER_MS = 0.014;

/** Batas panjang satu kalimat di mode tanpa suara, supaya tidak menggantung. */
const FALLBACK_MAX_CAPTION_MS = 6_000;

export function captionDurationMs(caption: Caption): number {
  return Math.max(0, caption.endMs - caption.startMs);
}

/** Kalimat dengan akhir terjauh. Nol berarti tidak ada kalimat. */
export function timelineDurationMs(captions: readonly Caption[]): number {
  let endMs = 0;
  for (const caption of captions) endMs = Math.max(endMs, caption.endMs);
  return endMs;
}

/**
 * Durasi perkiraan saat tidak ada suara.
 *
 * Menghormati `endMs` bila ada: memendekkannya berarti membuang waktu yang
 * sudah disepakati penulis naskah.
 */
export function fallbackDurationMs(caption: Caption): number {
  const estimated = caption.text.length / FALLBACK_CHARS_PER_MS;
  return Math.min(Math.max(estimated, captionDurationMs(caption)), FALLBACK_MAX_CAPTION_MS);
}

/** Durasi satu kalimat menurut sumber suara yang sedang dipakai. */
export function effectiveDurationMs(caption: Caption, hasVoice: boolean): number {
  return hasVoice ? captionDurationMs(caption) : fallbackDurationMs(caption);
}

/** Durasi satu putaran penuh menurut sumber suara yang sedang dipakai. */
export function effectiveTotalMs(
  captions: readonly Caption[],
  hasVoice: boolean,
): number {
  if (!hasVoice) {
    return (
      READING_LEAD_IN_MS +
      captions.reduce((total, caption) => total + fallbackDurationMs(caption), 0) +
      READING_TAIL_MS
    );
  }

  return timelineDurationMs(captions);
}

/**
 * Rentang satu kalimat pada garis waktu yang sedang berjalan.
 *
 * Kalimat saling menempel, jadi menyerahkan `startMs`/`endMs` mentah ke
 * audio berarti audio kehilangan penggalan tanpa waktu pada naskah — dan
 * itu justru kasus yang paling mungkin, karena kontrak API hanya
 * mewajibkan `startMs` dan `endMs` pada setiap kalimat.
 */
export function captionSlotMs(
  caption: Caption,
  index: number,
  captions: readonly Caption[],
  hasVoice: boolean,
): number {
  if (hasVoice) return captionDurationMs(caption);

  const isFirst = index === 0;
  return fallbackDurationMs(caption) + (isFirst ? READING_LEAD_IN_MS : READING_PAUSE_MS);
}

/** Posisi (ms) tempat kalimat ke-`index` mulai pada garis waktu yang berjalan. */
export function captionStartMs(
  index: number,
  captions: readonly Caption[],
  hasVoice: boolean,
): number {
  if (hasVoice) return captions[index]?.startMs ?? 0;

  let startMs = index <= 0 ? 0 : READING_LEAD_IN_MS;
  for (let previous = 0; previous < index; previous += 1) {
    const caption = captions[previous];
    if (caption === undefined) break;
    startMs += fallbackDurationMs(caption) + READING_PAUSE_MS;
  }
  return startMs;
}

/**
 * Batas akhir kalimat ke-`index` pada garis waktu yang berjalan.
 *
 * Dipakai penggeser: pada mode bersuara kalimatnya berakhir di `endMs`-nya
 * sendiri, jadi menggeser ke kalimat berarti menggeser ke `startMs`-nya.
 */
export function captionEndMs(
  index: number,
  captions: readonly Caption[],
  hasVoice: boolean,
): number {
  const caption = captions[index];
  if (caption === undefined) return 0;
  return captionStartMs(index, captions, hasVoice) + captionSlotMs(caption, index, captions, hasVoice);
}

/**
 * Kalimat yang sedang dibacakan.
 *
 * Pengambilan sampel berbasis selang, bukan pencocokan batas: video tidak
 * punya peristiwa pada `startMs` ke-3.200, dan mencarinya akan meleset
 * begitu saja. Rentangnya mengapit, sehingga nilai paling tepi pun jatuh
 * pada kalimat yang benar.
 *
 * `-1` berarti tidak ada yang sedang dibacakan. Itu keadaan yang sah:
 * sebelum kalimat pertama, dan selama jeda 140 ms di mode tanpa suara.
 */
export function captionIndexAt(captions: readonly Caption[], positionMs: number): number {
  if (positionMs < 0) return -1;

  for (let index = 0; index < captions.length; index += 1) {
    const caption = captions[index];
    if (caption === undefined) continue;
    if (positionMs >= caption.startMs && positionMs < caption.endMs) return index;
  }

  return -1;
}

/**
 * Bentuk mulut dari posisi pada satu kalimat.
 *
 * 0 = diam, 1 = setengah buka, 2 = buka. Bentuknya dipilih berdasar
 * posisi relatif di dalam kalimat, bukan berdasar amplitudo audio:
 * membaca `AnalyserNode` menuntut konteks audio yang aktif, dan konteks
 * itu ditahan peramban sampai ada interaksi pengguna. Avatar yang baru
 * bergerak setelah tombol kedua membuat kesan pertama gagal — pada demo
 * langsung, itu seluruh nilainya.
 *
 * Gerak mulut karena itu bukan pengukur kebenaran, melainkan penanda
 * bahwa narasi sedang berjalan. Penanda yang benar adalah subtitle.
 */
export function mouthShape(positionMs: number, caption: Caption | null): 0 | 1 | 2 {
  if (caption === null || positionMs < caption.startMs || positionMs >= caption.endMs) return 0;

  const duration = captionDurationMs(caption);
  if (duration <= 0) return 0;

  const progress = (positionMs - caption.startMs) / duration;

  // Tiga ketukan per detik, bergeser tiap setengah ketukan. Dua bentuk ini
  // yang membuat mulutnya terbaca membuka-menutup alih-alih berdenyut.
  return progress % 1 < 0.5 ? 1 : 2;
}

/**
 * Kunci gabungan waktu dan teks kalimat.
 *
 * Teksnya ikut masuk supaya penyuntingan subtitle di server terlihat
 * pengguna tanpa menunggu audio diunduh ulang — berkasnya berubah, isinya
 * belum tentu.
 */
export function captionKey(caption: Caption | null): string {
  if (caption === null) return "none";
  return `${caption.startMs}:${caption.endMs}:${caption.text}`;
}

/**
 * Suara mana yang dipakai TTS perangkat.
 *
 * Daftar suara dimuat peramban secara asinkron dan dapat berubah saat
 * sudah dibaca, jadi pemanggilnya harus mendengarkan `voiceschanged`.
 *
 * Kandidatnya diurutkan lebih dulu: `id-ID` mengalahkan `id`, dan varian
 * laki-laki mengalahkan perempuan dengan menganggap perakitan memilih
 * tokoh pria; itu konvensi, bukan kebenaran. Yang penting setiap perangkat
 * menemukan suara yang sama untuk naskah yang sama — suara yang berganti
 * di tengah narasi terbaca sebagai kerusakan, bukan sebagai pilihan.
 */
export function pickIndonesianVoice(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const indonesian = voices.filter((voice) => /^id\b/i.test(voice.lang));
  if (indonesian.length === 0) return null;

  // Tersaring ruas yang sama persis, lalu nama laki-laki, lalu sisanya.
  // Suara bawaan perangkat didahulukan: TTS daring berarti satu titik gagal
  // jaringan lagi pada jalur demo, dan ADR-005 menyatakan fitur ini tidak
  // boleh pernah gagal saat demo.
  const male = /male|pria|ardi|budi|andika|reza/i;

  const exact = indonesian.filter((voice) => voice.lang.replace("_", "-") === "id-ID");
  const sameRegion = exact.length > 0 ? exact : indonesian;

  return (
    sameRegion.find((voice) => voice.localService && male.test(voice.name)) ??
    sameRegion.find((voice) => voice.localService) ??
    sameRegion[0] ??
    null
  );
}

/**
 * Kalimat yang harus dibacakan saat narasi dilanjutkan dari posisi tertentu.
 *
 * Pada mode bersuara, satu `SpeechSynthesisUtterance` dibentuk untuk
 * seluruh penggalan jam yang tersisa — bukan satu per kalimat. Satu
 * utterance menjaga suara dan tempo tetap sama lintas kalimat;
 * memecahnya per kalimat membuat jeda di setiap sambungan.
 */
export function remainingText(
  captions: readonly Caption[],
  positionMs: number,
): { readonly fromIndex: number; readonly text: string } {
  if (captions.length === 0) return { fromIndex: 0, text: "" };

  // Batasnya inklusif: menjeda tepat di `startMs` sebuah kalimat lalu
  // melanjutkan harus mengulang kalimat itu, bukan melompatinya.
  let fromIndex = captions.findIndex(
    (caption) => positionMs <= caption.startMs || positionMs < caption.endMs,
  );
  if (fromIndex < 0) fromIndex = captions.length - 1;

  return {
    fromIndex,
    text: captions
      .slice(fromIndex)
      .map((caption) => caption.text)
      .join(" "),
  };
}

/** Sepotong kode bahasa; `id-ID` menjadi `id`. */
export function languageOf(locale: string): string {
  return locale.split("-")[0] ?? DEFAULT_LOCALE;
}

/**
 * Apakah sepotong teks berbahasa Indonesia.
 *
 * Dipakai untuk memilih tag bahasa narasi tanpa bergantung pada urutan
 * `availableLocales`, yang datang dari basis data dan tidak menjanjikan
 * urutan apa pun. Penanda yang dipakai adalah kosakata fungsi, karena
 * ejaan Latin dipakai bersama oleh banyak bahasa dan tidak membedakan
 * apa pun.
 *
 * Tanda hubung dinormalkan lebih dulu supaya kata ulang seperti
 * "karya-karya" tidak dianggap satu kata asing.
 */
const INDONESIAN_MARKERS = [
  "yang",
  "dengan",
  "dari",
  "dan",
  "ini",
  "itu",
  "untuk",
  "tidak",
  "kulit",
  "buatan",
  "tangan",
  "hasil",
] as const;

export function isIndonesianLanguage(text: string): boolean {
  const words = text.toLocaleLowerCase("id-ID").replace(/-/g, " ").split(/\s+/);
  return words.some((word) => (INDONESIAN_MARKERS as readonly string[]).includes(word));
}
