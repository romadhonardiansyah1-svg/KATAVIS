"use client";

/**
 * Pintu masuk `/create`.
 *
 * Mengarahkan ke langkah terjauh yang boleh dibuka. Tanpa halaman ini,
 * alamat itu berakhir 404 — dan yang lebih penting, pengrajin yang membuka
 * kembali aplikasinya tidak punya cara menebak harus mulai dari mana.
 *
 * Pengalihannya memakai `replace`, bukan `push`: halaman ini bukan langkah,
 * dan menekan tombol kembali dari langkah pertama tidak boleh kembali ke
 * sini.
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readDraft } from "./draft-store";
import { EMPTY_DRAFT, furthestAllowedStep, stepPath } from "./flow";
import { StepLoading } from "./StepShell";

export default function CreateEntryPage(): React.JSX.Element {
  const router = useRouter();

  useEffect(() => {
    void readDraft().then((stored) => {
      router.replace(stepPath(furthestAllowedStep(stored ?? EMPTY_DRAFT)));
    });
  }, [router]);

  return <StepLoading />;
}
