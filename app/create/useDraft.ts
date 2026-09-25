"use client";

/**
 * Alur enam langkah: pemuatan draf, penyimpanan otomatis, dan penjagaan
 * urutan langkah.
 *
 * Dua aturan S2 dan S5 bertemu di berkas ini:
 *
 *   - **Melompati langkah ditolak, termasuk lewat URL** (S2-04). Setiap
 *     halaman memanggil `useCreateFlow(step)`, dan bila syarat langkah itu
 *     belum terpenuhi, pengrajin diarahkan ke langkah terjauh yang memang
 *     boleh ia buka — bukan ke halaman galat.
 *   - **Draf tersimpan setiap 5 detik dan pada setiap perpindahan langkah**
 *     (S5-01). Mundur ke langkah sebelumnya tidak menghapus pekerjaan
 *     (S2-03), karena tidak ada yang pernah menghapus drafnya.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { readAccessToken } from "@/lib/session";
import { readDraft, writeDraft } from "./draft-store";
import {
  EMPTY_DRAFT,
  canOpenStep,
  furthestAllowedStep,
  stepPath,
  withDraftChange,
  type Draft,
  type StepId,
} from "./flow";

/** S5-01. */
export const AUTOSAVE_INTERVAL_MS = 5_000;

export interface CreateFlow {
  /** null selama draf masih dimuat, atau selama pengalihan langkah berjalan. */
  readonly draft: Draft | null;
  /** Waktu penyimpanan terakhir, untuk indikator "Tersimpan pukul ...". */
  readonly savedAt: number | null;
  readonly isSaving: boolean;
  update(patch: Partial<Draft>): void;
  saveNow(): Promise<void>;
  /** Menyimpan lebih dulu, lalu berpindah langkah. */
  goTo(step: StepId): Promise<void>;
}

export function useCreateFlow(step: StepId): CreateFlow {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Draf terbaru disimpan di ref juga: interval penyimpanan membacanya tanpa
  // perlu dipasang ulang setiap kali pengrajin mengetik satu huruf.
  const draftRef = useRef<Draft>(EMPTY_DRAFT);
  const dirtyRef = useRef(false);
  const redirectedRef = useRef(false);

  const persist = useCallback(async (): Promise<void> => {
    if (!dirtyRef.current) return;

    setIsSaving(true);
    await writeDraft(draftRef.current);
    dirtyRef.current = false;
    setIsSaving(false);
    setSavedAt(Date.now());
  }, []);

  const update = useCallback((patch: Partial<Draft>): void => {
    const next = withDraftChange(draftRef.current, patch, Date.now());
    draftRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
  }, []);

  const saveNow = useCallback(async (): Promise<void> => {
    await persist();
  }, [persist]);

  const goTo = useCallback(
    async (next: StepId): Promise<void> => {
      // Perpindahan langkah adalah titik penyimpanan wajib (S5). Tanpa ini,
      // draf yang diubah dalam lima detik terakhir hilang saat berpindah.
      await persist();
      router.push(stepPath(next));
    },
    [persist, router],
  );

  useEffect(() => {
    if (readAccessToken() === null) {
      router.replace("/masuk");
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    void readDraft().then((stored) => {
      if (cancelled) return;

      const loaded = stored ?? EMPTY_DRAFT;
      draftRef.current = loaded;

      // S2-04. Lompatan lewat URL berakhir di sini: syaratnya tidak
      // terpenuhi, dan pengrajin dikembalikan ke langkah terjauh yang sah.
      if (!canOpenStep(loaded, step)) {
        redirectedRef.current = true;
        router.replace(stepPath(furthestAllowedStep(loaded)));
        return;
      }

      setDraft(loaded);

      // Indikator "Tersimpan pukul ..." harus menyala begitu draf lama
      // dimuat — bukan hanya setelah ada suntingan baru. Tanpa ini,
      // TC-E2E-23 melihat "Belum ada perubahan" meskipun drafnya sudah
      // pernah tersimpan sebelumnya.
      if (loaded.updatedAt > 0) {
        setSavedAt(loaded.updatedAt);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router, step]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void persist();
    }, AUTOSAVE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [persist]);

  // Menutup tab juga merupakan perpindahan: pekerjaan yang belum tersimpan
  // ikut ditulis saat halaman ditinggalkan.
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") void persist();
    };

    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [persist]);

  return { draft, savedAt, isSaving, update, saveNow, goTo };
}
