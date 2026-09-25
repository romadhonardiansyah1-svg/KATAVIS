"use client";

/**
 * Langkah 5 — "Apakah katalog sudah sesuai?".
 *
 * Hasil pemrosesan ditampilkan apa adanya dan dapat disunting sebelum
 * terbit (F1-06). Setiap perubahan dikirim ke `PATCH
 * /products/:id/content/:locale`, dan server menandai sumbernya
 * `ai_edited` — jejak bahwa teks ini pernah disentuh manusia, bukan
 * keluaran mesin yang belum dibaca siapa pun.
 *
 * Bahasa sumber diperiksa manusia; terjemahan boleh menyusul. Karena itu
 * layar ini menampilkan bahasa `id` lebih dulu dan menyebut bahasa lain
 * hanya sebagai daftar.
 */

import { useEffect, useRef, useState } from "react";

import { ERROR_CATALOG, type ErrorCode } from "@/lib/errors";

import { StepLoading, StepShell, type StepError } from "../StepShell";
import { getProduct, patchContent, submitForReview, type ProductContent } from "../api";
import styles from "../flow.module.css";
import { CheckIcon, ClockIcon, DocumentIcon } from "../icons";
import { readAccessToken } from "@/lib/session";
import { useCreateFlow } from "../useDraft";

const SOURCE_LOCALE = "id";

function messageOf(code: ErrorCode): StepError {
  const entry = ERROR_CATALOG[code];
  return { message: entry.message, action: entry.action };
}

interface EditableContent {
  readonly name: string;
  readonly story: string;
  readonly specs: string;
}

function toEditable(content: ProductContent | undefined): EditableContent {
  return {
    name: content?.name ?? "",
    story: content?.story ?? "",
    specs: (content?.specs ?? []).join("\n"),
  };
}

export default function ReviewPage(): React.JSX.Element {
  const { draft, savedAt, isSaving, update, goTo } = useCreateFlow("review");
  const [content, setContent] = useState<EditableContent | null>(null);
  const [otherLocales, setOtherLocales] = useState<readonly string[]>([]);
  const [productStatus, setProductStatus] = useState<string | null>(null);
  const [photoOriginal, setPhotoOriginal] = useState<string | null>(null);
  const [photoStudio, setPhotoStudio] = useState<string | null>(null);
  const [socialCopy, setSocialCopy] = useState<string | null>(null);
  const [seoKeywords, setSeoKeywords] = useState<readonly string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<StepError | null>(null);
  const loadedRef = useRef(false);

  const productId = draft?.productId ?? null;

  useEffect(() => {
    if (productId === null || loadedRef.current) return;
    loadedRef.current = true;

    void (async () => {
      const token = readAccessToken();
      if (token === null) {
        setError(messageOf("UNAUTHENTICATED"));
        return;
      }

      const result = await getProduct(token, productId);
      if (!result.ok) {
        setError({ message: result.error.message, action: result.error.action });
        return;
      }

      setContent(toEditable(result.data.content[SOURCE_LOCALE]));
      setProductStatus(result.data.status);
      setOtherLocales(
        Object.keys(result.data.content).filter((locale) => locale !== SOURCE_LOCALE),
      );
      const source = result.data.content[SOURCE_LOCALE];
      setSocialCopy(source?.socialCopy ?? null);
      setSeoKeywords(source?.seoKeywords ?? []);
      const original = result.data.media.find((item) => item.kind === "photo_original");
      const studio =
        result.data.media.find((item) => item.kind === "photo_studio" && item.isPrimary) ??
        result.data.media.find((item) => item.kind === "photo_studio");
      setPhotoOriginal(original?.url ?? null);
      setPhotoStudio(studio?.url ?? null);
    })();
  }, [productId]);

  if (draft === null) return <StepLoading />;

  const ready = content !== null;  async function confirm(): Promise<void> {
    const token = readAccessToken();
    if (token === null || productId === null || content === null) {
      setError(messageOf("UNAUTHENTICATED"));
      return;
    }

    setIsBusy(true);

    // Hanya dikirim bila memang ada yang berubah: penyuntingan kosong tetap
    // akan menaikkan `updated_at` dan mengubah `source` di server.
    const changed =
      content.name.length > 0 || content.story.length > 0 || content.specs.length > 0;

    if (changed) {
      const patched = await patchContent(token, productId, SOURCE_LOCALE, {
        name: content.name,
        story: content.story,
        specs: content.specs
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      });

      if (!patched.ok) {
        setIsBusy(false);
        setError({ message: patched.error.message, action: patched.error.action });
        return;
      }
    }

    // Pengajuan tinjauan hanya dari status processing. Tanpa ini, publish
    // selalu gagal karena transisi processing → published tidak ada.
    // Pengecekan status mencegah pengajuan ganda saat pengguna menekan
    // tombol dua kali atau kembali ke halaman ini.
    if (productStatus === "processing") {
      const submitted = await submitForReview(token, productId);
      if (!submitted.ok) {
        setIsBusy(false);
        setError({ message: submitted.error.message, action: submitted.error.action });
        return;
      }
      setProductStatus(submitted.data.status);
    }

    setIsBusy(false);
    update({ contentReviewedAt: Date.now() });
    await goTo("publish");
  }

  return (
    <StepShell
      step="review"
      savedAt={savedAt}
      isSaving={isSaving}
      error={error}
      backTo="process"
      primary={{
        label: "Sudah sesuai, lanjut terbitkan",
        icon: <CheckIcon />,
        onClick: confirm,
        disabled: !ready,
        busy: isBusy,
        busyLabel: "Menyimpan perubahan...",
      }}
    >
      {ready ? (
        <>
          <div className={styles.field}>
            <p className={styles.label}>Foto produk</p>
            <div className={styles.photoFrame}>
              {photoStudio !== null ? (
                <img
                  className={styles.photoImage}
                  src={photoStudio}
                  alt="Foto studio produk Anda"
                />
              ) : photoOriginal !== null ? (
                <img
                  className={styles.photoImage}
                  src={photoOriginal}
                  alt="Foto asli produk Anda"
                />
              ) : (
                <DocumentIcon size={48} />
              )}
            </div>
            <p className={styles.hint}>
              {photoStudio !== null
                ? "Foto studio hasil AI. Bandingkan dengan foto asli di Langkah 1."
                : "Foto studio belum tersedia — yang tampil foto asli Anda. Foto asli tidak pernah hilang."}
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="name">
              Nama produk
            </label>
            <input
              id="name"
              className={styles.transcriptField}
              style={{ minBlockSize: "var(--touch-min)" }}
              value={content.name}
              onChange={(event) => {
                setContent({ ...content, name: event.target.value });
              }}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="story">
              Cerita produk
            </label>
            <textarea
              id="story"
              className={`${styles.transcriptField} ${styles.storyField}`}
              value={content.story}
              onChange={(event) => {
                setContent({ ...content, story: event.target.value });
              }}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="specs">
              Spesifikasi
            </label>
            <p className={styles.hint} id="specs-hint">
              Satu spesifikasi per baris.
            </p>
            <textarea
              id="specs"
              className={styles.transcriptField}
              aria-describedby="specs-hint"
              value={content.specs}
              onChange={(event) => {
                setContent({ ...content, specs: event.target.value });
              }}
            />
          </div>

          {otherLocales.length > 0 ? (
            <p className={styles.statusRow}>
              <span className={styles.statusIconAccent}>
                <DocumentIcon size={20} />
              </span>
              Juga tersedia dalam: {otherLocales.join(", ")}
            </p>
          ) : null}

          {socialCopy !== null && socialCopy.length > 0 ? (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Caption media sosial</h2>
              <p>{socialCopy}</p>
            </div>
          ) : null}

          {seoKeywords.length > 0 ? (
            <p className={styles.hint}>Kata kunci: {seoKeywords.join(", ")}</p>
          ) : null}
        </>
      ) : (
        <p className={styles.loading} role="status">
          <ClockIcon />
          Memuat hasil katalog Anda...
        </p>
      )}
    </StepShell>
  );
}
