/**
 * Feed CSV untuk Google Merchant Center.
 *
 * Kolomnya mengikuti format Google Merchant Center (F4-04), dan nama kolom
 * ditulis persis seperti yang dikenali Google — `image_link`, bukan
 * `imageLink`. Google membaca nama kolom, bukan urutannya, tetapi urutan
 * yang sama dengan spesifikasi membuat berkasnya dapat dibandingkan
 * berdampingan dengan contoh resmi.
 *
 * DUA KOLOM YANG DIWAJIBKAN GOOGLE TIDAK DAPAT DIISI, dan itu dilaporkan
 * alih-alih dikarang:
 *
 *   `price`        — tidak ada kolom harga di skema mana pun
 *                    (migrations/0001 dan 0002 tidak memuatnya), dan
 *                    kontrak API tidak punya bidang untuk mengisinya.
 *   `availability` — menuntut klaim stok. Sistem ini tidak melacak stok;
 *                    setiap karya dibuat tangan dan sering hanya satu buah.
 *                    Mengisi "in_stock" berarti mengarang fakta tentang
 *                    barang nyata yang akan ditanggung pengrajin.
 *
 * Keduanya ada di `MERCHANT_MISSING_COLUMNS` supaya pemanggil dapat
 * memutuskannya, dan supaya kekurangannya terlihat — bukan tersembunyi di
 * dalam berkas yang tampak lengkap.
 */

/**
 * Kolom yang diisi, berurutan.
 *
 * `brand` memuat nama pengrajin, dan itulah yang memenuhi F4-05 untuk feed
 * ini: setiap ekspor mencantumkan nama pengrajin.
 */
export const MERCHANT_COLUMNS = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "brand",
  "condition",
] as const;

/** Diwajibkan Google Merchant Center, tidak dapat diisi dari data yang ada. */
export const MERCHANT_MISSING_COLUMNS = ["price", "availability"] as const;

/**
 * Nilai `condition`.
 *
 * Karya yang baru dibuat memang baru. Ini bukan klaim yang dikarang seperti
 * `availability`: tidak ada karya lama yang masuk ke katalog ini, karena
 * pengrajin mendaftarkannya saat membuatnya.
 */
export const MERCHANT_CONDITION = "new";

export interface MerchantProduct {
  readonly id: string;
  readonly slug: string | null;
  readonly name: string | null;
  readonly story: string | null;
  /** Nama tampilan pengrajin. F4-05. */
  readonly artisanName: string;
  /** URL foto utama. Kosong bila produk belum punya foto utama. */
  readonly primaryPhotoUrl: string | null;
}

/**
 * Membungkus satu bidang menurut RFC 4180.
 *
 * Cerita produk hampir selalu memuat koma dan sering memuat baris baru —
 * tanpa pembungkusan, satu koma saja akan menggeser seluruh kolom sesudahnya
 * dan Google membaca harga sebagai nama.
 */
function field(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Alamat halaman publik produk. Rutenya dari kontrak API bagian 10. */
export function publicCatalogUrl(catalogBaseUrl: string, slug: string): string {
  return `${catalogBaseUrl.replace(/\/+$/, "")}/public/catalog/${slug}`;
}

/**
 * Menyusun feed. Satu baris judul, satu baris per produk.
 *
 * Produk tanpa slug atau tanpa foto utama tetap ditulis dengan bidang
 * kosong. Melewatinya akan menyembunyikan produk yang belum lengkap,
 * sementara bidang kosong membuat Google melaporkannya sebagai galat yang
 * dapat ditindaklanjuti pengrajin.
 */
export function buildMerchantFeed(
  products: readonly MerchantProduct[],
  catalogBaseUrl: string,
): string {
  const rows: string[] = [MERCHANT_COLUMNS.join(",")];

  for (const product of products) {
    rows.push(
      [
        field(product.id),
        field(product.name ?? ""),
        field(product.story ?? ""),
        field(
          product.slug === null ? "" : publicCatalogUrl(catalogBaseUrl, product.slug),
        ),
        field(product.primaryPhotoUrl ?? ""),
        field(product.artisanName),
        field(MERCHANT_CONDITION),
      ].join(","),
    );
  }

  // Baris baru di akhir berkas: POSIX menuntutnya, dan sebagian pengurai
  // mengabaikan baris terakhir tanpa itu.
  return `${rows.join("\n")}\n`;
}
