/**
 * Ikon antarmuka.
 *
 * Seluruhnya `aria-hidden="true"`: setiap ikon selalu berdampingan dengan
 * label teks, sehingga membacakannya dua kali hanya menambah kebisingan bagi
 * pengguna pembaca layar. Aturan itu mengikat — tidak ada ikon yang berdiri
 * sendiri di mana pun di aplikasi ini.
 *
 * Digambar sendiri, bukan dari pustaka ikon: tiga belas ikon tidak
 * sebanding dengan menambah satu dependensi.
 */

interface IconProps {
  readonly size?: number;
}

function frame(size: number): {
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeLinecap: "round";
  readonly strokeLinejoin: "round";
  readonly "aria-hidden": true;
  readonly focusable: "false";
} {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: "false",
  };
}

export function CameraIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
  );
}

export function MicrophoneIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}

export function CheckIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="m4 12 5 5L20 6" />
    </svg>
  );
}

export function WarningIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M12 3 2 20h20Z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function ClockIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </svg>
  );
}

export function RefreshIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

export function DownloadIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function LinkIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

export function DocumentIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <path d="M6 2h8l4 4v16H6Z" />
      <path d="M14 2v4h4" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function PhoneIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

/**
 * Kunci — dipakai tombol "Masuk" dan bukan lambang keamanan.
 *
 * Ikonnya selalu berdampingan dengan label teks; aturan itu berlaku juga di
 * sini, jadi kunci ini tidak pernah berdiri sendiri tanpa kata "Masuk".
 */
export function KeyIcon({ size = 24 }: IconProps): React.JSX.Element {
  return (
    <svg {...frame(size)}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8" />
      <path d="m17 6 2 2" />
      <path d="m15 8 2 2" />
    </svg>
  );
}
