/**
 * Avatar 2D Talking-Catalog.
 *
 * Gambar SVG, bukan berkas video. ADR-005 memutuskan bentuk ini karena
 * SadTalker dan LivePortrait menuntut CUDA, dan mesin pengembangan tidak
 * memilikinya. Berkas yang disimpan karena itu beberapa ratus kilobyte
 * audio dan berkas waktu subtitle, bukan puluhan megabyte video.
 *
 * Yang dijaga berkas ini:
 *   - Tidak ada satu pun gradien. Seluruh isian adalah warna datar dari
 *     palet material di `DESIGN.md`, dan keseluruhan gambar muat dalam
 *     kotak pandang 120x120.
 *   - Tidak ada detail yang bergantung pada audio yang dapat didengar.
 *     Pembeli yang mematikan suara tetap melihat tokoh yang sedang
 *     berbicara; pembeli yang mematikan animasi tetap melihat tokoh yang
 *     sedang menunjuk tanpa kehilangan satu pun informasi.
 *   - Bentuk mulutnya bergerak hanya saat narasi berjalan. Avatar yang
 *     bergerak sendiri saat tidak ada suara mengklaim sesuatu yang tidak
 *     sedang terjadi.
 */

import { useMemo } from "react";

import type { Caption } from "./timeline";
import { mouthShape } from "./timeline";

/** Diam, setengah buka, buka. Jalur mulutnya, bukan tinggi kotaknya. */
const MOUTH_PATH: Readonly<Record<0 | 1 | 2, string>> = {
  0: "M33 72 q14 5 28 0",
  1: "M33 72 q14 16 28 0 q-14 4 -28 0",
  2: "M33 72 q14 24 28 0 q-14 6 -28 0",
};

export interface AvatarProps {
  readonly caption: Caption | null;
  readonly positionMs: number;
  readonly isPlaying: boolean;
  /** Ukuran satu sisi dalam piksel. Skalanya seragam. */
  readonly size?: number;
}

export function Avatar({
  caption,
  positionMs,
  isPlaying,
  size = 160,
}: AvatarProps): React.JSX.Element {
  const shape = isPlaying ? mouthShape(positionMs, caption) : 0;

  const shapes = useMemo(
    () =>
      ([0, 1, 2] as const).map((key) => ({
        key,
        path: MOUTH_PATH[key],
        isActive: key === shape,
      })),
    [shape],
  );

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-labelledby="avatar-title avatar-desc"
      focusable="false"
    >
      <title id="avatar-title">Tokoh pendongeng KATAVIS</title>
      <desc id="avatar-desc">
        Tokoh bergaya wayang, digambar datar dengan warna tanah liat dan indigo. Mulutnya membuka
        dan menutup mengikuti jalannya narasi. Tokoh ini hanya penanda bahwa cerita sedang
        dibacakan; seluruh isi cerita ada pada teks di bawahnya.
      </desc>

      {/* Sandaran kepala. Berfungsi juga sebagai bidang latar, sehingga
          mulut yang diisi warna halaman tetap terbaca di atasnya. */}
      <rect x="20" y="8" width="80" height="104" rx="12" fill="#F1EFE8" stroke="#B4B2A9" strokeWidth="1" />

      {/* Batang leher, digambar lebih dulu supaya kepalanya menutupinya. */}
      <rect x="52" y="70" width="16" height="34" rx="4" fill="#B4B2A9" />

      {/* Kepala dan telinga. */}
      <circle cx="60" cy="52" r="27" fill="#E8DCCF" stroke="#5A3E2B" strokeWidth="2" />
      <circle cx="33" cy="56" r="5" fill="#E8DCCF" stroke="#5A3E2B" strokeWidth="2" />
      <circle cx="87" cy="56" r="5" fill="#E8DCCF" stroke="#5A3E2B" strokeWidth="2" />

      {/* Blangkon: dua pita indigo. Bahannya dari palet, bukan hiasan
          tambahan, dan tidak ada satu pun warna baru yang masuk. */}
      <path d="M33 34 q27 -20 54 0 l0 6 q-27 -12 -54 0 Z" fill="#1F3A5F" />
      <path d="M33 40 q27 -12 54 0 l0 4 q-27 -9 -54 0 Z" fill="#2E5A8A" />

      <g fill="#2E1F17">
        <circle cx="50" cy="50" r="3.4" />
        <circle cx="70" cy="50" r="3.4" />
      </g>
      <path d="M43 43 q7 -5 14 -1" fill="none" stroke="#2E1F17" strokeWidth="2" strokeLinecap="round" />
      <path d="M77 43 q-7 -5 -14 -1" fill="none" stroke="#2E1F17" strokeWidth="2" strokeLinecap="round" />

      {/* Hidung: satu garis, bukan bentuk berisi. */}
      <path d="M60 54 l0 8" fill="none" stroke="#5A3E2B" strokeWidth="2" strokeLinecap="round" />

      {/* Tiga bentuk mulut. Hanya satu yang tampak; yang lain ditahan
          dengan `visibility`, bukan dilepas dari pohon — peramban akan
          mengulang tata letaknya bila jumlah simpulnya berubah, dan mulut
          yang bergeser sedikit setiap suku kata terbaca sebagai kerusakan. */}
      {shapes.map(({ key, path, isActive }) => (
        <path
          key={key}
          d={path}
          fill={isActive && key !== 0 ? "#2E1F17" : "#FAF6F0"}
          stroke="#5A3E2B"
          strokeWidth="2"
          strokeLinejoin="round"
          visibility={isActive ? "visible" : "hidden"}
        />
      ))}

      {/* Kancing baju. Menegaskan bidang sanggur di bawah kepala. */}
      <rect x="20" y="96" width="80" height="16" rx="6" fill="#1F3A5F" />
      <circle cx="60" cy="104" r="3" fill="#FAF6F0" />
    </svg>
  );
}
