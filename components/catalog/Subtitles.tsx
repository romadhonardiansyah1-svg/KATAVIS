/**
 * Subtitle Talking-Catalog.
 *
 * Seluruh naskah dirender sebagai paragraf `<p>` yang nyata, bukan piksel
 * di dalam video dan bukan lapisan yang menutupi video. Itu yang dimaksud
 * F3-07 dan TC-A11Y-28: pembeli dapat memilih kalimatnya dengan tetikus
 * atau papan ketik lalu menyalinnya, pembaca layar membacakannya, dan
 * peramban dapat mencari di dalamnya.
 *
 * Kalimat yang sedang dibacakan ditandai tiga cara sekaligus — latar,
 * garis tebal di sisi muka, dan penanda ▸ — karena status yang disampaikan
 * lewat warna saja gagal bagi pengguna low vision dan bagi pembaca layar
 * yang tidak menyampaikan warna sama sekali.
 *
 * Seluruh naskah selalu tampak, tidak pernah hanya kalimat aktif. Waktu
 * bergulir satu arah; menyembunyikan kalimat sebelumnya berarti pembaca
 * yang tertinggal kehilangan bagian cerita yang baru saja dibacakan, dan
 * kalimat yang tidak dapat dibaca ulang tidak dapat disalin.
 */

import type { Caption } from "./timeline";
import { formatTimestamp } from "./types";

export interface SubtitlesProps {
  readonly captions: readonly Caption[];
  readonly activeIndex: number;
  readonly isPlaying: boolean;
  /** Nama pengrajin, dipakai pada keterangan daftar di bawah judul. */
  readonly artisanName: string;
  onSeek(index: number): void;
}

export function Subtitles({
  captions,
  activeIndex,
  isPlaying,
  artisanName,
  onSeek,
}: SubtitlesProps): React.JSX.Element | null {
  if (captions.length === 0) return null;

  return (
    <section className="subtitles" aria-labelledby="subtitles-heading">
      <h2 className="subtitles__heading" id="subtitles-heading">
        Subtitle
      </h2>
      <p className="subtitles__note">
        Cerita dari {artisanName}. Teks ini dapat disalin seperti teks biasa. Menekan satu kalimat
        memindahkan cerita ke kalimat itu.
      </p>

      {/*
        Satu daftar, satu kalimat per butir, tanpa pengumuman langsung.
        `aria-live` sengaja tidak dipakai: seluruh naskah sudah ada di
        dalam dokumen sejak awal, jadi pembaca layar sudah memilikinya, dan
        pengumuman tiap pergantian kalimat akan memotong bacaan pengguna
        sendiri.
      */}
      <ol className="subtitles__list">
        {captions.map((caption, index) => {
          const isActive = index === activeIndex;

          return (
            <li className="subtitles__item" key={`${caption.startMs}-${caption.endMs}-${index}`}>
              <button
                type="button"
                className={isActive ? "subtitles__line subtitles__line--active" : "subtitles__line"}
                // `aria-current` memberi tahu pembaca layar kalimat mana yang
                // sedang dibacakan, tanpa memindahkan fokus ke sana.
                aria-current={isActive ? "true" : undefined}
                data-timestamp={formatTimestamp(caption.startMs)}
                onClick={() => {
                  onSeek(index);
                }}
              >
                <span className="subtitles__marker" aria-hidden="true">
                  {isActive && isPlaying ? "▸" : "·"}
                </span>
                <span className="subtitles__time">{formatTimestamp(caption.startMs)}</span>
                <span className="subtitles__text">{caption.text}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {isPlaying ? (
        <p className="subtitles__status" role="status">
          Sedang membacakan kalimat ke-{activeIndex < 0 ? 1 : activeIndex + 1} dari {captions.length}.
        </p>
      ) : null}
    </section>
  );
}
