"use client";

/**
 * Pemilih bahasa untuk narasi.
 *
 * Bahasanya disimpan di sini, bukan di halaman, supaya menggantinya
 * merakit ulang pemutarnya saja — pemilih bahasa tidak boleh memuat ulang
 * foto produk dan cerita yang sedang dibaca pembeli.
 *
 * Yang diminta bukan terjemahan mesin: `availableLocales` berisi daftar
 * bahasa yang naskahnya sudah ada di server, dan pemilih ini hanya
 * menanyakan versi mana yang dipakai.
 */

import { useState } from "react";

import type { PublicCatalog } from "./timeline";
import { TalkingCatalog } from "./TalkingCatalog";
import { fetchPublicCatalog } from "./api";

export interface CatalogNarrationProps {
  readonly slug: string;
  readonly initialCatalog: PublicCatalog;
  /**
   * Bahasa isi `initialCatalog`, apa adanya dari server (`data.locale`).
   *
   * Diberikan terpisah, bukan disimpulkan dari `availableLocales[0]`:
   * halaman dapat dibuka dengan `?locale=ja`, dan menyoroti pilihan
   * pertama akan menandai bahasa yang salah sebagai yang sedang terbuka —
   * pemilih bahasa yang berbohong tentang keadaannya sendiri.
   */
  readonly initialLocale: string;
}

const LOCALE_LABEL: Readonly<Record<string, string>> = {
  id: "Bahasa Indonesia",
  en: "Bahasa Inggris",
  ja: "Bahasa Jepang",
  zh: "Bahasa Mandarin",
  ar: "Bahasa Arab",
};

function labelOf(locale: string): string {
  return LOCALE_LABEL[locale] ?? locale.toUpperCase();
}

export function CatalogNarration({
  slug,
  initialCatalog,
  initialLocale,
}: CatalogNarrationProps): React.JSX.Element {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [locale, setLocale] = useState<string | null>(initialLocale);
  const [isSwitching, setIsSwitching] = useState(false);
  const [failedLocale, setFailedLocale] = useState<string | null>(null);

  async function switchLocale(next: string): Promise<void> {
    if (next === locale) return;

    setIsSwitching(true);
    setFailedLocale(null);

    // Versi bahasa diminta lewat parameter `locale` (kontrak API bagian 10).
    // Sebelum parameter itu ada, pemilih ini meminta versi bawaan titik akhir
    // dan menampilkan hasil yang sama untuk setiap pilihan — teksnya berubah
    // label, isinya tidak.
    //
    // Yang dijadikan penanda bukan `next` melainkan bahasa yang benar-benar
    // dijawab server (`data.locale`). Server berhak menjawab dengan bahasa
    // lain apabila yang diminta tidak ada di basis data; mempercayai `next`
    // akan menyoroti pilihan yang isinya tidak sedang tampil.
    const response = await fetchPublicCatalog(slug, next);

    setIsSwitching(false);

    if (!response.ok) {
      setFailedLocale(next);
      return;
    }

    setCatalog(response.data);
    setLocale(response.data.locale);
  }

  // Bahasa penanda pada pemutarnya juga mengikuti jawaban server, bukan
  // pilihan yang ditekan. Kalau tidak, suara perangkat dapat membaca naskah
  // Inggris dengan aturan pelafalan bahasa lain.

  return (
    <>
      {catalog.availableLocales.length > 1 ? (
        <section className="localePicker" aria-labelledby="locale-heading">
          <h2 className="localePicker__heading" id="locale-heading">
            Pilih bahasa cerita
          </h2>
          <ul className="localePicker__list">
            {catalog.availableLocales.map((available) => {
              const isCurrent = available === locale;
              return (
                <li key={available}>
                  <button
                    type="button"
                    className={
                      isCurrent ? "localePicker__option localePicker__option--current" : "localePicker__option"
                    }
                    // `aria-pressed`, bukan `aria-current`: ini tombol yang
                    // menyalakan/mematikan dirinya sendiri, bukan posisi
                    // pengguna di dalam sebuah alur navigasi. Pembaca layar
                    // menyebut "terpilih" untuk `aria-pressed`, sedangkan
                    // `aria-current` disebut "halaman saat ini" — bunyi yang
                    // salah untuk pemilih bahasa.
                    aria-pressed={isCurrent}
                    aria-busy={isSwitching && !isCurrent}
                    disabled={isSwitching}
                    lang={available}
                    onClick={() => {
                      void switchLocale(available);
                    }}
                  >
                    {labelOf(available)}
                  </button>
                </li>
              );
            })}
          </ul>
          {failedLocale === null ? null : (
            <p className="localePicker__error" role="status">
              Versi {labelOf(failedLocale)} belum dapat dimuat. Cerita yang sedang terbuka tidak
              berubah dan tetap utuh.
            </p>
          )}
        </section>
      ) : null}

      <TalkingCatalog
        // Berganti bahasa berarti naskah dan berkas suaranya berganti
        // sekaligus. Diberi kunci supaya keadaan pemutaran yang lama tidak
        // terbawa ke naskah yang baru — posisi 40 detik pada naskah
        // Indonesia tidak berarti apa pun pada naskah Inggris.
        key={locale ?? "id"}
        narration={catalog.narration}
        availableLocales={catalog.availableLocales}
        locale={catalog.locale}
        artisanName={catalog.artisan.displayName}
      />
    </>
  );
}
