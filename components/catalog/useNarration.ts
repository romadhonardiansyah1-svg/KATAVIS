"use client";

/**
 * Pemutaran narasi Talking-Catalog.
 *
 * Satu hook memegang seluruh keadaan pemutaran. Dua tempat yang menghitung
 * posisi masing-masing akan berbeda dalam hitungan detik, dan F3-01
 * mengukur selisih itu.
 *
 * Bentuk mulut avatar dihitung dari posisi ini, bukan dari `AnalyserNode`.
 * Membaca amplitudo menuntut AudioContext yang aktif, dan peramban menahan
 * AudioContext sampai ada interaksi pengguna. Avatar yang baru bergerak
 * setelah tombol kedua tidak berguna sebagai penanda bahwa narasi berjalan.
 *
 * TTS perangkat adalah lapis cadangan ketika `narration.audioUrl` kosong.
 * Worker saat ini memang selalu mengirim `null` (worker/index.ts baris 979),
 * jadi lapis ini adalah jalur yang berjalan hari ini — bukan tambahan
 * spekulatif. Penyedia TTS final belum ditetapkan: ADR-005 "Keputusan
 * terbuka", O4.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccessibilityProfile } from "@/components/a11y/ProfileProvider";
import type { A11yProfile } from "@/lib/schemas";

import type { Caption, Narration } from "./timeline";
import {
  CAPTION_TOLERANCE_MS,
  captionIndexAt,
  captionStartMs,
  effectiveTotalMs,
  isIndonesianLanguage,
  languageOf,
  pickIndonesianVoice,
  remainingText,
  timelineDurationMs,
} from "./timeline";

/** Serambi sebelum kata pertama saat kalimat terlampaui tanpa suara. */
const SKIP_LEAD_IN_MS = 200;

/**
 * Diberikan setelah jeda. Nilai negatif berarti "belum ada yang dibacakan",
 * yang berbeda artinya dengan nol — nol berarti kalimat pertama.
 */
const NEVER_SPEAKED = -1;

export type NarrationStatus = "idle" | "playing" | "paused" | "ended";

export interface NarrationSource {
  /** Nama yang dibaca pembeli, misalnya "Suara perangkat". */
  readonly label: string;
  readonly hasAudio: boolean;
  readonly hasDeviceVoice: boolean;
}

export interface NarrationState {
  readonly captions: readonly Caption[];
  readonly activeIndex: number;
  readonly positionMs: number;
  readonly status: NarrationStatus;
  readonly source: NarrationSource;
  readonly totalMs: number;
  readonly audioUrl: string | null;
  readonly audioRef: React.RefObject<HTMLAudioElement | null>;
  /** Profil aksesibilitas yang sedang aktif, dari penyedia di akar aplikasi. */
  readonly profile: A11yProfile;
  play(): void;
  pause(): void;
  restart(): void;
  seekTo(index: number): void;
  handleTimeUpdate(): void;
  handleAudioEnded(): void;
  handleAudioError(): void;
}

export interface NarrationInput {
  readonly narration: Narration;
  /** Dipakai untuk memilih kode bahasa suara perangkat. */
  readonly availableLocales: readonly string[];
  /**
   * Bahasa naskah menurut server, bila ada.
   *
   * Opsional supaya pemanggil lama tetap bekerja; bila kosong, bahasanya
   * ditebak dari isi teks seperti sebelumnya.
   */
  readonly locale?: string;
  /** Audio hanya dilampirkan dan dibunyikan setelah pembeli menekan tombol. */
  readonly wantsAudio: boolean;
  /** Setiap kalimat dibacakan berurutan, bukan sebagai satu penggalan. */
  readonly cueMode: boolean;
  onActiveIndexChange(index: number): void;
  onPositionChange(positionMs: number): void;
  onEnded(): void;
}

/**
 * Bahasa naskah menurut isinya, bukan menurut urutan `availableLocales`.
 *
 * Urutan larik itu datang dari basis data dan tidak menjanjikan apa pun;
 * mengandalkannya berarti narasi berbahasa Inggris dapat dibacakan dengan
 * aturan pelafalan Indonesia.
 *
 * Yang paling dipercaya adalah `locale` dari server (kontrak API bagian
 * 10): server tahu persis baris mana yang dilayaninya, dan tebakan dari
 * teks hanya perkiraan. Tebakan itu tetap dipakai bila `locale` tidak ada
 * atau berisi kode yang tidak dapat dipakai.
 */
function scriptLanguage(input: NarrationInput): string {
  if (input.locale !== undefined && input.locale.length > 0) return languageOf(input.locale);

  const tagged = input.narration.captions.find((caption) => isIndonesianLanguage(caption.text));
  if (tagged !== undefined) return languageOf("id");

  const first = input.availableLocales[0];
  return first === undefined ? languageOf("id") : languageOf(first);
}

export function useNarration(input: NarrationInput): NarrationState {
  const { profile } = useAccessibilityProfile();
  const [status, setStatus] = useState<NarrationStatus>("idle");
  const [positionMs, setPositionMs] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [deviceVoice, setDeviceVoice] = useState<SpeechSynthesisVoice | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(false);
  /**
   * Kalimat yang dibacakan terakhir, dalam satuan `captions[index].startMs`.
   *
   * Melanjutkan setelah jeda harus memulai dari kalimat itu, bukan dari
   * awal naskah. `SpeechSynthesisUtterance` tidak dapat dijeda dan
   * dilanjutkan, jadi satu-satunya cara adalah membentuk ulang dari kalimat
   * yang benar.
   */
  const spokenFromRef = useRef<number>(NEVER_SPEAKED);

  const captions = input.narration.captions;
  const language = useMemo(() => scriptLanguage(input), [input]);
  const supportsSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
  const hasAudio = input.narration.audioUrl !== null;
  const hasDeviceVoice = supportsSpeech && isIndonesianLanguage(language);
  /** Ada sumber suara apa pun. Bila tidak, jamnya berjalan sendiri. */
  const hasVoice = hasAudio || hasDeviceVoice;

  const source = useMemo<NarrationSource>(
    () => ({
      label: hasAudio
        ? "Suara studio"
        : hasDeviceVoice
          ? "Suara perangkat"
          : "Mode tenang, tanpa suara",
      hasAudio,
      hasDeviceVoice,
    }),
    [hasAudio, hasDeviceVoice],
  );

  const totalMs = useMemo(() => effectiveTotalMs(captions, hasVoice), [captions, hasVoice]);

  // Suara perangkat dimuat asinkron oleh peramban. Tanpa pendengar ini,
  // perangkat yang memuat daftarnya lambat selalu jatuh ke mode tanpa suara
  // meski suaranya tersedia.
  useEffect(() => {
    if (!supportsSpeech) return;

    const synth = window.speechSynthesis;
    const readVoices = (): void => {
      setDeviceVoice(pickIndonesianVoice(synth.getVoices()));
    };

    readVoices();
    synth.addEventListener("voiceschanged", readVoices);
    return () => {
      synth.removeEventListener("voiceschanged", readVoices);
    };
  }, [supportsSpeech]);

  // Satu suara yang dibicarakan lintas komponen berarti dua narasi yang
  // saling menimpa, dan tidak ada yang dapat diikuti. Pemutar lain yang
  // mengambil alih, dan yang ini berhenti dengan sendirinya.
  useEffect(() => {
    if (!supportsSpeech) return;

    const synth = window.speechSynthesis;
    const yieldToOtherPlayer = (): void => {
      if (!playingRef.current) return;
      if (!synth.speaking && !synth.pending) return;

      playingRef.current = false;
      synth.cancel();
      setStatus("paused");
    };

    yieldToOtherPlayer();
    synth.addEventListener("speak", yieldToOtherPlayer);
    return () => {
      synth.removeEventListener("speak", yieldToOtherPlayer);
    };
  }, [supportsSpeech]);

  // Peramban menghentikan audio saat simpulnya dilepas; yang tidak berhenti
  // adalah TTS, dan narasi yang tidak dapat dijeda dilarang F3-02.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    input.onActiveIndexChange(activeIndex);
  }, [activeIndex, input]);

  useEffect(() => {
    input.onPositionChange(positionMs);
  }, [positionMs, input]);

  const speakFrom = useCallback(
    (fromMs: number): void => {
      if (!supportsSpeech || captions.length === 0) return;

      const remaining = remainingText(captions, fromMs);
      if (remaining.text.length === 0) return;

      const utterance = new SpeechSynthesisUtterance(
        input.cueMode ? (captions[remaining.fromIndex]?.text ?? remaining.text) : remaining.text,
      );
      utterance.lang = language;
      if (deviceVoice !== null) utterance.voice = deviceVoice;

      spokenFromRef.current = fromMs;
      const startedAt = Date.now();

      utterance.onboundary = (event) => {
        spokenFromRef.current = fromMs + (Date.now() - startedAt);
        void event;
        if (!playingRef.current) {
          // Pendengar `boundary` hanya terpasang saat pidato dimulai, jadi
          // jeda harus menghentikannya dari sini.
          window.speechSynthesis.cancel();
        }
      };

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [captions, deviceVoice, input.cueMode, language, supportsSpeech],
  );

  const play = useCallback((): void => {
    if (captions.length === 0) return;

    playingRef.current = true;
    const audio = audioRef.current;

    if (input.wantsAudio && audio !== null) {
      // Pos nol dan pos yang sudah lewat ujung sama-sama berarti mulai
      // ulang. Tanpa cabang kedua, `play()` pada audio yang habis hanya diam.
      if (positionMs === 0 || positionMs >= totalMs - CAPTION_TOLERANCE_MS) {
        setPositionMs(0);
        audio.currentTime = 0;
      }
      spokenFromRef.current = NEVER_SPEAKED;
      void audio.play().catch(() => {
        // Autoplay ditolak, atau berkasnya tidak dapat diputar. Narasi tidak
        // boleh berhenti karena itu: jamnya tetap berjalan, dan subtitle
        // adalah isi yang sebenarnya.
        playingRef.current = false;
      });
    } else if (hasDeviceVoice) {
      const fromMs = spokenFromRef.current < 0 ? positionMs : spokenFromRef.current;
      speakFrom(fromMs);
    } else {
      // Mode tanpa suara: dorong sedikit ke depan supaya kalimat pertama
      // benar-benar tersorot. Pada posisi nol ia belum aktif menurut
      // `startMs`-nya sendiri, dan layar yang diam terbaca sebagai rusak.
      setPositionMs((current) => current + SKIP_LEAD_IN_MS);
    }

    setStatus("playing");
  }, [captions.length, hasDeviceVoice, input.wantsAudio, positionMs, speakFrom, totalMs]);

  const pause = useCallback((): void => {
    playingRef.current = false;

    audioRef.current?.pause();
    if (supportsSpeech) window.speechSynthesis.cancel();

    setStatus(positionMs >= totalMs ? "ended" : "paused");
  }, [positionMs, supportsSpeech, totalMs]);

  const restart = useCallback((): void => {
    playingRef.current = false;
    spokenFromRef.current = NEVER_SPEAKED;

    const audio = audioRef.current;
    if (audio !== null) audio.pause();
    if (supportsSpeech) window.speechSynthesis.cancel();

    setPositionMs(0);
    setActiveIndex(-1);
    setStatus("idle");
  }, [supportsSpeech]);

  const seekTo = useCallback(
    (index: number): void => {
      const caption = captions[index];
      if (caption === undefined) return;

      // Menggeser berarti memindahkan jam ke awal kalimat tujuan. Pada mode
      // bersuara kalimat mulai tepat di `startMs`-nya; pada mode tanpa suara
      // ia mulai setelah serambi, dan `captionStartMs` yang menghitungnya.
      const targetMs = captionStartMs(index, captions, hasVoice);

      setPositionMs(targetMs);
      setActiveIndex(index);

      const audio = audioRef.current;
      if (hasAudio && audio !== null) {
        audio.currentTime = targetMs / 1000;
        if (playingRef.current) void audio.play().catch(() => undefined);
        return;
      }

      spokenFromRef.current = NEVER_SPEAKED;
      if (supportsSpeech) window.speechSynthesis.cancel();
      if (playingRef.current && hasDeviceVoice) speakFrom(caption.startMs);
    },
    [captions, hasAudio, hasDeviceVoice, hasVoice, speakFrom, supportsSpeech],
  );

  const handleTimeUpdate = useCallback((): void => {
    const audio = audioRef.current;
    if (audio === null) return;
    setPositionMs(audio.currentTime * 1000);
  }, []);

  const handleAudioEnded = useCallback((): void => {
    // Ujung berkas bukan ujung narasi: kalimat boleh berakhir setelah
    // audionya, dan memutus di detik terakhir menghilangkan kata terakhir.
    // Jamnya karena itu dihentikan di ujung naskah, bukan di ujung berkas —
    // pengambilan sampel berikutnya yang menyatakan narasi selesai.
    const narrationEndMs = Math.max(totalMs, timelineDurationMs(captions));
    setPositionMs(narrationEndMs);
  }, [captions, totalMs]);

  const handleAudioError = useCallback((): void => {
    // Berkasnya tidak dapat diputar. Narasi tetap berjalan dengan suara
    // perangkat bila ada, dan bila tidak ada, dengan jam tanpa suara.
    // Pembeli tidak kehilangan isi katalog karena satu berkas rusak.
    playingRef.current = true;
    if (hasDeviceVoice) speakFrom(positionMs);
    else setPositionMs((current) => current + SKIP_LEAD_IN_MS);
  }, [hasDeviceVoice, positionMs, speakFrom]);

  useEffect(() => {
    if (!playingRef.current) return;
    if (positionMs < totalMs) return;

    playingRef.current = false;
    if (supportsSpeech) window.speechSynthesis.cancel();
    setStatus("ended");
    input.onEnded();
  }, [input, positionMs, supportsSpeech, totalMs]);

  // Jam mode tanpa audio: tidak ada sumber posisi sama sekali. Subtitle
  // yang tidak bergerak saat suara tidak ada berarti F3-03 dan F3-04 gagal
  // bersamaan.
  useEffect(() => {
    if (status !== "playing" || hasVoice) return;

    let last = window.performance.now();
    const timer = window.setInterval(() => {
      const now = window.performance.now();
      const delta = now - last;
      last = now;
      setPositionMs((current) => Math.min(current + delta, totalMs));
    }, 50);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasVoice, status, totalMs]);

  // Jam mode TTS perangkat: mengambil `boundary`, lalu jatuh ke penghitung.
  // `boundary` tidak dikirim merata oleh semua peramban dan semua suara;
  // jatuh ke penghitung berarti bug satu peramban menjadi selisih kecil
  // pada satu kalimat, bukan subtitle yang berhenti sama sekali.
  useEffect(() => {
    if (status !== "playing" || hasVoice === false || hasAudio) return;
    if (!hasDeviceVoice) return;

    if (spokenFromRef.current < 0) spokenFromRef.current = 0;
    let last = window.performance.now();

    const timer = window.setInterval(() => {
      const now = window.performance.now();
      const delta = now - last;
      last = now;

      setPositionMs((current) =>
        Math.min(Math.max(current + delta, spokenFromRef.current), totalMs),
      );
    }, 50);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasAudio, hasDeviceVoice, hasVoice, status, totalMs]);

  // Kalimat aktif diturunkan dari `positionMs`, bukan disimpan tersendiri.
  // Satu sumber kebenaran berarti subtitle dan avatar tidak dapat menunjuk
  // kalimat yang berbeda.
  useEffect(() => {
    const next = captionIndexAt(captions, positionMs);
    if (next === activeIndex) return;

    setActiveIndex(next);

    if (status !== "playing" || hasAudio || !hasDeviceVoice) return;

    const caption = captions[next];
    if (caption === undefined || positionMs < caption.startMs) return;

    // Kalimat terlampaui tanpa dibacakan. Hanya suara perangkat yang perlu
    // ditarik ulang: audio berkas sudah berada di tempatnya sendiri.
    speakFrom(caption.startMs);
  }, [activeIndex, captions, hasAudio, hasDeviceVoice, positionMs, speakFrom, status]);

  return {
    captions,
    activeIndex,
    positionMs,
    status,
    source,
    totalMs,
    audioUrl: input.narration.audioUrl,
    audioRef,
    profile,
    play,
    pause,
    restart,
    seekTo,
    handleTimeUpdate,
    handleAudioEnded,
    handleAudioError,
  };
}
