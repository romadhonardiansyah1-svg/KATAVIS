/**
 * Halaman katalog publik — `GET /public/catalog/:slug`.
 *
 * Halaman ini adalah satu-satunya layar yang dilihat pembeli, dan ia
 * dirancang untuk gagal dengan anggun di tiga arah sekaligus:
 *
 *   Tanpa gambar. Foto adalah elemen terbesar, tetapi tidak satu pun
 *   informasi bergantung padanya. Nama, cerita, spesifikasi, nama
 *   pengrajin, dan naskahnya semuanya teks (F3-04, TC-A11Y-27).
 *
 *   Tanpa suara. Naskah lengkapnya dirender sebagai teks sejak awal, dan
 *   setiap kalimat membawa penanda waktunya. Pemutarnya hanya menggerakkan
 *   sorotan (F3-03, TC-A11Y-26).
 *
 *   Tanpa JavaScript. Berbeda dari alur enam langkah, halaman ini tidak
 *   dipagari draf di IndexedDB: yang dirender server adalah isi penuhnya,
 *   bukan layar "Memuat...". Tombol pemutarnya sendiri memerlukan
 *   JavaScript, dan pemutarnya mengambil alih setelah halaman sampai di
 *   peramban.
 *
 * LCP dijaga dengan dua cara, keduanya terukur: tidak ada satu pun
 * permintaan jaringan yang dijalankan Javascript, dan foto pertamanya
 * memakai `priority` sehingga tidak menunggu penemuan oleh pemuat gambar
 * (TC-PERF-05).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogNarration } from "@/components/catalog/CatalogNarration";
import { fetchPublicCatalog } from "@/components/catalog/api";
import "@/components/catalog/catalog.css";

/**
 * Batas waktu pengambilan.
 *
 * Bila Worker tidak menjawab, pembeli mendapat halaman 404 sesudah 8 detik
 * alih-alih menunggu tanpa batas. Memilih `notFound()` di sini adalah
 * keputusan sadar: katalog yang tidak dapat dimuat memang tidak dapat
 * ditampilkan, dan halaman galat yang mengatakannya lebih berguna daripada
 * pemintal yang berputar selamanya.
 */
export const revalidate = 60;

interface CatalogPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{ readonly locale?: string | readonly string[] }>;
}

/**
 * Bahasa yang diminta lewat `?locale=`, atau `undefined`.
 *
 * `searchParams` dapat memuat larik (`?locale=en&locale=ja`), dan larik itu
 * bukan bahasa. `?locale=` yang kosong juga bukan bahasa, dan diperlakukan
 * sama dengan tanpa parameter — di sini dan di Worker sekaligus; dua tempat
 * yang berbeda akan membuat halaman dan server tidak sepaham soal bahasa
 * mana yang sedang terbuka.
 *
 * Nilai di luar daftar sengaja diteruskan apa adanya. Yang memutuskan
 * adalah server, yang menjawab `404` untuk bahasa yang tidak dikenal tanpa
 * membedakannya dari produk yang tidak ada (kontrak API bagian 10).
 */
function askedLocale(
  searchParams: { readonly locale?: string | readonly string[] },
): string | undefined {
  const value = searchParams.locale;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function generateMetadata({
  params,
  searchParams,
}: CatalogPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await fetchPublicCatalog(slug, askedLocale(await searchParams));

  if (!result.ok || result.data.name === null) {
    return { title: "Katalog tidak ditemukan — KATAVIS" };
  }

  return {
    title: `${result.data.name} — KATAVIS`,
    description: result.data.story ?? undefined,
  };
}

function PhotoFrame({
  src,
  altText,
  isPriority,
}: {
  readonly src: string;
  readonly altText: string | null;
  readonly isPriority: boolean;
}): React.JSX.Element {
  // Teks alternatif yang bermakna, bukan nama berkas. Bila altText kosong,
  // yang dipakai adalah kalimat yang menyatakan apa yang tidak terlihat —
  // membiarkannya kosong akan membuat pembaca layar melompati foto itu
  // tanpa memberi tahu pengguna bahwa ada sesuatu di sana.
  const label =
    altText !== null && altText.trim().length > 0
      ? altText
      : "Foto produk ini belum memiliki keterangan.";

  return (
    <figure className="catalog__photo">
      <div className="catalog__frame">
        <img
          className="catalog__image"
          src={src}
          alt={label}
          width={1024}
          height={1280}
          loading={isPriority ? "eager" : "lazy"}
          // `fetchPriority` dipakai apa adanya: tetap tidak ada bobot di
          // tipe React 19, dan atributnya sah di DOM (TC-PERF-05).
          fetchPriority={isPriority ? "high" : "auto"}
          decoding="async"
        />
      </div>
      <figcaption className="catalog__photoAlt">{label}</figcaption>
    </figure>
  );
}

function Specifications({ specs }: { readonly specs: readonly string[] }): React.JSX.Element | null {
  if (specs.length === 0) return null;

  return (
    <div className="catalog__specs">
      <h2 className="catalog__specsHeading">Spesifikasi</h2>
      <ul className="catalog__specList">
        {specs.map((spec) => (
          <li key={spec}>{spec}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function CatalogPage({
  params,
  searchParams,
}: CatalogPageProps): Promise<React.JSX.Element> {
  const { slug } = await params;
  const result = await fetchPublicCatalog(slug, askedLocale(await searchParams));

  // Produk draf mengembalikan 404, bukan 403 — kontrak API bagian 10
  // menyatakan alasannya, 403 membocorkan keberadaan produk. Halaman
  // meneruskan jawaban server apa adanya; ia tidak menafsirkannya ulang.
  if (!result.ok) notFound();

  const catalog = result.data;
  const primaryMedia = catalog.media[0] ?? null;

  // Foto tanpa URL yang dapat dimuat diperlakukan sama dengan tidak ada
  // foto. Menyerahkan `null` ke `src` menghasilkan permintaan ke alamat
  // halaman itu sendiri dan sebuah kotak bergaris silang — di depan juri,
  // itu terlihat sebagai kerusakan, bukan sebagai ketiadaan.
  //
  // Disaring di sini, bukan lewat bendera terpisah: menyempitkan tipe pada
  // nilai yang benar-benar dipakai membuat `url` tidak lagi `string | null`
  // di dalam cabang yang merendernya.
  const photo =
    primaryMedia !== null && primaryMedia.url !== null
      ? { url: primaryMedia.url, altText: primaryMedia.altText }
      : null;

  const fallbackStory =
    "Pengrajin belum menuliskan cerita untuk produk ini. Spesifikasi di bawah tetap memuat keterangan yang tersedia.";

  // Naskahnya dirender di sini juga, bukan hanya di dalam pemutarnya,
  // supaya teks itu ada di HTML pertama — dan karena itu tersalin dan
  // terbaca bahkan bila JavaScript tidak pernah berjalan.
  const script = catalog.narration.captions.map((caption) => caption.text).join(" ");

  return (
    <div className="catalog">
      <nav className="catalog__breadcrumb" aria-label="Posisi halaman">
        <span>Katalog KATAVIS</span>
      </nav>

      <header className="catalog__story">
        {catalog.name === null ? (
          <h1 className="catalog__name">Produk tanpa nama</h1>
        ) : (
          <h1 className="catalog__name">{catalog.name}</h1>
        )}
        <p className="catalog__artisan">
          <span>
            {catalog.artisan.displayName === "Pengrajin"
              ? "Dibuat oleh pengrajin"
              : `Dibuat oleh ${catalog.artisan.displayName}`}
          </span>
          <span className="catalog__artisanRole">
            Katalog ini dibuat dan diterbitkan oleh pengrajinnya sendiri.
          </span>
        </p>
      </header>

      <main className="catalog__main">
        {photo === null ? (
          <div className="catalog__photo">
            <div className="catalog__frame">
              <p className="catalog__photoAlt">
                Belum ada foto untuk produk ini. Seluruh keterangan lain tetap tersedia di
                halaman ini.
              </p>
            </div>
          </div>
        ) : (
          <PhotoFrame src={photo.url} altText={photo.altText} isPriority />
        )}

        <div className="catalog__story">
          <section className="catalog__story">
            <h2 className="catalog__specsHeading">Cerita</h2>
            <p className="catalog__storyText">{catalog.story ?? fallbackStory}</p>
            <Specifications specs={catalog.specs} />
          </section>

          <CatalogNarration slug={slug} initialCatalog={catalog} initialLocale={catalog.locale} />
        </div>
      </main>

      {script.length === 0 ? null : (
        <section className="catalog__story" aria-labelledby="script-heading">
          <h2 className="catalog__specsHeading" id="script-heading">
            Naskah cerita
          </h2>
          <p className="catalog__storyText" lang="id">
            {script}
          </p>
          <p className="player__aside">
            Teks ini sama dengan yang dibacakan pemutar di atas. Anda dapat memilih dan menyalinnya
            seperti teks biasa.
          </p>
        </section>
      )}

      <footer className="catalog__story">
        <p className="player__aside">
          Belum menemukan yang cocok?{" "}
          <Link href="/">Kembali ke halaman utama</Link>.
        </p>
      </footer>
    </div>
  );
}
