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
import { getJobs, requestGeneration, type JobView } from "../api";
import styles from "../flow.module.css";
import { CheckIcon, ClockIcon, DocumentIcon, WarningIcon } from "../icons";
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

const TERMINAL = ["succeeded", "failed", "cancelled"];

function messageOf(code: ErrorCode): StepError {
  const entry = ERROR_CATALOG[code];
  return { message: entry.message, action: entry.action };
}

export default function ProcessPage(): React.JSX.Element {
  const { draft, savedAt, isSaving, update, goTo } = useCreateFlow("process");
  const [jobs, setJobs] = useState<readonly JobView[]>([]);
  const [overall, setOverall] = useState(0);
  const [error, setError] = useState<StepError | null>(null);
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

      // Pemrosesan diminta sekali. Mengulanginya pada setiap penyegaran
      // halaman akan menumpuk pekerjaan yang sama.
      const requested = await requestGeneration(token, productId, {
        tasks: ["copy", "image"],
        locales: ["id", "en"],
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

  // Yang diumumkan adalah perpindahan tahap, bukan angka kemajuannya.
  // Persentase berubah setiap dua detik; wilayah live yang mengumumkan
  // setiap perubahan akan berbicara tanpa henti selama satu menit penuh,
  // dan justru menenggelamkan hal yang penting: tahap mana yang selesai.
  useEffect(() => {
    if (jobs.length === 0) return;

    const done = jobs.filter((job) => job.status === "succeeded").length;
    const message =
      done === jobs.length
        ? `Katalog Anda sudah selesai dibuat. ${jobs.length} tahap selesai.`
        : `Tahap ${done + 1} dari ${jobs.length} sedang berjalan.`;

    if (message !== announcedRef.current) {
      announcedRef.current = message;
      setAnnouncement(message);
    }
  }, [jobs]);

  if (draft === null) return <StepLoading />;

  const failed = jobs.find((job) => job.status === "failed");
  const failure = failed?.error ?? null;
  const finished = jobs.length > 0 && jobs.every((job) => TERMINAL.includes(job.status));

  return (
    <StepShell
      step="process"
      savedAt={savedAt}
      isSaving={isSaving}
      error={
        failure === null ? error : { message: failure.message, action: failure.action }
      }
      primary={{
        label: "Lanjut periksa hasil",
        icon: <DocumentIcon />,
        onClick: async () => {
          update({ generatedAt: Date.now() });
          await goTo("review");
        },
        // Selama belum selesai, tidak ada aksi utama — dan tidak ada aksi
        // lain yang menggantikannya.
        disabled: !finished,
      }}
    >
      <p className={styles.progressLabel}>
        <ClockIcon size={20} />
        {finished
          ? "Katalog Anda sudah selesai dibuat."
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
        {jobs.map((job) => (
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
            {STAGE_LABEL[job.kind] ?? job.kind}
            {job.status === "running" ? ` — ${job.progress}%` : ""}
            {job.status === "succeeded" ? " — selesai" : ""}
            {job.status === "failed" ? " — gagal" : ""}
          </li>
        ))}
      </ul>

      {failure === null ? null : (
        <p className={styles.hint}>
          Anda tetap dapat melanjutkan. Pekerjaan Anda tidak hilang.
        </p>
      )}
    </StepShell>
  );
}
