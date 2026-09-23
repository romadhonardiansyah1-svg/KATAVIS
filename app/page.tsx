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
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>KATAVIS</h1>
        </header>

        <main className={styles.main}>
          <p className={styles.hint}>
            Ubah foto produk dan cerita suara Anda menjadi katalog siap jual. Enam langkah, tanpa
            perlu mengetik.
          </p>
          <p className={styles.hint}>
            Masuk dulu dengan nomor ponsel. Tidak perlu kata sandi.
          </p>
        </main>

        <footer className={styles.footer}>
          <Link className={styles.primaryButton} href="/masuk">
            <KeyIcon />
            Masuk
          </Link>
        </footer>
      </div>
    );
  }

  const resume = draftHasWork(draft);
  const target = stepById(furthestAllowedStep(draft));

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>KATAVIS</h1>
      </header>

      <main className={styles.main}>
        <p className={styles.hint}>
          Ubah foto produk dan cerita suara Anda menjadi katalog siap jual. Enam langkah, tanpa
          perlu mengetik.
        </p>

        {resume ? (
          <p className={styles.statusRow} role="status">
            <span className={styles.statusIconAccent}>
              <DocumentIcon size={20} />
            </span>
            Ada katalog yang belum selesai, tersimpan di perangkat ini.
          </p>
        ) : null}
      </main>

      <footer className={styles.footer}>
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
      </footer>
    </div>
  );
}
