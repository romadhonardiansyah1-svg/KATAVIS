"use client";

/**
 * Langkah 4 — "KATAVIS sedang membuat katalog Anda".
 *
 * Kemajuannya nyata, bukan animasi tanpa arti: setiap tahap menampilkan
 * pekerjaan yang benar-benar berjalan beserta persentasenya, dan angkanya
 * berasal dari `overallProgress` yang dihitung server dari baris `jobs`.
 *
 * Selama pemrosesan belum selesai, layar ini tidak punya aksi utama — tidak
 * ada yang boleh dikerjakan pengrajin selain menunggu. Begitu selesai, satu
 * aksi muncul: melanjutkan memeriksa hasilnya.
 */

import { useEffect, useRef, useState } from "react";

import { ERROR_CATALOG, type ErrorCode } from "@/lib/errors";

import { StepLoading, StepShell, type StepError } from "../StepShell";
import { getJobs, requestGeneration, sharpenImagePrompt, type JobView } from "../api";
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
  if (job.kind === "copy" && job.locale !== null) {
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
  const [overall, setOverall] = useState(0);
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

      // Jangan menumpuk pekerjaan baru bila masih ada yang berjalan:
      // setiap kunjungan ulang halaman sebelumnya selalu membuat 3 baris
      // baru, dan itulah sumber angka "Tahap 3 dari 42".
      const existing = await getJobs(token, productId);
      if (cancelled) return;
      if (
        existing.ok &&
        existing.data.jobs.some((job) => job.status === "queued" || job.status === "running")
      ) {
        return;
      }

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
      setOverall(result.data.overallProgress);
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
    const manual = draft?.imagePromptManual?.trim() ?? "";
    const style = draft?.imageStyle ?? "marble_light";
    let imagePrompt: string | undefined;
    if (manual.length > 0) {
      const sharpened = await sharpenImagePrompt(token, productId, {
        style,
        manual,
      });
      if (sharpened.ok) imagePrompt = sharpened.data.prompt;
    }

    const requested = await requestGeneration(token, productId, {
      tasks: ["copy", "image"],
      locales: ["id", "en"],
      imageStyle: style,
      ...(imagePrompt === undefined ? {} : { imagePrompt }),
    });
    setIsRetrying(false);

    if (!requested.ok) {
      setError({ message: requested.error.message, action: requested.error.action });
    }
  };

  // Server sudah mengembalikan pekerjaan terbaru per jenis dan bahasa.
  // Pengelompokan di sini hanya pengaman bila respons berisi riwayat lama.
  const displayedJobs = Object.values(
    jobs.reduce<Record<string, JobView>>((acc, job) => {
      acc[stageKey(job)] = job;
      return acc;
    }, {}),
  );

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

  return (
    <StepShell
      step="process"
      savedAt={savedAt}
      isSaving={isSaving}
      error={
        failure === null ? error : { message: failure.message, action: failure.action }
      }
      primary={
        anyFailed
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
              onClick: async () => {
                update({ generatedAt: Date.now() });
                await goTo("review");
              },
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
          Tekan Coba lagi untuk mengulang tahap yang gagal. Pekerjaan Anda tidak hilang.
        </p>
      )}
    </StepShell>
  );
}
