"use client";

/**
 * Langkah 4 — "KATAVIS sedang membuat katalog Anda".
 *
 * Kemajuannya nyata, bukan animasi tanpa arti: setiap tahap menampilkan
 * pekerjaan yang benar-benar berjalan beserta persentasenya, dan angkanya
 * berasal dari pekerjaan pembuatan teks dan foto yang dilaporkan server.
 *
 * Selama pemrosesan belum selesai, layar ini tidak punya aksi utama — tidak
 * ada yang boleh dikerjakan pengrajin selain menunggu. Begitu selesai, satu
 * aksi muncul: melanjutkan memeriksa hasilnya.
 */

import { useEffect, useRef, useState } from "react";

import { ERROR_CATALOG, type ErrorCode } from "@/lib/errors";

import { StepLoading, StepShell, type StepError } from "../StepShell";
import { getJobs, requestGeneration, retryJob, sharpenImagePrompt, type JobView } from "../api";
import styles from "../flow.module.css";
import { CheckIcon, ClockIcon, DocumentIcon, RefreshIcon, WarningIcon } from "../icons";
import { readAccessToken } from "@/lib/session";
import { useCreateFlow } from "../useDraft";

const POLL_INTERVAL_MS = 2_000;

/**
 * Nama tahap dalam bahasa pengrajin.
 *
 * Hanya "Menyusun cerita" yang dikutip apa adanya dari FEATURE-SPECS F1;
 * sisanya disusun di sini karena dokumen tidak menetapkannya, dan antarmuka
 * tetap membutuhkan kalimat yang dapat dibaca.
 */
const STAGE_LABEL: Readonly<Record<string, string>> = {
  asr: "Mendengarkan rekaman Anda",
  copy: "Menyusun cerita",
  image: "Membuat foto studio",
  tts: "Menyiapkan suara",
  export: "Menyiapkan berkas",
};

function stageLabel(job: JobView): string {
  const base = STAGE_LABEL[job.kind] ?? job.kind;
  // `locale` boleh hilang dari respons (kontrak tidak menjamin kehadirannya)
  // — memanggil toUpperCase pada undefined menjatuhkan seluruh halaman.
  if (job.kind === "copy" && typeof job.locale === "string" && job.locale.length > 0) {
    return `${base} (${job.locale === "id" ? "Indonesia" : job.locale.toUpperCase()})`;
  }
  return base;
}

/** Kunci tampilan: satu baris per jenis dan bahasa. */
function stageKey(job: JobView): string {
  return `${job.kind}:${job.locale ?? "-"}`;
}

function messageOf(code: ErrorCode): StepError {
  const entry = ERROR_CATALOG[code];
  return { message: entry.message, action: entry.action };
}

export default function ProcessPage(): React.JSX.Element {
  const { draft, savedAt, isSaving, update, goTo } = useCreateFlow("process");
  const [jobs, setJobs] = useState<readonly JobView[]>([]);
  const [error, setError] = useState<StepError | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const announcedRef = useRef("");
  const startedRef = useRef(false);

  const productId = draft?.productId ?? null;

  useEffect(() => {
    if (productId === null || startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    const run = async (): Promise<void> => {
      const token = readAccessToken();
      if (token === null) {
        if (!cancelled) setError(messageOf("UNAUTHENTICATED"));
        return;
      }

      // Pekerjaan transkripsi berasal dari langkah sebelumnya. Hanya pekerjaan
      // katalog yang mencegah permintaan pembuatan ulang saat halaman dibuka.
      const existing = await getJobs(token, productId);
      if (cancelled) return;
      if (!existing.ok) {
        setError({ message: existing.error.message, action: existing.error.action });
        return;
      }
      if (existing.data.jobs.some((job) => job.kind === "copy" || job.kind === "image")) return;

      // Pemrosesan diminta sekali. Mengulanginya pada setiap penyegaran
      // halaman akan menumpuk pekerjaan yang sama.
      // Bila pengrajin menulis keinginan gaya foto di Langkah 1, AI
      // mempertajamnya dulu menjadi prompt final; bila tidak ada, server
      // memakai prompt otomatis dari transkrip.
      const manual = draft?.imagePromptManual?.trim() ?? "";
      const style = draft?.imageStyle ?? "marble_light";
      let imagePrompt: string | undefined;
      if (manual.length > 0) {
        const sharpened = await sharpenImagePrompt(token, productId, {
          style,
          manual,
        });
        if (cancelled) return;
        if (sharpened.ok) imagePrompt = sharpened.data.prompt;
      }

      const requested = await requestGeneration(token, productId, {
        tasks: ["copy", "image"],
        locales: ["id", "en"],
        imageStyle: style,
        ...(imagePrompt === undefined ? {} : { imagePrompt }),
      });

      if (!requested.ok && !cancelled) {
        setError({ message: requested.error.message, action: requested.error.action });
      }
    };

    void run();

    const poll = async (): Promise<void> => {
      const token = readAccessToken();
      if (token === null) return;

      const result = await getJobs(token, productId);
      if (cancelled || !result.ok) return;

      setJobs(result.data.jobs);
    };

    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [productId]);

  const retryGeneration = async (): Promise<void> => {
    if (productId === null) return;
    const token = readAccessToken();
    if (token === null) {
      setError(messageOf("UNAUTHENTICATED"));
      return;
    }

    setError(null);
    setIsRetrying(true);
    const failedJobs = displayedJobs.filter((job) => job.status === "failed");
    for (const job of failedJobs) {
      const requested = await retryJob(token, productId, job.id);
      if (!requested.ok) {
        setIsRetrying(false);
        setError({ message: requested.error.message, action: requested.error.action });
        return;
      }
    }
    setIsRetrying(false);
  };

  // Transkripsi diselesaikan pada langkah cerita. Kegagalannya tidak boleh
  // menghalangi katalog ketika pengrajin sudah menulis cerita sendiri.
  // Pengelompokan juga mengabaikan riwayat lama per jenis dan bahasa.
  const displayedJobs = Object.values(
    jobs.filter((job) => job.kind === "copy" || job.kind === "image").reduce<Record<string, JobView>>((acc, job) => {
      acc[stageKey(job)] = job;
      return acc;
    }, {}),
  );
  const overall = displayedJobs.length === 0
    ? 0
    : Math.round(displayedJobs.reduce((progress, job) => progress + job.progress, 0) / displayedJobs.length);

  // Yang diumumkan adalah perpindahan tahap, bukan angka kemajuannya.
  // Persentase berubah setiap dua detik; wilayah live yang mengumumkan
  // setiap perubahan akan berbicara tanpa henti selama satu menit penuh,
  // dan justru menenggelamkan hal yang penting: tahap mana yang selesai.
  useEffect(() => {
    if (displayedJobs.length === 0) return;

    const done = displayedJobs.filter((job) => job.status === "succeeded").length;
    const failedCount = displayedJobs.filter((job) => job.status === "failed").length;
    const message =
      failedCount > 0
        ? `Satu tahap gagal dan perlu dicoba lagi. ${done} dari ${displayedJobs.length} tahap selesai.`
        : done === displayedJobs.length
          ? `Katalog Anda sudah selesai dibuat. ${displayedJobs.length} tahap selesai.`
          : `Tahap ${done + 1} dari ${displayedJobs.length} sedang berjalan.`;

    if (message !== announcedRef.current) {
      announcedRef.current = message;
      setAnnouncement(message);
    }
  }, [jobs]);

  if (draft === null) return <StepLoading />;

  const failed = displayedJobs.find((job) => job.status === "failed");
  const failure = failed?.error ?? null;
  const allSucceeded =
    displayedJobs.length > 0 && displayedJobs.every((job) => job.status === "succeeded");
  const anyFailed = displayedJobs.some((job) => job.status === "failed");
  const stillRunning = displayedJobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );
  const copyJobs = displayedJobs.filter((job) => job.kind === "copy");
  const useOriginal =
    !stillRunning &&
    copyJobs.length > 0 &&
    copyJobs.every((job) => job.status === "succeeded") &&
    displayedJobs.some((job) => job.kind === "image" && job.status === "failed") &&
    displayedJobs.every((job) => job.status === "succeeded" || job.kind === "image");

  const continueToReview = async (): Promise<void> => {
    update({ generatedAt: Date.now() });
    await goTo("review");
  };

  return (
    <StepShell
      step="process"
      savedAt={savedAt}
      isSaving={isSaving}
      error={
        failure === null ? error : { message: failure.message, action: failure.action }
      }
      primary={
        useOriginal
          ? {
              label: "Lanjut dengan foto asli",
              icon: <DocumentIcon />,
              onClick: continueToReview,
            }
          : anyFailed
          ? {
              label: "Coba lagi",
              icon: <RefreshIcon />,
              onClick: retryGeneration,
              busy: isRetrying,
              busyLabel: "Meminta ulang...",
              // Menekan Coba lagi selagi tahap lain masih berjalan hanya
              // menumpuk pekerjaan baru di atas yang lama.
              disabled: stillRunning,
            }
          : {
              label: "Lanjut periksa hasil",
              icon: <DocumentIcon />,
              onClick: continueToReview,
              // Lanjut hanya bila SEMUA tahap berhasil. Gagal berarti ada
              // yang harus dicoba lagi, bukan dilewati diam-diam.
              disabled: !allSucceeded,
            }
      }
    >
      <p className={styles.progressLabel}>
        <ClockIcon size={20} />
        {allSucceeded
          ? "Katalog Anda sudah selesai dibuat."
          : useOriginal
            ? "Teks katalog selesai. Foto studio gagal dibuat; foto asli Anda siap dipakai."
          : anyFailed && !stillRunning
            ? "Satu tahap gagal. Tekan Coba lagi."
            : `Membuat katalog... ${overall}%`}
      </p>

      {/* Hanya perubahan tahap yang diumumkan. `polite`, bukan `assertive`:
          pemrosesan berjalan satu menit dan tidak mendesak, sementara
          `assertive` memotong pembacaan yang sedang berjalan. */}
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {announcement}
      </p>

      <div
        className={styles.progressTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={overall}
        aria-label="Kemajuan pembuatan katalog"
      >
        <div className={styles.progressFill} style={{ inlineSize: `${overall}%` }} />
      </div>

      <ul className={styles.stageList}>
        {displayedJobs.map((job) => (
          <li key={job.id} className={styles.statusRow}>
            <span
              className={
                job.status === "succeeded"
                  ? styles.statusIconSuccess
                  : job.status === "failed"
                    ? styles.statusIconDanger
                    : styles.statusIconAccent
              }
            >
              {job.status === "succeeded" ? (
                <CheckIcon size={20} />
              ) : job.status === "failed" ? (
                <WarningIcon size={20} />
              ) : (
                <ClockIcon size={20} />
              )}
            </span>
            {stageLabel(job)}
            {job.status === "running" ? ` — ${job.progress}%` : ""}
            {job.status === "succeeded" ? " — selesai" : ""}
            {job.status === "failed" ? " — gagal" : ""}
          </li>
        ))}
      </ul>

      {failure === null ? null : (
        <p className={styles.hint}>
          {useOriginal
            ? "Anda dapat melanjutkan dengan foto asli atau mencoba membuat foto studio lagi."
            : "Tekan Coba lagi untuk mengulang tahap yang gagal. Pekerjaan Anda tidak hilang."}
        </p>
      )}
      {useOriginal ? (
        <button type="button" className={styles.secondaryLink} onClick={() => void retryGeneration()} disabled={isRetrying}>
          <RefreshIcon />
          {isRetrying ? "Meminta ulang..." : "Coba lagi foto studio"}
        </button>
      ) : null}
    </StepShell>
  );
}
