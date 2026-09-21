"use client";

/**
 * Pembacaan teks (TTS in-app).
 *
 * Berbeda dari pembaca layar milik pengguna (FEATURE-SPECS S6): yang ini
 * tombol di dalam KATAVIS, dan yang dibacakannya hanya isi tertentu —
 * transkrip cerita. Keduanya wajib bekerja, dan keduanya diuji terpisah
 * (TC-A11Y-12).
 *
 * Pada profil Visual, pembacaannya dimulai sendiri. Itu yang dimaksud S1
 * dengan "TTS aktif otomatis": pengrajin low vision yang tidak memakai
 * pembaca layar tidak akan menemukan tombol yang belum pernah dilihatnya.
 * Karena suara yang berbunyi sendiri dapat mengagetkan, tombol berhentinya
 * tampil sejak detik pertama dan langsung dapat ditekan.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./accessibility.module.css";
import { useAccessibilityProfile } from "./ProfileProvider";

function SpeakerIcon({ size = 20 }: { readonly size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 9v6h4l5 4V5L8 9Z" />
      <path d="M17 8a5 5 0 0 1 0 8" />
    </svg>
  );
}

function StopIcon({ size = 20 }: { readonly size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function SpeakButton({
  text,
  label = "Bacakan",
}: {
  readonly text: string;
  readonly label?: string;
}): React.JSX.Element | null {
  const { profile } = useAccessibilityProfile();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const spokenRef = useRef<string | null>(null);

  // Tidak setiap peramban punya Web Speech API. Pola yang sama dipakai
  // `components/catalog/useNarration.ts`; berkas ini dulu melewatkannya,
  // dan akibatnya bukan sekadar tombol mati: `window.speechSynthesis.cancel()`
  // pada pembersihan komponen melempar TypeError tepat saat halaman
  // ditinggalkan, dan galat itu meruntuhkan navigasi berikutnya — halaman
  // tujuan gagal dirender sama sekali. Diukur di WebKit oleh TC-E2E-01.
  const [supportsSpeech, setSupportsSpeech] = useState(false);

  useEffect(() => {
    setSupportsSpeech(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const stop = useCallback((): void => {
    if (typeof window === "undefined" || !supportsSpeech) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [supportsSpeech]);

  const speak = useCallback((): void => {
    if (typeof window === "undefined" || !supportsSpeech) return;
    if (text.trim().length === 0) return;
    if (typeof SpeechSynthesisUtterance === "undefined") return;

    // Bacaan sebelumnya dihentikan lebih dulu: dua suara yang saling
    // menimpa tidak dapat diikuti siapa pun.
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    utterance.onend = () => {
      setIsSpeaking(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
    };

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [text, supportsSpeech]);

  useEffect(() => {
    if (!supportsSpeech) return;
    if (!profile.visual) return;
    if (text.trim().length === 0) return;
    // Sekali per isi. Tanpa penjagaan ini, setiap render ulang akan
    // memulai bacaan baru di tengah bacaan sebelumnya.
    if (spokenRef.current === text) return;

    spokenRef.current = text;
    speak();
  }, [profile.visual, speak, text, supportsSpeech]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
    };
  }, []);

  if (!supportsSpeech) return null;
  if (text.trim().length === 0) return null;

  return (
    <div className={styles.speak}>
      <button
        type="button"
        className={styles.resetButton}
        onClick={() => {
          if (isSpeaking) stop();
          else speak();
        }}
        aria-busy={isSpeaking}
      >
        {isSpeaking ? <StopIcon /> : <SpeakerIcon />}
        {isSpeaking ? "Hentikan bacaan" : label}
      </button>

      {/* Perubahan status diumumkan, dan tombolnya sendiri sudah membawa
          teksnya — pembaca layar tidak perlu diberi tahu dua kali. */}
      <p className={styles.status} role="status" aria-live="polite">
        {isSpeaking ? "Sedang membacakan." : ""}
      </p>
    </div>
  );
}
