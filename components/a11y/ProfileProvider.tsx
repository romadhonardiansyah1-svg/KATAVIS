"use client";

/**
 * Accessibility Mode — keadaan dan penyimpanannya.
 *
 * Satu tombol, lima profil, dan profilnya **dapat digabung** (S1-02).
 * Pengguna tunarungu dengan keterbatasan motorik memilih keduanya, jadi
 * keadaannya adalah lima nilai boolean yang berdiri sendiri, bukan satu
 * pilihan dari lima.
 *
 * Pilihan disimpan di **server** lewat `PUT /me/a11y-profile`, bukan hanya
 * di peramban: pengrajin yang berpindah perangkat harus menemukan
 * pengaturannya seperti ia meninggalkannya (S1-03, TC-I-13). Salinan di
 * `localStorage` hanyalah cermin untuk render pertama — bila keduanya
 * berbeda, server yang benar, dan server yang menimpanya.
 *
 * Tidak ada endpoint baca untuk profil ini di kontrak API. Nilainya kembali
 * lewat `POST /auth/otp/verify` (bidang `user.a11yProfile`) saat pengrajin
 * masuk, dan dari sanalah `initialProfile` diisi.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ERROR_CATALOG } from "@/lib/errors";
import { A11yProfileSchema, type A11yProfile } from "@/lib/schemas";
import { readAccessToken } from "@/lib/session";

export type ProfileKey = keyof A11yProfile;

/** Urutannya tetap: tampilan daftar mengikuti urutan ini. */
export const PROFILE_KEYS: readonly ProfileKey[] = [
  "visual",
  "hearing",
  "motor",
  "cognitive",
  "voice",
];

export const NO_PROFILE: A11yProfile = {
  visual: false,
  hearing: false,
  motor: false,
  cognitive: false,
  voice: false,
};

/**
 * Cermin lokal.
 *
 * Bukan sumber kebenaran. Ia ada supaya pengaturan yang sudah dipilih tidak
 * berkedip kembali ke bawaan selama permintaan ke server berjalan.
 */
const MIRROR_KEY = "katavis.a11yProfile";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

export interface ProfileMessage {
  readonly message: string;
  readonly action: string;
}

export interface ProfileState {
  readonly profile: A11yProfile;
  readonly isSaving: boolean;
  readonly savedAt: number | null;
  readonly error: ProfileMessage | null;
  readonly isReady: boolean;
  toggle(key: ProfileKey): void;
  reset(): void;
}

const ProfileContext = createContext<ProfileState | null>(null);

function readMirror(): A11yProfile | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(MIRROR_KEY);
  if (raw === null) return null;

  try {
    const parsed = A11yProfileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // Cermin yang rusak diperlakukan sebagai belum ada. Ia bukan sumber
    // kebenaran, jadi membuangnya tidak menghilangkan pilihan pengrajin —
    // server masih menyimpannya.
    return null;
  }
}

function writeMirror(profile: A11yProfile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MIRROR_KEY, JSON.stringify(profile));
}

/**
 * Menempelkan profil ke elemen akar.
 *
 * Inilah yang membuat `tokens.css` bekerja: `[data-a11y-visual="true"]`
 * menaikkan ukuran teks dan target, `[data-a11y-motor="true"]` memperbesar
 * target dan jaraknya. Nilainya ditulis "true"/"false", bukan ada/tidak ada,
 * supaya keadaan kelima profil dapat diperiksa langsung saat penelusuran.
 */
function applyProfile(profile: A11yProfile): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  for (const key of PROFILE_KEYS) {
    const attribute = `a11y${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    root.dataset[attribute] = profile[key] ? "true" : "false";
  }
}

async function saveProfile(profile: A11yProfile): Promise<ProfileMessage | null> {
  const token = readAccessToken();
  if (token === null) {
    return {
      message: ERROR_CATALOG.UNAUTHENTICATED.message,
      action: ERROR_CATALOG.UNAUTHENTICATED.action,
    };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/me/a11y-profile`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });

    if (response.ok) return null;

    const body: unknown = await response.json().catch(() => null);
    const error = (body as { error?: { code?: string; message?: string; action?: string } } | null)
      ?.error;

    if (typeof error?.message === "string" && typeof error.action === "string") {
      return { message: error.message, action: error.action };
    }

    return {
      message: ERROR_CATALOG.INTERNAL_ERROR.message,
      action: ERROR_CATALOG.INTERNAL_ERROR.action,
    };
  } catch {
    // Pengaturan tetap berlaku di perangkat ini; yang gagal hanya
    // penyimpanannya ke server. Pengrajin diberi tahu, pekerjaannya tidak.
    return {
      message: ERROR_CATALOG.NETWORK_OFFLINE.message,
      action: ERROR_CATALOG.NETWORK_OFFLINE.action,
    };
  }
}

export function ProfileProvider({
  children,
  initialProfile,
}: {
  readonly children: React.ReactNode;
  /** Dari `POST /auth/otp/verify`. Server yang benar bila berbeda dengan cermin. */
  readonly initialProfile?: A11yProfile | undefined;
}): React.JSX.Element {
  const [profile, setProfile] = useState<A11yProfile>(initialProfile ?? NO_PROFILE);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<ProfileMessage | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Render pertama selalu bawaan, supaya HTML dari server dan HTML dari
  // peramban sama dan tidak ada ketidakcocokan hidrasi. Profil yang
  // tersimpan dipasang sesudahnya, di efek.
  useEffect(() => {
    const restored = initialProfile ?? readMirror() ?? NO_PROFILE;
    setProfile(restored);
    applyProfile(restored);
    setIsReady(true);
  }, [initialProfile]);

  const toggle = useCallback((key: ProfileKey): void => {
    setProfile((current) => {
      const next: A11yProfile = { ...current, [key]: !current[key] };

      applyProfile(next);
      writeMirror(next);
      setIsSaving(true);
      setError(null);

      void saveProfile(next).then((failure) => {
        setIsSaving(false);
        if (failure === null) {
          setSavedAt(Date.now());
        } else {
          setError(failure);
        }
      });

      return next;
    });
  }, []);

  const reset = useCallback((): void => {
    setProfile(NO_PROFILE);
    applyProfile(NO_PROFILE);
    writeMirror(NO_PROFILE);
    setIsSaving(true);
    setError(null);

    void saveProfile(NO_PROFILE).then((failure) => {
      setIsSaving(false);
      if (failure === null) setSavedAt(Date.now());
      else setError(failure);
    });
  }, []);

  const value = useMemo<ProfileState>(
    () => ({ profile, isSaving, savedAt, error, isReady, toggle, reset }),
    [profile, isSaving, savedAt, error, isReady, toggle, reset],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/**
 * Keadaan Accessibility Mode.
 *
 * Melempar bila dipakai di luar penyedianya: itu cacat perakitan, bukan
 * keadaan yang perlu ditangani di setiap pemanggil.
 */
export function useAccessibilityProfile(): ProfileState {
  const context = useContext(ProfileContext);
  if (context === null) {
    throw new Error("useAccessibilityProfile dipakai di luar ProfileProvider");
  }
  return context;
}
