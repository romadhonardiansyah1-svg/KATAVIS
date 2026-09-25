"use client";

/**
 * Layar awal.
 *
 * Bukan salah satu dari enam langkah, tetapi alur ini butuh pintu masuk,
 * dan S5 menuntut satu hal darinya: draf yang belum selesai **ditawarkan
 * untuk dilanjutkan** saat aplikasi dibuka, bukan dibuang diam-diam.
 *
 * Layar ini juga yang menjaga sesi. Sebelumnya pemeriksaan itu tidak ada di
 * mana pun, dan akibatnya setiap langkah gagal dengan `UNAUTHENTICATED`
 * pada permintaan pertamanya — tanpa satu pun cara memperoleh token, karena
 * layar masuknya belum ada. Sekarang yang terjadi adalah pengalihan ke
 * `/masuk`, dan itu satu-satunya tempat token dapat diperoleh.
 *
 * Tetap satu aksi utama. Ketika ada draf, aksinya melanjutkan; memulai
 * katalog baru tersedia sebagai aksi sekunder yang berbobot lebih ringan.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { readAccessToken } from "@/lib/session";

import styles from "./create/flow.module.css";
import { clearDraft, readDraft } from "./create/draft-store";
import {
  EMPTY_DRAFT,
  draftHasWork,
  furthestAllowedStep,
  stepById,
  type Draft,
} from "./create/flow";
import { CameraIcon, ClockIcon, DocumentIcon, KeyIcon, RefreshIcon } from "./create/icons";
import home from "./home.module.css";

/** Sesi diperiksa sekali, bukan pada setiap render. */
type Session = "memeriksa" | "ada" | "tidak-ada";

export default function HomePage(): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [session, setSession] = useState<Session>("memeriksa");

  useEffect(() => {
    // `localStorage` hanya ada di peramban, jadi pemeriksaan ini tidak dapat
    // dilakukan saat render di server.
    setSession(readAccessToken() === null ? "tidak-ada" : "ada");

    void readDraft().then((stored) => {
      setDraft(stored ?? EMPTY_DRAFT);
    });
  }, []);

  if (draft === null || session === "memeriksa") {
    return (
      <main className={styles.page}>
        <p className={styles.loading} role="status">
          <ClockIcon />
          Memuat...
        </p>
      </main>
    );
  }

  // Belum masuk. Layar ini menawarkan satu hal saja, dan itu bukan alur
  // enam langkah: tanpa token, langkah pertama akan gagal pada permintaan
  // pertamanya.
  if (session === "tidak-ada") {
    return (
      <div className={`${styles.page} ${home.page}`}>
        <header className={styles.header}>
          <p className={home.brand}>KATAVIS</p>
        </header>

        <main className={`${styles.main} ${home.content}`}>
          <div className={home.intro}>
            <h1 className={home.title}>Karya Anda, siap diceritakan kepada pembeli.</h1>
            <p className={home.lead}>
              Satu foto dan cerita singkat menjadi katalog yang bisa Anda periksa, lalu bagikan.
            </p>
          </div>
          <div className={home.actions}>
            <Link className={styles.primaryButton} href="/masuk">
              <KeyIcon />
              Masuk dengan nomor ponsel
            </Link>
          </div>
          <section className={home.journey} aria-labelledby="alur-judul">
            <h2 className={home.journeyTitle} id="alur-judul">Dari karya sampai tautan pembeli</h2>
            <ol className={home.journeyList}>
              <li className={home.journeyItem}>
                <span className={home.journeyNumber} aria-hidden="true">01</span>
                <div><p className={home.journeyName}>Foto karya</p><p className={home.journeyDescription}>Pilih foto asli produk. Foto itu tetap tersimpan saat versi studio dibuat.</p></div>
              </li>
              <li className={home.journeyItem}>
                <span className={home.journeyNumber} aria-hidden="true">02</span>
                <div><p className={home.journeyName}>Ceritakan</p><p className={home.journeyDescription}>Rekam suara atau tulis cerita. Anda selalu dapat memperbaiki transkripnya.</p></div>
              </li>
              <li className={home.journeyItem}>
                <span className={home.journeyNumber} aria-hidden="true">03</span>
                <div><p className={home.journeyName}>Periksa dan terbitkan</p><p className={home.journeyDescription}>Tinjau foto dan teks sebelum membagikan katalog kepada pembeli.</p></div>
              </li>
            </ol>
          </section>
        </main>
      </div>
    );
  }

  const resume = draftHasWork(draft);
  const target = stepById(furthestAllowedStep(draft));

  return (
    <div className={`${styles.page} ${home.page}`}>
      <header className={styles.header}>
        <p className={home.brand}>KATAVIS</p>
      </header>

      <main className={`${styles.main} ${home.content}`}>
        <div className={home.intro}>
          <h1 className={home.title}>{resume ? "Lanjutkan karya Anda." : "Mari buat katalog karya Anda."}</h1>
          <p className={home.lead}>Foto, cerita, dan hasilnya tetap dapat Anda periksa sebelum terbit.</p>
        </div>

        {resume ? (
          <p className={`${styles.statusRow} ${home.resume}`} role="status">
            <span className={styles.statusIconAccent}>
              <DocumentIcon size={20} />
            </span>
            Ada katalog yang belum selesai, tersimpan di perangkat ini.
          </p>
        ) : null}

        <div className={home.actions}>
          <Link className={styles.primaryButton} href={target.path}>
            {resume ? <DocumentIcon /> : <CameraIcon />}
            {resume ? `Lanjutkan dari langkah ${target.position}` : "Buat katalog baru"}
          </Link>

          {resume ? (
            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => {
                void clearDraft().then(() => {
                  setDraft(EMPTY_DRAFT);
                });
              }}
            >
              <RefreshIcon size={20} />
              Mulai katalog baru
            </button>
          ) : null}
        </div>

        <section className={home.journey} aria-labelledby="alur-judul">
          <h2 className={home.journeyTitle} id="alur-judul">Tiga bagian pekerjaan Anda</h2>
          <ol className={home.journeyList}>
            <li className={home.journeyItem}><span className={home.journeyNumber} aria-hidden="true">01</span><div><p className={home.journeyName}>Foto karya</p><p className={home.journeyDescription}>Pilih foto yang menunjukkan bentuk asli produk.</p></div></li>
            <li className={home.journeyItem}><span className={home.journeyNumber} aria-hidden="true">02</span><div><p className={home.journeyName}>Cerita</p><p className={home.journeyDescription}>Rekam suara atau tulis, lalu periksa transkrip.</p></div></li>
            <li className={home.journeyItem}><span className={home.journeyNumber} aria-hidden="true">03</span><div><p className={home.journeyName}>Katalog</p><p className={home.journeyDescription}>Periksa hasil dan terbitkan tautan pembeli.</p></div></li>
          </ol>
        </section>
      </main>
    </div>
  );
}
