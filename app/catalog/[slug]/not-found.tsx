/**
 * Katalog tidak ditemukan.
 *
 * Produk draf dan produk yang tidak ada sama-sama sampai ke sini, dan itu
 * disengaja: kontrak API bagian 10 menyatakan draf mengembalikan 404, bukan
 * 403, karena 403 membocorkan keberadaan produk.
 *
 * Pesannya menyebut satu hal saja — halaman tidak ditemukan — dan satu
 * langkah berikutnya. Tidak ada istilah teknis, sesuai `FORBIDDEN_MESSAGE_TERMS`
 * di `lib/errors.ts`: kode galat hidup di log, bukan di layar.
 */

import Link from "next/link";

import "@/components/catalog/catalog.css";

export default function CatalogNotFound(): React.JSX.Element {
  return (
    <main className="notice">
      <h1 className="notice__title">Halaman tidak ditemukan.</h1>
      <p className="notice__body">
        Alamat ini mungkin sudah berubah, atau katalognya belum diterbitkan oleh pengrajinnya.
      </p>
      <p className="notice__body">
        <Link className="notice__action" href="/">
          Buka halaman utama
        </Link>
      </p>
    </main>
  );
}
