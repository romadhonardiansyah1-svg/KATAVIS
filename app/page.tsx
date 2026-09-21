"use client";

/**
 * Layar awal.
 *
 * Bukan salah satu dari enam langkah, tetapi alur ini butuh pintu masuk,
 * dan S5 menuntut satu hal darinya: draf yang belum selesai **ditawarkan
 * untuk dilanjutkan** saat aplikasi dibuka, bukan dibuang diam-diam.
 *
 * Tetap satu aksi utama. Ketika ada draf, aksinya melanjutkan; memulai
 * katalog baru tersedia sebagai aksi sekunder yang berbobot lebih ringan.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./create/flow.module.css";
import { clearDraft, readDraft } from "./create/draft-store";
import {
  EMPTY_DRAFT,
  draftHasWork,
  furthestAllowedStep,
  stepById,
  type Draft,
} from "./create/flow";
import { CameraIcon, ClockIcon, DocumentIcon, RefreshIcon } from "./create/icons";

export default function HomePage(): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    void readDraft().then((stored) => {
      setDraft(stored ?? EMPTY_DRAFT);
    });
  }, []);

  if (draft === null) {
    return (
      <main className={styles.page}>
        <p className={styles.loading} role="status">
          <ClockIcon />
          Memuat...
        </p>
      </main>
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
