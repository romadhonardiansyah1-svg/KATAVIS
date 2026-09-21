"use client";

/**
 * Pemutar Talking-Catalog.
 *
 * Satu aksi utama di layar ini: tombol putar. Tanpa ditekan, tidak ada
 * satu pun permintaan jaringan untuk audio dan tidak ada satu pun suara —
 * pembeli yang membuka halaman di ruang rapat tidak dikagetkan bunyi.
 *
 * Yang dijaga berkas ini:
 *   - Tombol putar, jeda, dan ulang adalah `<button>` sungguhan, jadi Tab,
 *     Enter, dan Space bekerja tanpa penanganan kunci khusus (F3-05).
 *   - Subtitle dan avatar dirender lebih dulu dan berdiri sendiri. Bila
 *     audionya tidak dapat dimuat atau suaranya dimatikan, keduanya tetap
 *     bekerja (F3-03, TC-A11Y-26).
 *   - Naskahnya diberikan langsung dari server; pemutar ini tidak pernah
 *     mengambilnya lewat jaringan, jadi mematikan gambar tidak mengurangi
 *     apa pun (F3-04, TC-A11Y-27).
 *   - Saat `prefers-reduced-motion`, jamnya tetap berjalan dan subjudulnya
 *     tetap berganti; yang berhenti hanya gerak mulut (F3-06, TC-A11Y-08).
 */

import { useEffect, useState } from "react";

import { Avatar } from "./Avatar";
import { Subtitles } from "./Subtitles";
import type { Narration } from "./timeline";
import { effectiveTotalMs, isIndonesianLanguage } from "./timeline";
import { formatTimestamp } from "./types";
import { useNarration } from "./useNarration";

/**
 * Preferensi sistem.
 *
 * Mesin uji menganulir `animation` dan `transition` lewat `tokens.css`,
 * tetapi gerak mulut avatar bukan keduanya: ia pergantian atribut SVG. Jadi
 * permintaan pengguna diperiksa langsung di sini, bukan diwarisi diam-diam
 * dari lembar gayanya.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = (): void => {
      setPrefersReduced(query.matches);
    };

    read();
    query.addEventListener("change", read);
    return () => {
      query.removeEventListener("change", read);
    };
  }, []);

  return prefersReduced;
}

export interface TalkingCatalogProps {
  readonly narration: Narration;
  readonly availableLocales: readonly string[];
  /**
   * Bahasa isi `narration`, apa adanya dari server.
   *
   * Lebih dipercaya daripada menebaknya dari isi teks: naskah Jepang dan
   * Mandarin sama-sama memuat aksara non-Latin, dan `availableLocales[0]`
   * tidak menjanjikan apa pun soal urutan.
   */
  readonly locale: string;
  readonly artisanName: string;
}

export function TalkingCatalog({
  narration,
  availableLocales,
  locale,
  artisanName,
}: TalkingCatalogProps): React.JSX.Element | null {
  const [wantsAudio, setWantsAudio] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const prefersReducedMotion = usePrefersReducedMotion();

  const hasCaptions = narration.captions.length > 0;

  const narrationState = useNarration({
    narration,
    availableLocales,
    locale,
    wantsAudio,
    cueMode: false,
    onActiveIndexChange: setActiveIndex,
    // Kemajuan tidak disimpan sebagai keadaan kedua: `narrationState`
    // sudah memegang posisinya, dan dua salinan posisi adalah dua angka
    // yang dapat berbeda.
    onPositionChange: () => undefined,
    onEnded: () => {
      setWantsAudio(false);
    },
  });
  void activeIndex;

  // Tidak ada kalimat berarti tidak ada yang dapat disinkronkan. Yang
  // tersisa bukan pemutar kosong melainkan naskahnya sendiri, dan itu
  // urusan halaman ini, bukan komponen ini.
  if (!hasCaptions) return null;

  const { status, source, captions, positionMs, totalMs } = narrationState;
  const isPlaying = status === "playing";
  const activeCaption = captions[narrationState.activeIndex] ?? null;
  const spokenIndex = narrationState.activeIndex;

  const unmutedTotalMs = effectiveTotalMs(captions, source.hasAudio || source.hasDeviceVoice);
  const shownTotalMs = totalMs > 0 ? totalMs : unmutedTotalMs;
  const shownPositionMs = Math.min(positionMs, shownTotalMs);
  const progressPercent = shownTotalMs > 0 ? (shownPositionMs / shownTotalMs) * 100 : 0;

  function togglePlay(): void {
    if (isPlaying) {
      narrationState.pause();
      return;
    }

    // Audio pertama kali hanya diminta pada tekanan pertama, sehingga
    // peramban mengizinkannya: pilihan pengguna sendiri yang membukanya.
    if (!wantsAudio && source.hasAudio) setWantsAudio(true);
    narrationState.play();
  }

  return (
    <section className="player" aria-labelledby="player-heading">
      <h2 className="player__heading" id="player-heading">
        Dengarkan cerita
      </h2>

      <div className="player__stage">
        <Avatar
          caption={activeCaption}
          positionMs={positionMs}
          isPlaying={isPlaying && !prefersReducedMotion}
        />

        <div className="player__body">
          <p className="player__source">
            {source.label}
            <span className="player__sourceDetail">
              {source.hasAudio
                ? "Berkas narasi yang direkam untuk katalog ini."
                : source.hasDeviceVoice
                  ? "Dibacakan oleh suara yang tersedia di peranti Anda."
                  : "Suara tidak tersedia. Seluruh cerita tetap terbaca di bawah."}
            </span>
          </p>

          <div
            className="player__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPercent)}
            aria-valuetext={`${formatTimestamp(shownPositionMs)} dari ${formatTimestamp(shownTotalMs)}`}
          >
            <div className="player__fill" style={{ inlineSize: `${progressPercent}%` }} />
          </div>
          <p className="player__time">
            <span>{formatTimestamp(shownPositionMs)}</span>
            <span>{formatTimestamp(shownTotalMs)}</span>
          </p>
        </div>
      </div>

      {/*
        Audio dirender hanya setelah pembeli meminta suara. Sebelum itu
        tidak ada berkas yang diunduh, dan itu bagian dari anggaran LCP
        halaman publik pada 4G.
      */}
      {wantsAudio && source.hasAudio ? (
        <audio
          ref={narrationState.audioRef}
          className="player__audio"
          src={narrationState.audioUrl ?? undefined}
          preload="auto"
          onTimeUpdate={narrationState.handleTimeUpdate}
          onEnded={narrationState.handleAudioEnded}
          onError={narrationState.handleAudioError}
        >
          <track kind="captions" />
        </audio>
      ) : null}

      <div className="player__controls">
        <button
          type="button"
          className="player__button player__button--primary"
          onClick={togglePlay}
          aria-busy={false}
        >
          {isPlaying ? "Jeda cerita" : status === "paused" ? "Lanjutkan cerita" : "Putar cerita"}
        </button>

        <button
          type="button"
          className="player__button"
          onClick={() => {
            setWantsAudio(false);
            narrationState.restart();
          }}
          disabled={status === "idle" && positionMs === 0}
        >
          Ulangi dari awal
        </button>
      </div>

      {/*
        Satu pesan status untuk seluruh pemutar. `polite`, bukan
        `assertive`: pergantian kalimat tidak mendesak, dan memotong bacaan
        pengguna sendiri lebih mengganggu daripada menunggu satu kalimat.
      */}
      <p className="player__status" role="status" aria-live="polite">
        {status === "idle"
          ? "Cerita belum diputar."
          : status === "ended"
            ? "Cerita sudah selesai dibacakan."
            : isPlaying
              ? `Sedang membacakan kalimat ke-${spokenIndex < 0 ? 1 : spokenIndex + 1} dari ${captions.length}.`
              : "Cerita dijeda."}
        {isPlaying && !source.hasAudio && !source.hasDeviceVoice
          ? " Tanpa suara: bacalah subjudul di bawah."
          : ""}
      </p>

      {/*
        Sisa naskah sebagai teks tersembunyi untuk papan ketik.
        Tanpa ini, naskah hanya dapat disalin dengan tetikus pada laman
        yang seluruh kendalinya dirancang untuk papan ketik.
      */}
      <p className="visually-hidden">
        Naskah lengkap: {captions.map((caption) => caption.text).join(" ")}
      </p>

      <Subtitles
        captions={captions}
        activeIndex={narrationState.activeIndex}
        isPlaying={isPlaying}
        artisanName={artisanName}
        onSeek={(index) => {
          if (!wantsAudio && source.hasAudio) setWantsAudio(true);
          narrationState.seekTo(index);
        }}
      />

      {!source.hasAudio && !source.hasDeviceVoice && !isIndonesianLanguage(captions[0]?.text ?? "") ? (
        <p className="player__fallbackNote">
          Cerita ini belum memiliki berkas suara. Subjudul di bawah berjalan sendiri mengikuti
          panjang kalimatnya, dan seluruh informasi tetap tersampaikan.
        </p>
      ) : null}

      <p className="player__aside">
        Tanpa gambar dan tanpa suara, halaman ini tetap memuat seluruh cerita, spesifikasi, dan nama
        pengrajin. Tidak ada informasi yang hanya ada di dalam audio.
      </p>
    </section>
  );
}
