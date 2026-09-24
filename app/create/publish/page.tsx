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

import { useEffect, useState } from "react";

import { ERROR_CATALOG, type ErrorCode } from "@/lib/errors";
import { announce, notify } from "@/lib/notify";

import { StepLoading, StepShell, type StepError } from "../StepShell";
import { getProduct, publishProduct, publicCatalogUrl, setConsent } from "../api";
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
  const [studioUrl, setStudioUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [story, setStory] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadResult();
  }, []);

  if (draft === null) return <StepLoading />;

  const productId = draft.productId;
  const published = draft.publishedAt !== null && slug !== null;

  async function loadResult(): Promise<void> {
    // Paket siap posting (foto + teks) diambil sekali saat layar dibuka.
    // Tanpa ini, layar akhir hanya berisi tautan — padahal tujuan produk
    // adalah katalog yang diunduh dan disalin untuk diposting manual.
    if (productId === null) return;
    const token = readAccessToken();
    if (token === null) return;

    const result = await getProduct(token, productId);
    if (!result.ok) return;

    const photo =
      result.data.media.find((item) => item.kind === "photo_studio" && item.isPrimary) ??
      result.data.media.find((item) => item.kind === "photo_studio") ??
      result.data.media.find((item) => item.kind === "photo_original");
    setStudioUrl(photo?.url ?? null);
    setCaption(result.data.content["id"]?.socialCopy ?? null);
    setStory(result.data.content["id"]?.story ?? null);
  }

  async function downloadPhoto(): Promise<void> {
    if (studioUrl === null) return;
    setNotice(null);

    try {
      const response = await fetch(studioUrl);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${slug ?? "katalog-katavis"}.jpg`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      setNotice("Foto terunduh. Siap diposting.");
    } catch {
      // Unduhan langsung gagal (misal CORS): buka di tab baru agar
      // pengrajin tetap bisa menyimpan manual.
      window.open(studioUrl, "_blank", "noopener");
      setNotice("Foto dibuka di tab baru. Simpan manual dari sana.");
    }
  }

  async function copyText(text: string | null, label: string): Promise<void> {
    if (text === null || text.length === 0) {
      setNotice(`${label} belum tersedia.`);
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setNotice(`${label} disalin. Siap ditempel di postingan.`);
  }

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

          <div className={styles.field}>
            <p className={styles.label}>Paket siap posting</p>
            <p className={styles.hint}>
              Unduh fotonya dan salin teksnya, lalu posting manual di
              marketplace atau media sosial Anda.
            </p>
            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => {
                void downloadPhoto();
              }}
              disabled={studioUrl === null}
            >
              Unduh foto studio
            </button>
            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => {
                void copyText(caption, "Caption");
              }}
              disabled={caption === null}
            >
              Salin caption
            </button>
            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => {
                void copyText(story, "Cerita produk");
              }}
              disabled={story === null}
            >
              Salin cerita produk
            </button>
            {notice === null ? null : (
              <p className={styles.statusRow} role="status">
                {notice}
              </p>
            )}
          </div>
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
