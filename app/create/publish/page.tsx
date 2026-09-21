"use client";

/**
 * Langkah 6 — "Katalog siap dilihat pembeli".
 *
 * Menerbitkan adalah satu-satunya tindakan dalam alur ini yang tidak dapat
 * dibatalkan, dan ia menuntut persetujuan eksplisit. Karena itu layarnya
 * memuat satu kotak centang berlabel yang harus dicentang pengrajin lebih
 * dulu, lalu satu tombol utama.
 *
 * Persetujuannya dikirim ke `POST /consent` sebelum `POST
 * /products/:id/publish`. Server menolak penerbitan tanpa persetujuan itu
 * (`CONSENT_REQUIRED`), jadi kotak centang ini bukan satu-satunya
 * penjaganya — ia hanya membuat pengrajin menyatakan pilihannya dengan
 * sadar.
 */

import { useState } from "react";

import { ERROR_CATALOG, type ErrorCode } from "@/lib/errors";
import { announce, notify } from "@/lib/notify";

import { StepLoading, StepShell, type StepError } from "../StepShell";
import { publishProduct, publicCatalogUrl, setConsent } from "../api";
import styles from "../flow.module.css";
import { CheckIcon, LinkIcon } from "../icons";
import { readAccessToken } from "@/lib/session";
import { useCreateFlow } from "../useDraft";

function messageOf(code: ErrorCode): StepError {
  const entry = ERROR_CATALOG[code];
  return { message: entry.message, action: entry.action };
}

export default function PublishPage(): React.JSX.Element {
  const { draft, savedAt, isSaving, update, goTo } = useCreateFlow("publish");
  const [consentGiven, setConsentGiven] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<StepError | null>(null);
  const [slug, setSlug] = useState<string | null>(draft?.slug ?? null);

  if (draft === null) return <StepLoading />;

  const productId = draft.productId;
  const published = draft.publishedAt !== null && slug !== null;

  /** Menampilkan galat sekaligus membunyikan kanal gagal (S10, tabel). */
  function fail(next: StepError): void {
    setError(next);
    notify("error");
  }

  async function publish(): Promise<void> {
    const token = readAccessToken();
    if (token === null || productId === null) {
      fail(messageOf("UNAUTHENTICATED"));
      return;
    }

    setIsBusy(true);

    const consented = await setConsent(token, "publication", true);
    if (!consented.ok) {
      setIsBusy(false);
      fail({ message: consented.error.message, action: consented.error.action });
      return;
    }

    const result = await publishProduct(token, productId);
    setIsBusy(false);

    if (!result.ok) {
      fail({ message: result.error.message, action: result.error.action });
      return;
    }

    setSlug(result.data.slug ?? null);
    update({ publishedAt: Date.now(), slug: result.data.slug ?? null });

    /*
      Peristiwa "Katalog selesai" (tabel S10) — momen penutup demo.
      Kanal audionya **kalimat**, bukan nada: nada tidak memberi tahu
      pengrajin tunanetra bahwa katalognya terbit.
    */
    notify("catalog-done");
    announce("Katalog Anda sudah selesai");
  }

  return (
    <StepShell
      step="publish"
      savedAt={savedAt}
      isSaving={isSaving}
      error={error}
      backTo="review"
      primary={
        published && slug !== null
          ? {
              label: "Buka katalog pembeli",
              icon: <LinkIcon />,
              onClick: () => {
                window.open(publicCatalogUrl(slug), "_blank", "noopener");
              },
            }
          : {
              label: "Terbitkan katalog",
              icon: <CheckIcon />,
              onClick: publish,
              disabled: !consentGiven || productId === null,
              busy: isBusy,
              busyLabel: "Menerbitkan katalog...",
            }
      }
    >
      {published ? (
        <>
          <p className={styles.statusRow} role="status">
            <span className={styles.statusIconSuccess}>
              <CheckIcon size={20} />
            </span>
            Katalog Anda sudah terbit dan dapat dilihat pembeli.
          </p>
          <p className={styles.hint}>
            Alamat katalog Anda: {slug === null ? "-" : publicCatalogUrl(slug)}
          </p>
        </>
      ) : (
        <>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Yang akan diterbitkan</h2>
            <p>
              Nama produk, cerita, spesifikasi, dan foto studio Anda akan tampil di halaman
              katalog publik. Nomor telepon dan data pribadi Anda tidak pernah ikut ditampilkan.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="consent">
              <input
                id="consent"
                type="checkbox"
                checked={consentGiven}
                onChange={(event) => {
                  setConsentGiven(event.target.checked);
                }}
                style={{ inlineSize: "var(--touch-min)", blockSize: "var(--touch-min)" }}
              />
              Saya setuju katalog ini dilihat pembeli
            </label>
            <p className={styles.hint}>
              Selama kotak ini belum dicentang, katalog Anda tetap tersimpan sebagai draf dan
              tidak dapat dilihat siapa pun.
            </p>
          </div>
        </>
      )}

      {published ? null : (
        <button
          type="button"
          className={styles.secondaryLink}
          onClick={() => {
            void goTo("review");
          }}
        >
          Periksa lagi hasil katalognya
        </button>
      )}
    </StepShell>
  );
}
