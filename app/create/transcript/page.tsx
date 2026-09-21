"use client";

/**
 * Langkah 3 — "Apakah ini yang Anda ceritakan?".
 *
 * Layar tinjau ADR-008. Ini langkah yang menentukan: satu nama produk yang
 * salah dengar akan muncul di cerita, spesifikasi, caption, kata kunci, dan
 * setiap bahasa terjemahan. Memperbaiki di sini berarti menyunting satu
 * kalimat; memperbaiki setelah diproses berarti menyunting belasan bidang.
 *
 * Aksi utamanya satu — "Sudah benar, lanjutkan" — dan menekannya tanpa
 * mengubah apa pun tetap sah. Yang ditandai adalah tindakan meninjau, bukan
 * tindakan menyunting; ADR-008 menyebutnya eksplisit, dan alur ini tidak
 * boleh menuntut pengrajin mengetik apa pun.
 */

import { useEffect, useRef, useState } from "react";

import { ERROR_CATALOG } from "@/lib/errors";

import { SpeakButton } from "@/components/a11y/SpeakButton";

import { StepLoading, StepShell, type StepError } from "../StepShell";
import { getTranscript, putTranscript } from "../api";
import styles from "../flow.module.css";
import { CheckIcon, ClockIcon, MicrophoneIcon } from "../icons";
import { readAccessToken } from "@/lib/session";
import { useCreateFlow } from "../useDraft";

/** ASR berjalan sebagai pekerjaan; transkripnya belum ada saat halaman dibuka. */
const POLL_INTERVAL_MS = 2_000;

function messageOf(code: keyof typeof ERROR_CATALOG): StepError {
  const entry = ERROR_CATALOG[code];
  return { message: entry.message, action: entry.action };
}

export default function TranscriptPage(): React.JSX.Element {
  const { draft, savedAt, isSaving, update, goTo } = useCreateFlow("transcript");
  const [text, setText] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<StepError | null>(null);
  const loadedRef = useRef(false);

  const productId = draft?.productId ?? null;

  useEffect(() => {
    if (productId === null || loadedRef.current) return;

    let cancelled = false;

    const poll = async (): Promise<void> => {
      const token = readAccessToken();
      if (token === null) {
        if (!cancelled) setError(messageOf("UNAUTHENTICATED"));
        return;
      }

      const result = await getTranscript(token, productId);
      if (cancelled) return;

      if (result.ok) {
        loadedRef.current = true;
        // Transkrip sudah ada: polling berhenti di sini. Tanpa ini, jawaban
        // berikutnya tiba setiap dua detik dan menimpa suntingan yang sedang
        // dibuat pengrajin — layar tinjau tidak pernah benar-benar dapat
        // disunting. Ditangkap oleh TC-E2E-23.
        window.clearInterval(timer);
        setText(result.data.text);
        update({ transcript: result.data.text });
        return;
      }

      // Transkrip belum siap. Selama kegagalannya hanya "belum ada", ia
      // bukan galat yang perlu ditampilkan — ASR memang masih berjalan.
      if (result.error.code !== "NOT_FOUND") {
        setError({ message: result.error.message, action: result.error.action });
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [productId, update]);

  if (draft === null) return <StepLoading />;

  const ready = text !== null;

  async function submit(): Promise<void> {
    const token = readAccessToken();
    if (token === null || productId === null || text === null) {
      setError(messageOf("UNAUTHENTICATED"));
      return;
    }

    setIsBusy(true);
    const saved = await putTranscript(token, productId, text);
    setIsBusy(false);

    if (!saved.ok) {
      setError({ message: saved.error.message, action: saved.error.action });
      return;
    }

    update({ transcript: text, transcriptReviewed: true });
    await goTo("process");
  }

  return (
    <StepShell
      step="transcript"
      savedAt={savedAt}
      isSaving={isSaving}
      error={error}
      backTo="record"
      primary={{
        label: "Sudah benar, lanjutkan",
        icon: <CheckIcon />,
        onClick: submit,
        disabled: !ready,
        busy: isBusy,
        busyLabel: "Menyimpan transkrip...",
      }}
    >
      {ready ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="transcript">
            Transkrip cerita Anda
          </label>
          <p className={styles.hint} id="transcript-hint">
            Bacalah dan perbaiki bila ada yang salah dengar. Bila sudah sesuai, Anda boleh
            langsung menekan tombol di bawah tanpa mengubah apa pun.
          </p>
          <textarea
            id="transcript"
            className={styles.transcriptField}
            aria-describedby="transcript-hint"
            value={text ?? ""}
            onChange={(event) => {
              setText(event.target.value);
              update({ transcript: event.target.value });
            }}
          />

          {/*
            Pembacaan di dalam aplikasi, terpisah dari pembaca layar
            pengguna. S6 menegaskan keduanya hal yang berbeda dan keduanya
            wajib bekerja.
          */}
          <SpeakButton text={text ?? ""} label="Bacakan transkrip" />
        </div>
      ) : (
        <p className={styles.loading} role="status">
          <ClockIcon />
          Menyiapkan transkrip cerita Anda...
        </p>
      )}

      <button
        type="button"
        className={styles.secondaryLink}
        onClick={() => {
          void goTo("record");
        }}
      >
        <MicrophoneIcon size={20} />
        Rekam ulang cerita
      </button>
    </StepShell>
  );
}
