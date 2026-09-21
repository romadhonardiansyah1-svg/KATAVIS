"use client";

/**
 * Langkah 2 — "Tekan tombol dan ceritakan produk Anda".
 *
 * Satu tombol bundar 96px di tengah layar, dan hanya satu aksi pada satu
 * waktu: menekannya mulai merekam, menekannya lagi berhenti. Setelah ada
 * rekaman, aksinya berganti menjadi melanjutkan.
 *
 * Peringatan pada detik ke-50 dan penghentian otomatis pada detik ke-60
 * mengikuti F1: batas atas rekaman adalah 60 detik, dan pengrajin diberi
 * tahu sebelum batas itu tercapai, bukan sesudahnya.
 */

import { useEffect, useRef, useState } from "react";

import { ERROR_CATALOG } from "@/lib/errors";

import { StepLoading, StepShell, type StepError } from "../StepShell";
import { requestTranscription } from "../api";
import styles from "../flow.module.css";
import { DocumentIcon, MicrophoneIcon, RefreshIcon, WarningIcon } from "../icons";
import { readAccessToken } from "@/lib/session";
import { useCreateFlow } from "../useDraft";

const MIN_SECONDS = 10;
const MAX_SECONDS = 60;
const WARN_SECONDS = 50;

function messageOf(code: keyof typeof ERROR_CATALOG): StepError {
  const entry = ERROR_CATALOG[code];
  return { message: entry.message, action: entry.action };
}

export default function RecordPage(): React.JSX.Element {
  const { draft, savedAt, isSaving, update, goTo } = useCreateFlow("record");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<StepError | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (draft === null) return <StepLoading />;

  const productId = draft.productId;

  async function startRecording(): Promise<void> {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
      setSeconds(0);

      timerRef.current = window.setInterval(() => {
        setSeconds((current) => {
          const next = current + 1;
          // Batas atas ditegakkan di sini, bukan hanya ditampilkan: rekaman
          // yang melewati 60 detik ditolak server, dan menunggu sampai itu
          // terjadi hanya membuang waktu pengrajin.
          if (next >= MAX_SECONDS) stopRecording();
          return next;
        });
      }, 1000);
    } catch {
      // Izin mikrofon ditolak. Tidak ada kode katalog untuk itu; yang
      // dipakai adalah pesan rekam ulang, karena langkah berikutnya memang
      // mencoba merekam lagi.
      setError(messageOf("ASR_NO_SPEECH"));
    }
  }

  function stopRecording(): void {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    recorderRef.current?.stop();
    setIsRecording(false);
  }

  async function useRecording(): Promise<void> {
    const token = readAccessToken();
    if (token === null) {
      setError(messageOf("UNAUTHENTICATED"));
      return;
    }

    if (productId === null) {
      setError(messageOf("NOT_FOUND"));
      return;
    }

    if (seconds < MIN_SECONDS) {
      setError(messageOf("ASR_TOO_SHORT"));
      return;
    }

    if (recording === null) {
      setError(messageOf("ASR_NO_SPEECH"));
      return;
    }

    setIsBusy(true);
    const requested = await requestTranscription(token, productId, recording);
    setIsBusy(false);

    if (!requested.ok) {
      setError({ message: requested.error.message, action: requested.error.action });
      return;
    }

    update({ audioJobId: requested.data.jobId });
    await goTo("transcript");
  }

  const nearLimit = isRecording && seconds >= WARN_SECONDS;

  return (
    <StepShell
      step="record"
      savedAt={savedAt}
      isSaving={isSaving}
      error={error}
      backTo="photo"
      primary={
        isRecording
          ? {
              label: "Berhenti merekam",
              icon: <MicrophoneIcon />,
              onClick: stopRecording,
            }
          : recording === null
            ? {
                label: "Mulai merekam",
                icon: <MicrophoneIcon />,
                onClick: startRecording,
                disabled: productId === null,
              }
            : {
                label: "Lanjut periksa transkrip",
                icon: <DocumentIcon />,
                onClick: useRecording,
                busy: isBusy,
                busyLabel: "Mengirim rekaman...",
              }
      }
    >
      <div className={styles.recordArea}>
        <button
          type="button"
          className={`${styles.recordButton} ${isRecording ? styles.recordButtonActive : ""}`}
          onClick={() => {
            if (isRecording) stopRecording();
            else void startRecording();
          }}
          aria-pressed={isRecording}
          aria-labelledby="record-label"
        >
          <MicrophoneIcon size={40} />
        </button>

        {/*
          Label terlihat, bukan hanya untuk pembaca layar. Ikon tidak pernah
          berdiri sendiri: tombol bundar ini diberi keterangan tepat di
          bawahnya, sehingga pengrajin yang belum mengenali ikonnya tetap
          tahu apa yang akan terjadi saat ditekan.
        */}
        <p className={styles.recordLabel} id="record-label">
          {isRecording ? "Berhenti merekam" : "Mulai merekam"}
        </p>

        <p className={styles.timer} aria-live="off">
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}
        </p>

        {nearLimit ? (
          // Status disampaikan lewat ikon + teks + warna, tidak pernah warna
          // saja.
          <p className={styles.warningText} role="status">
            <WarningIcon size={20} />
            Tersisa {MAX_SECONDS - seconds} detik. Rekaman berhenti sendiri di detik ke-60.
          </p>
        ) : (
          <p className={styles.hint} role="status">
            {isRecording
              ? "Sedang merekam. Ceritakan produk Anda: terbuat dari apa, berapa lama membuatnya, apa yang membuatnya istimewa."
              : "Ceritakan sekitar 30 detik. Rekaman paling pendek 10 detik, paling panjang 60 detik."}
          </p>
        )}

        {recording !== null && !isRecording ? (
          <p className={styles.statusRow}>
            <span className={styles.statusIconSuccess}>
              <DocumentIcon size={20} />
            </span>
            Rekaman siap dikirim, {seconds} detik.
          </p>
        ) : null}
      </div>

      {recording !== null && !isRecording ? (
        <button
          type="button"
          className={styles.secondaryLink}
          onClick={() => {
            setRecording(null);
            setSeconds(0);
            setError(null);
          }}
        >
          <RefreshIcon size={20} />
          Rekam ulang
        </button>
      ) : null}
    </StepShell>
  );
}
