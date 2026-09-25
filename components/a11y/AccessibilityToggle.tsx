"use client";

/**
 * Tombol Accessibility Mode.
 *
 * Satu tombol permanen di pojok layar, dapat dijangkau dari halaman mana pun
 * (S1-01, TC-A11Y-11). Menekannya membuka lima pilihan yang dapat digabung.
 *
 * Yang dijaga berkas ini:
 *   - Setiap ikon berdampingan label teks. Tidak ada ikon yang berdiri
 *     sendiri di mana pun, termasuk pada tombol pembukanya.
 *   - Status disampaikan lewat ikon + teks + warna, dan diumumkan lewat
 *     `aria-live` supaya pengguna pembaca layar mendengar bahwa
 *     pengaturannya tersimpan — bukan menebak dari perubahan tampilan.
 *   - Tombolnya `<button>`, bukan `div` ber-`role`, dan tidak ada
 *     `tabindex` positif di mana pun.
 */

import { useId, useState } from "react";

import styles from "./accessibility.module.css";
import { actionLabel } from "@/lib/errors";
import { PROFILE_KEYS, useAccessibilityProfile, type ProfileKey } from "./ProfileProvider";

interface ProfileCopy {
  readonly label: string;
  readonly hint: string;
}

/**
 * Nama dan keterangan tiap profil.
 *
 * Namanya mengikuti tabel di DESIGN-SYSTEM bagian 9. Keterangannya menjelaskan
 * apa yang berubah, karena "Motorik" tidak berarti apa-apa bagi pengrajin
 * yang belum pernah mendengar istilah itu.
 */
const PROFILE_COPY: Readonly<Record<ProfileKey, ProfileCopy>> = {
  visual: {
    label: "Visual",
    hint: "Teks dan tombol diperbesar, dan transkrip dapat dibacakan.",
  },
  hearing: {
    label: "Pendengaran",
    hint: "Subtitle, pesan tertulis, dan getar tersedia bila perangkat mendukungnya.",
  },
  motor: {
    label: "Motorik",
    hint: "Tombol lebih besar dan berjarak lebih jauh. Tidak ada batas waktu.",
  },
  cognitive: {
    label: "Kognitif",
    hint: "Satu aksi utama per layar dan langkah kerja yang selalu tertulis.",
  },
  voice: {
    label: "Bantuan suara",
    hint: "Perintah suara di aplikasi belum tersedia. Gunakan kendali suara bawaan perangkat.",
  },
};

function AccessibilityIcon({ size = 24 }: { readonly size?: number }): React.JSX.Element {
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
      <circle cx="12" cy="4" r="2" />
      <path d="M4 8h16" />
      <path d="M12 8v6" />
      <path d="m8 20 4-6 4 6" />
    </svg>
  );
}

function CheckIcon({ size = 20 }: { readonly size?: number }): React.JSX.Element {
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
      <path d="m4 12 5 5L20 6" />
    </svg>
  );
}

function ClockIcon({ size = 20 }: { readonly size?: number }): React.JSX.Element {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function WarningIcon({ size = 20 }: { readonly size?: number }): React.JSX.Element {
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
      <path d="M12 3 2 20h20Z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function RefreshIcon({ size = 20 }: { readonly size?: number }): React.JSX.Element {
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
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

export function AccessibilityToggle(): React.JSX.Element {
  const { profile, isSaving, savedAt, error, toggle, reset } = useAccessibilityProfile();
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();

  const activeCount = PROFILE_KEYS.filter((key) => profile[key]).length;

  const status = isSaving
    ? { icon: <ClockIcon />, text: "Menyimpan pengaturan...", tone: styles.statusBusy }
    : error !== null
      ? { icon: <WarningIcon />, text: `${error.message} ${actionLabel(error.action)}`, tone: styles.statusError }
      : savedAt !== null
        ? {
            icon: <CheckIcon />,
            text: `Tersimpan pukul ${new Date(savedAt).toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
            })}`,
            tone: styles.statusSaved,
          }
        : {
            icon: <CheckIcon />,
            text:
              activeCount === 0
                ? "Belum ada profil yang dipilih."
                : `${activeCount} profil aktif.`,
            tone: styles.statusSaved,
          };

  return (
    <div className={styles.dock}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-busy={isSaving}
        onClick={() => {
          setIsOpen((current) => !current);
        }}
      >
        <AccessibilityIcon />
        Mode Aksesibilitas
        {activeCount === 0 ? null : <span className={styles.badge}>{activeCount}</span>}
      </button>

      <div className={styles.panel} id={panelId} hidden={!isOpen}>
        <h2 className={styles.panelTitle}>Mode Aksesibilitas</h2>
        <p className={styles.panelHint}>Anda dapat memilih lebih dari satu.</p>

        <ul className={styles.optionList}>
          {PROFILE_KEYS.map((key) => {
            const optionId = `${panelId}-${key}`;
            const copy = PROFILE_COPY[key];

            return (
              <li key={key}>
                <label className={styles.option} htmlFor={optionId}>
                  <input
                    id={optionId}
                    className={styles.checkbox}
                    type="checkbox"
                    checked={profile[key]}
                    disabled={key === "voice" && !profile.voice}
                    onChange={() => {
                      toggle(key);
                    }}
                  />
                  <span className={styles.optionBody}>
                    <span className={styles.optionLabel}>{copy.label}</span>
                    <span className={styles.optionHint}>{copy.hint}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {/*
          Perubahan status diumumkan, bukan hanya terlihat. `polite`, bukan
          `assertive`: menyimpan pengaturan tidak mendesak, dan memotong
          pembacaan yang sedang berjalan lebih mengganggu daripada menunggu
          satu kalimat selesai.
        */}
        <p className={`${styles.status} ${status.tone}`} role="status" aria-live="polite">
          {status.icon}
          {status.text}
        </p>

        {activeCount === 0 ? null : (
          <button
            type="button"
            className={styles.resetButton}
            aria-busy={isSaving}
            onClick={() => {
              reset();
            }}
          >
            <RefreshIcon />
            Kembalikan ke pengaturan awal
          </button>
        )}
      </div>
    </div>
  );
}
