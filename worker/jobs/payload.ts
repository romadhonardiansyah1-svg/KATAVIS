/**
 * Muatan pekerjaan: bentuk yang disimpan di kolom `jobs.payload`.
 *
 * Kolom itu `TEXT`, dan itu satu-satunya longgarnya. Yang menyimpannya ada
 * dua pihak — `catalog` saat menjadwalkan pekerjaan, dan konsumen antrian
 * saat meneruskan pekerjaan ke penyedia cadangan — jadi bentuknya
 * didefinisikan sekali di sini, bukan disusun ulang di dua tempat.
 *
 * Pembacaannya sengaja permisif: muatan yang tidak terbaca menghasilkan
 * `null`, bukan galat. Pekerjaan yang muatannya rusak tetap harus dapat
 * diselesaikan atau ditandai gagal dengan pesan yang benar — menghentikan
 * konsumen antrian karena satu baris lama akan membekukan seluruh demo.
 */

export interface ImageJobPayload {
  readonly prompt: string;
  /** Ditulis oleh `catalog` saat menjadwalkan; dipakai untuk gaya gambar. */
  readonly style?: string;
  /**
   * Ditulis `d1ReturnJobToQueue` saat Studio Agent melaporkan kegagalan.
   * Hanya untuk log — tidak pernah menjadi pesan ke pengrajin.
   */
  readonly geminiFailure?: string;
  readonly failedAt?: number;
}

/**
 * Membaca muatan pekerjaan gambar.
 *
 * Prompt yang hilang menghasilkan string kosong, bukan `null` untuk seluruh
 * muatan: seluruh sisa payload tetap berguna, dan penyedia yang menerima
 * prompt kosong akan gagal dengan sendirinya bila memang tidak ada yang
 * dapat dikerjakan.
 */
export function parseImagePayload(raw: string | null): ImageJobPayload {
  if (raw === null) return { prompt: "" };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    // Muatan bukan JSON. Prompt kosong lebih benar daripada menebak.
    return { prompt: "" };
  }

  if (typeof decoded !== "object" || decoded === null) return { prompt: "" };

  const candidate = decoded as Record<string, unknown>;

  return {
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : "",
    ...(typeof candidate.style === "string" ? { style: candidate.style } : {}),
    ...(typeof candidate.geminiFailure === "string"
      ? { geminiFailure: candidate.geminiFailure }
      : {}),
    ...(typeof candidate.failedAt === "number" ? { failedAt: candidate.failedAt } : {}),
  };
}

/**
 * Prompt gambar wajib.
 *
 * Kalimat penegak F2-05 ("JANGAN mengubah bentuk, warna, tekstur, atau
 * proporsi produk") adalah bagian dari prompt ini, dan menyusunnya di dua
 * tempat berarti dua tempat yang dapat berbeda pendapat. Karena itu kalimat
 * itu tinggal di sini, satu kali, dan konsumen antrian tidak pernah
 * menambahkannya lagi.
 */
export function buildImagePrompt(productName: string, style: string, locale: string): string {
  const styleClause =
    style === "studio"
      ? "latar putih bersih dengan pencahayaan studio yang lembut"
      : style === "outdoor"
        ? "latar luar ruang dengan cahaya alami pagi"
        : "latar kain polos dengan cahaya lembut";

  return [
    `Buat foto produk komersial dari foto ini: ${productName}.`,
    `Gaya: ${styleClause}.`,
    "JANGAN mengubah bentuk, warna, tekstur, atau proporsi produk.",
    "Pertahankan seluruh detail kerajinan tangan apa adanya.",
    locale === "id" ? "" : "Keep the product exactly as it appears in the source photo.",
  ]
    .filter((line) => line.length > 0)
    .join(" ");
}
