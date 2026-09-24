/**
 * Prompt foto studio: otomatis per produk, template gaya, dan penajaman AI.
 *
 * Masalah yang diselesaikan berkas ini: prompt generik yang sama untuk semua
 * produk menghasilkan foto yang sama untuk semua produk. Tiga mekanisme
 * mencegahnya, dari yang paling otomatis sampai yang paling bebas:
 *
 *   1. Otomatis — prompt disusun dari transkrip dan nama produk, jadi dua
 *      produk yang berbeda tidak pernah mendapat prompt yang sama persis.
 *   2. Template gaya — lima latar studio yang komposisinya benar-benar
 *      berbeda, bukan lima nama untuk satu prompt yang sama.
 *   3. Manual + penajaman — pengrajin menulis keinginannya dengan kata
 *      sendiri, AI mempertajamnya menjadi prompt studio yang lengkap.
 *
 * Batas yang dijaga: prompt final maksimal 2000 karakter (kontrak API
 * bagian 7), dan selalu memuat aturan produk-tunggal agar model tidak
 * menambahkan objek lain.
 */

import type { ImageStyle } from "../../lib/schemas";

export interface StudioPromptInput {
  /** Nama produk bila sudah ada, jika tidak memakai transkrip. */
  readonly productLabel: string;
  /** Gaya latar yang dipilih pengrajin. */
  readonly style: ImageStyle;
}

const PRODUCT_RULES =
  "Produk utama adalah SATU-SATUNYA objek di foto hasil. " +
  "Hapus semua objek lain, tangan, kemasan berlebih, atau gangguan di sekitar produk. " +
  "Pertahankan produk 100% persis seperti di foto lampiran: bentuk, warna, " +
  "tekstur bahan, ukuran relatif, dan seluruh detailnya. " +
  "Tanpa teks, tanpa watermark, tanpa objek tambahan.";

const STYLE_DIRECTIONS: Record<ImageStyle, { readonly scene: string }> = {
  marble_light: {
    scene:
      "Produk difoto dari sudut tiga-perempat di atas meja marmer putih bersih, " +
      "pencahayaan studio softbox profesional dari kiri atas, bayangan kontak " +
      "yang halus dan natural, latar gradient abu-abu muda ke putih dengan " +
      "sedikit kesan ruang agar tidak datar.",
  },
  wood_warm: {
    scene:
      "Produk difoto dekat di atas meja kayu hangat dengan serat alami yang " +
      "terlihat, cahaya pagi yang hangat dari samping kiri, bayangan lembut " +
      "yang panjang dan natural, latar kain linen krem yang blur halus.",
  },
  dark_gradient: {
    scene:
      "Produk difoto dramatis dengan pencahayaan rim-light dari belakang " +
      "kanan dan fill lembut dari depan kiri, latar gradient gelap arang ke " +
      "hitam yang mewah, pantulan samar di permukaan meja gelap yang mengilap.",
  },
  rattan_natural: {
    scene:
      "Produk difoto di atas anyaman rotan alami dengan daun hijau yang blur " +
      "lembut di latar, cahaya alami siang yang cerah dan segar, kesan " +
      "kerajinan tangan Nusantara yang hangat dan hidup.",
  },
  clay_minimal: {
    scene:
      "Produk difoto minimalis di atas podium tanah liat terakota dengan " +
      "latar dinding kapur putih gading yang bersih, satu bayangan tegas " +
      "yang artistik, komposisi lapang dengan banyak ruang kosong di sekitar produk.",
  },
};

/** Label gaya untuk dipilih pengrajin di Langkah 1. */
export const IMAGE_STYLE_LABELS: Record<ImageStyle, string> = {
  marble_light: "Marmer Terang",
  wood_warm: "Kayu Hangat",
  dark_gradient: "Latar Gelap",
  rattan_natural: "Rotan Alami",
  clay_minimal: "Minimalis Tanah Liat",
};

export function styleDirection(style: ImageStyle): string {
  return STYLE_DIRECTIONS[style].scene;
}

/**
 * Prompt otomatis: berbeda untuk setiap produk karena memuat label produk
 * dan gaya yang dipilih. Dua produk tidak pernah mendapat prompt yang sama
 * persis kecuali transkrip dan gayanya sama persis.
 */
export function buildAutoStudioPrompt(input: StudioPromptInput): string {
  return (
    `Edit foto produk yang saya lampirkan menjadi foto katalog komersial studio ` +
    `yang menarik dan estetik untuk ${input.productLabel}. ` +
    `${styleDirection(input.style)} ` +
    `Gaya fotografi katalog pameran seni kriya internasional: tajam, hidup, dan menjual. ` +
    PRODUCT_RULES
  );
}

/**
 * Instruksi untuk AI penajam: mengubah keinginan bebas pengrajin menjadi
 * prompt studio yang lengkap, dengan konteks produk yang sedang dikerjakan.
 *
 * Keluaran yang diminta adalah TEKS PROMPT FINAL, bukan JSON — karena
 * hasilnya langsung dipakai sebagai prompt gambar, bukan sebagai konten
 * katalog.
 */
export function buildSharpenInstruction(
  manual: string,
  productLabel: string,
  style: ImageStyle,
): string {
  return (
    `Ubah keinginan pengguna berikut menjadi satu prompt foto studio produk ` +
    `yang detail, spesifik, dan siap dipakai untuk mengedit foto produk. ` +
    `Tulis dalam Bahasa Indonesia, 120-220 kata, tanpa pembuka dan penutup — ` +
    `langsung isi promptnya saja.\n\n` +
    `Keinginan pengguna: "${manual}"\n` +
    `Produk: ${productLabel}\n` +
    `Arah gaya dasar: ${styleDirection(style)}\n\n` +
    `Prompt wajib memuat: deskripsi penataan produk yang spesifik (bukan ` +
    `"latar bersih" yang generik), jenis permukaan dan pencahayaan yang ` +
    `konkret, dan aturan bahwa produk adalah satu-satunya objek dan harus ` +
    `dipertahankan 100% persis.`
  );
}

/**
 * Membersihkan keluaran AI penajam menjadi prompt yang dapat dipakai.
 *
 * Model kadang membungkus jawabannya dengan kalimat pembuka ("Berikut
 * promptnya:") atau pagar kode. Keduanya dibuang; yang diambil hanya isi
 * sepanjang 20-2000 karakter. Di luar itu, hasilnya ditolak dan pemanggil
 * memakai prompt otomatis sebagai cadangan.
 */
export function cleanSharpenedPrompt(raw: string): string | null {
  const cleaned = raw
    .replace(/^\s*```(?:\w+)?/i, "")
    .replace(/```\s*$/i, "")
    .replace(/^(berikut|ini dia|hasil)[^:\n]*:\s*/i, "")
    .trim();

  if (cleaned.length < 20 || cleaned.length > 2000) return null;
  return cleaned;
}
