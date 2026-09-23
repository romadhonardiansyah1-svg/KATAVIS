"use client";

/**
 * Kerangka bersama keenam langkah.
 *
 * Yang dijaga berkas ini adalah tiga aturan yang paling mudah dilanggar
 * kalau ditulis ulang di setiap halaman:
 *
 *   - **Satu aksi utama per layar** (S2-02). Kerangkanya hanya menyediakan
 *     satu slot aksi utama; halaman tidak punya cara menambahkan tombol
 *     kedua yang berbobot sama.
 *   - **Indikator langkah selalu terlihat** (S2-05).
 *   - **Status disampaikan lewat ikon + teks + warna**, tidak pernah warna
 *     saja.
 */

import Link from "next/link";

import { actionLabel } from "@/lib/errors";

import styles from "./flow.module.css";
import { TOTAL_STEPS, stepById, type StepId } from "./flow";
import { ArrowLeftIcon, CheckIcon, ClockIcon, WarningIcon } from "./icons";

export interface PrimaryAction {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly onClick: () => void | Promise<void>;
  readonly disabled?: boolean;
  readonly busy?: boolean;
  /** Teks saat sibuk. Wajib: tombol yang hanya berputar tidak memberi tahu apa pun. */
  readonly busyLabel?: string;
}

export interface StepError {
  readonly message: string;
  /** Langkah berikutnya. S5-04: setiap pesan galat memuatnya. */
  readonly action: string;
}

interface StepShellProps {
  readonly step: StepId;
  readonly primary: PrimaryAction;
  readonly savedAt?: number | null;
  readonly isSaving?: boolean;
  readonly error?: StepError | null;
  readonly backTo?: StepId | null;
  readonly children: React.ReactNode;
}

export function formatSavedAt(at: number): string {
  return new Date(at).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Keadaan selagi draf dimuat, atau selagi pengalihan langkah berjalan. */
export function StepLoading(): React.JSX.Element {
  return (
    <main className={styles.page}>
      <p className={styles.loading} role="status">
        <ClockIcon />
        Memuat pekerjaan Anda...
      </p>
    </main>
  );
}

function SaveIndicator({
  savedAt,
  isSaving,
}: {
  readonly savedAt: number | null;
  readonly isSaving: boolean;
}): React.JSX.Element {
  // Teks, bukan animasi berputar: "Menyimpan..." memberi tahu apa yang
  // sedang terjadi, lingkaran berputar tidak (DESIGN-SYSTEM bagian 6).
  const label = isSaving
    ? "Menyimpan..."
    : savedAt === null
      ? "Belum ada perubahan untuk disimpan"
      : `Tersimpan pukul ${formatSavedAt(savedAt)}`;

  return (
    <p className={styles.saveIndicator} role="status" aria-live="polite">
      {isSaving ? (
        <ClockIcon size={20} />
      ) : (
        <CheckIcon size={20} />
      )}
      {label}
    </p>
  );
}

export function StepShell({
  step,
  primary,
  savedAt = null,
  isSaving = false,
  error = null,
  backTo = null,
  children,
}: StepShellProps): React.JSX.Element {
  const current = stepById(step);
  const back = backTo === null ? null : stepById(backTo);
  const busy = primary.busy === true;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.stepIndicator}>
          Langkah {current.position} dari {TOTAL_STEPS}
        </p>
        <h1 className={styles.title}>{current.title}</h1>
      </header>

      <main className={styles.main}>
        {children}

        {error === null ? null : (
          // role="alert" supaya pesannya dibacakan begitu muncul, tanpa
          // menuntut pengguna menemukannya sendiri.
          <div className={styles.errorBanner} role="alert">
            <span className={styles.errorIcon}>
              <WarningIcon />
            </span>
            <div className={styles.errorBody}>
              <p>{error.message}</p>
              {/*
                Label yang dibaca pengrajin, bukan kode aksinya. Kontrak API
                bagian 12 menyatakan `action` adalah kode mesin dan antarmuka
                yang memetakannya — sebelum ini yang tampil adalah
                "RETRY_OR_USE_ORIGINAL" apa adanya (TC-E2E-21).

                Aksi tanpa label (NONE, atau kode yang belum dikenal peramban
                ini) tidak dirender sama sekali: baris kosong di bawah pesan
                hanya menambah kebisingan di layar yang sedang bermasalah.
              */}
              {actionLabel(error.action) === "" ? null : error.action === "LOGIN" ? (
                <Link
                  className={styles.errorAction}
                  href="/masuk"
                  style={{ display: "inline-block", textDecoration: "underline", fontWeight: 600 }}
                >
                  {actionLabel(error.action)} →
                </Link>
              ) : (
                <p className={styles.errorAction}>{actionLabel(error.action)}</p>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className={styles.footer}>
        <SaveIndicator savedAt={savedAt} isSaving={isSaving} />

        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => {
            void primary.onClick();
          }}
          disabled={primary.disabled === true || busy}
          aria-busy={busy}
        >
          {primary.icon}
          {busy ? (primary.busyLabel ?? primary.label) : primary.label}
        </button>

        {back === null ? null : (
          <Link className={styles.secondaryLink} href={back.path}>
            <ArrowLeftIcon />
            Kembali ke langkah {back.position}
          </Link>
        )}
      </footer>
    </div>
  );
}
