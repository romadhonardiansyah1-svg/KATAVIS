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

const STYLE_DIRECTIONS: Record<ImageStyle, { readonly scene: string }> = {
  marble_light: {
    scene:
      "Permukaan marmer terang matte, latar putih gading polos, softbox besar " +
      "dari kiri 45 derajat, isian cahaya lembut dari kanan, dan bayangan " +
      "kontak alami tepat di bawah produk.",
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
      "Permukaan anyaman rotan alami sebagai alas, latar krem polos, " +
      "cahaya alami dari samping yang memperlihatkan tekstur produk tanpa " +
      "daun atau properti dekoratif lain.",
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
 * Prompt otomatis: ARAH KREATIF MURNI, bukan prompt final.
 *
 * Aturan pelestarian produk ("satu-satunya objek", "100% persis") TIDAK ada
 * di sini — ia ditambahkan Studio Agent karena hanya agen yang tahu foto
 * benar-benar terlampir. Menaruhnya di dua tempat menghasilkan prompt ganda
 * yang membingungkan model ("Edit foto ... Arah kreatif: Edit foto ...").
 */
export function buildAutoStudioPrompt(input: StudioPromptInput): string {
  return (
    `Foto katalog untuk produk berikut. Konteks dari cerita pengrajin: ${input.productLabel}. ` +
    `Foto sumber menentukan rupa produk; cerita hanya menjelaskan identitasnya, ` +
    `bukan izin menciptakan detail yang tidak terlihat. ` +
    `${styleDirection(input.style)} ` +
    `Bingkai seluruh produk dengan ruang cukup di tepinya. Fokus tajam pada ` +
    `tekstur dan sambungan buatan tangan, warna tetap setia pada foto sumber. ` +
    `Latar dan alas mendukung produk tanpa properti, tulisan, atau watermark.`
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
    `"latar bersih" yang generik) serta jenis permukaan dan pencahayaan yang ` +
    `konkret. Jangan menulis aturan pelestarian produk — aturan itu ` +
    `ditambahkan pengirim saat foto dilampirkan.`
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
