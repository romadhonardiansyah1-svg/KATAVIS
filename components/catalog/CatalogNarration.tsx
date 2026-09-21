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
}: CatalogNarrationProps): React.JSX.Element {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [locale, setLocale] = useState<string | null>(initialCatalog.availableLocales[0] ?? null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [failedLocale, setFailedLocale] = useState<string | null>(null);

  async function switchLocale(next: string): Promise<void> {
    if (next === locale) return;

    setIsSwitching(true);
    setFailedLocale(null);

    // Seluruh versi bahasa datang dari endpoint yang sama. Kunci bahasanya
    // tidak dikirim sebagai kueri di kontrak API bagian 10, jadi yang
    // diterima adalah versi bawaan titik akhir; `availableLocales` tetap
    // ditampilkan supaya pembeli tahu versi mana yang ada, dan supaya
    // ketiadaannya terlihat sebagai kekurangan data, bukan sebagai tombol
    // yang diam.
    const response = await fetchPublicCatalog(slug);

    setIsSwitching(false);

    if (!response.ok) {
      setFailedLocale(next);
      return;
    }

    setCatalog(response.data);
    setLocale(next);
  }

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
                    aria-current={isCurrent ? "true" : undefined}
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
        artisanName={catalog.artisan.displayName}
      />
    </>
  );
}
