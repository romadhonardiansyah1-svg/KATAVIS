"use client";

/**
 * Layar masuk — dua langkah, tanpa kata sandi.
 *
 * Sampai sekarang layar ini belum ada, dan itu berarti tidak ada satu pun
 * cara bagi pengrajin untuk memperoleh token: seluruh alur enam langkah
 * mengandalkan token yang sudah ada di perangkat, yang hanya dapat muncul
 * lewat penyuntikan manual. Endpoint-nya sudah ada sejak awal
 * (`POST /auth/otp/request`, `POST /auth/otp/verify`); yang hilang adalah
 * pintunya.
 *
 * Dua langkah, bukan satu formulir: nomor telepon dan kode dikirim pada dua
 * permintaan yang berbeda, dan menggabungkannya di satu layar akan menuntut
 * salah satunya dikirim dua kali.
 *
 * Yang sengaja TIDAK ada di sini:
 *
 *   - **Tidak ada pemeriksaan izin.** Peran tidak dibaca di klien sama
 *     sekali (AGENTS.md aturan 3). Yang disimpan hanyalah tokennya.
 *   - **Tidak ada animasi selain umpan balik keadaan.** Dial MOTION bernilai
 *     1; tidak ada perputaran, denyut, atau transisi masuk (DESIGN.md §2).
 *   - **Tidak ada pesan galat teknis.** Seluruh pesan datang dari
 *     `ERROR_CATALOG`, yang sudah disusun untuk dibaca pengrajin.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { actionLabel } from "@/lib/errors";
import { readAccessToken, writeAccessToken, writeRefreshToken } from "@/lib/session";

import styles from "../create/flow.module.css";
import { requestOtp, verifyOtp } from "../create/api";
import { CheckIcon, ClockIcon, KeyIcon, PhoneIcon, WarningIcon } from "../create/icons";
import login from "./masuk.module.css";
import { formatWait, normalizePhone } from "./phone";

type Stage = "phone" | "code";

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<string>("");
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const codeRef = useRef<HTMLInputElement | null>(null);

  // Pengrajin yang sudah punya sesi tidak perlu melihat layar ini. Diperiksa
  // di klien, bukan di server: tokennya hidup di `localStorage`, dan server
  // tidak dapat membacanya.
  useEffect(() => {
    if (readAccessToken() !== null) router.replace("/create");
  }, [router]);

  // Hitungan mundur berjalan hanya selagi batas kirim ulang belum lewat.
  // Timer yang berjalan selamanya adalah pekerjaan yang tidak menghasilkan
  // apa pun, dan pada perangkat kelas bawah itu terasa.
  useEffect(() => {
    if (resendAt === null) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [resendAt]);

  // Fokus dipindahkan ke kotak kode begitu langkahnya berganti. Tanpa ini
  // pengguna pembaca layar mendarat di awal halaman dan harus menelusuri
  // ulang seluruh isinya.
  useEffect(() => {
    if (stage === "code") codeRef.current?.focus();
  }, [stage]);

  const waitMs = resendAt === null ? 0 : Math.max(0, resendAt - now);

  const submitPhone = async (): Promise<void> => {
    const normalized = normalizePhone(phone);
    if (normalized === null) {
      setMessage("Nomor telepon belum lengkap. Tulis nomor ponsel Indonesia, misalnya 0812 3456 7890.");
      setAction("");
      return;
    }

    setBusy(true);
    setMessage(null);

    const result = await requestOtp(normalized);

    setBusy(false);

    if (!result.ok) {
      setMessage(result.error.message);
      setAction(result.error.action);
      return;
    }

    setPhone(normalized);
    setStage("code");
    setResendAt(result.data.resendAfter);
    setNow(Date.now());
  };

  const submitCode = async (): Promise<void> => {
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setMessage("Kode terdiri dari enam angka. Periksa kembali kode yang Anda terima.");
      setAction("");
      return;
    }

    setBusy(true);
    setMessage(null);

    const result = await verifyOtp(phone, digits);

    setBusy(false);

    if (!result.ok) {
      setMessage(result.error.message);
      setAction(result.error.action);
      return;
    }

    // Yang disimpan hanyalah tokennya. Peran dan izin tidak ikut — otorisasi
    // hanya di server, dan apa pun di sini dapat disunting dari konsol
    // peramban (TC-SEC-05).
    writeAccessToken(result.data.accessToken);
    writeRefreshToken(result.data.refreshToken);

    router.replace("/create");
  };

  const isPhoneStage = stage === "phone";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.stepIndicator}>Masuk</p>
        <h1 className={styles.title}>
          {isPhoneStage ? "Masuk dengan nomor ponsel" : "Masukkan kode yang dikirim"}
        </h1>
      </header>

      <main className={styles.main}>
        <p className={styles.hint}>
          {isPhoneStage
            ? "Masukkan nomor ponsel (contoh: 081234567890). Tidak perlu kata sandi."
            : `Kode dikirim ke ${phone}. Untuk pengujian demo, Anda bisa langsung ketik 123456.`}
        </p>

        {isPhoneStage ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="nomor">
              Nomor ponsel
            </label>
            <input
              id="nomor"
              className={login.input}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              // Pola masukan dibiarkan longgar; penyaringan dilakukan saat
              // dikirim. Menolak ketikan di tengah jalan membuat pengrajin
              // mengira tombolnya rusak.
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitPhone();
              }}
              placeholder="0812 3456 7890"
              disabled={busy}
            />
          </div>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="kode">
              Kode dari SMS
            </label>
            <input
              id="kode"
              ref={codeRef}
              className={`${login.input} ${login.codeInput}`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitCode();
              }}
              placeholder="123456"
              disabled={busy}
            />
          </div>
        )}

        {message === null ? null : (
          // role="alert" supaya pesannya dibacakan begitu muncul, tanpa
          // menuntut pengguna menemukannya sendiri.
          <div className={styles.errorBanner} role="alert">
            <span className={styles.errorIcon}>
              <WarningIcon />
            </span>
            <div className={styles.errorBody}>
              <p>{message}</p>
              {/*
                Label yang dibaca pengrajin, bukan kode aksinya. Aksi tanpa
                label tidak dirender sama sekali: baris kosong di bawah pesan
                hanya menambah kebisingan di layar yang sedang bermasalah.
              */}
              {actionLabel(action) === "" ? null : (
                <p className={styles.errorAction}>{actionLabel(action)}</p>
              )}
            </div>
          </div>
        )}

        {isPhoneStage ? null : (
          <p className={styles.saveIndicator} role="status" aria-live="polite">
            <ClockIcon size={20} />
            {waitMs > 0
              ? `Belum menerima kode? Anda dapat meminta lagi dalam ${formatWait(waitMs)}.`
              : "Belum menerima kode? Anda dapat meminta kode baru sekarang."}
          </p>
        )}
      </main>

      <footer className={styles.footer}>
        {isPhoneStage ? (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              void submitPhone();
            }}
            disabled={busy}
            aria-busy={busy}
          >
            <PhoneIcon />
            {busy ? "Mengirim kode..." : "Kirim kode"}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              void submitCode();
            }}
            disabled={busy}
            aria-busy={busy}
          >
            <KeyIcon />
            {busy ? "Memeriksa kode..." : "Masuk"}
          </button>
        )}

        {isPhoneStage ? null : (
          <>
            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => {
                void submitPhone();
              }}
              disabled={busy || waitMs > 0}
            >
              <PhoneIcon size={20} />
              {waitMs > 0 ? `Kirim ulang dalam ${formatWait(waitMs)}` : "Kirim ulang kode"}
            </button>

            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => {
                setStage("phone");
                setCode("");
                setMessage(null);
                setAction("");
              }}
              disabled={busy}
            >
              <CheckIcon size={20} />
              Ganti nomor ponsel
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
