/**
 * Persetujuan pengguna.
 *
 * Dua persetujuan yang mengikat seluruh alur:
 *
 *   `audio_processing` — rekaman suara boleh dikirim ke penyedia ASR.
 *   `publication`      — karya boleh tampil di katalog publik.
 *
 * Keduanya diperiksa di **server**, bukan di antarmuka. Platform ini
 * menyimpan rekaman suara dan foto milik kelompok rentan; persetujuan yang
 * hanya ditegakkan tombol di layar bukan persetujuan (PRD bagian 6).
 *
 * Bentuknya sendiri (`ConsentSchema`) sudah ada di lib/schemas.ts, jadi
 * tidak ada skema baru di sini.
 */

import { ulid } from "ulid";
import type { z } from "zod";

import type { ErrorCode } from "../../lib/errors";
import { ConsentSchema } from "../../lib/schemas";

import type { Db } from "../db";

/**
 * Diturunkan dari `ConsentSchema`, bukan ditulis ulang.
 *
 * lib/schemas.ts tidak mengekspor tipe turunan untuk persetujuan, dan
 * menambahkannya berarti mengubah berkas yang dilindungi. Menurunkan dari
 * skema yang sudah ada memberi tipe yang sama tanpa menambah apa pun.
 */
export type ConsentKind = z.infer<typeof ConsentSchema>["kind"];

export interface ConsentState {
  readonly audioProcessing: boolean;
  readonly publication: boolean;
}

/**
 * Seluruh izin mati secara bawaan.
 *
 * Pengrajin menyalakan yang dibutuhkan, bukan mematikan yang tidak. Ini
 * prinsip yang sama dengan izin pendamping di FEATURE-SPECS S3, dan
 * alasannya sama: bawaan yang menyala mudah terlewat.
 */
export const NO_CONSENT: ConsentState = {
  audioProcessing: false,
  publication: false,
};

export function hasConsent(state: ConsentState, kind: ConsentKind): boolean {
  return kind === "audio_processing" ? state.audioProcessing : state.publication;
}

interface ConsentRow {
  readonly kind: string;
  readonly granted: number;
}

/**
 * Membaca kedua persetujuan sekaligus.
 *
 * Satu kueri, bukan dua: keduanya selalu dibutuhkan bersama, dan tabelnya
 * berisi paling banyak dua baris per pengguna.
 */
export async function loadConsents(db: Db, userId: string): Promise<ConsentState> {
  const rows = await db.all<ConsentRow>({
    query: "SELECT kind, granted FROM consents WHERE user_id = ?",
    params: [userId],
  });

  let audioProcessing = false;
  let publication = false;

  for (const row of rows) {
    if (row.kind === "audio_processing") audioProcessing = row.granted === 1;
    if (row.kind === "publication") publication = row.granted === 1;
  }

  return { audioProcessing, publication };
}

export interface ConsentChange {
  readonly kind: ConsentKind;
  readonly granted: boolean;
}

export type ConsentResult =
  | { readonly ok: true; readonly state: ConsentState }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Menyalakan atau mematikan satu persetujuan.
 *
 * Memakai `ON CONFLICT(user_id, kind)` mengikuti UNIQUE di migrations/0001,
 * sehingga pengguna yang membuka layar persetujuan dua kali tidak
 * meninggalkan dua baris yang saling bertentangan.
 *
 * Pencabutan mengisi `revoked_at` dan mengosongkan `granted_at`: riwayat
 * kapan sesuatu disetujui tetap terbaca, dan itu yang diminta saat
 * pengrajin bertanya "sejak kapan karya saya boleh terbit?".
 */
export async function setConsent(
  db: Db,
  userId: string,
  change: ConsentChange,
  nowMs: number,
): Promise<ConsentResult> {
  const parsed = ConsentSchema.safeParse({
    kind: change.kind,
    granted: change.granted,
  });
  if (!parsed.success) return { ok: false, code: "CONSENT_REQUIRED" };

  await db.run({
    query: `INSERT INTO consents (id, user_id, kind, granted, granted_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, kind) DO UPDATE SET
              granted = excluded.granted,
              granted_at = excluded.granted_at,
              revoked_at = excluded.revoked_at`,
    params: [
      ulid(),
      userId,
      parsed.data.kind,
      parsed.data.granted ? 1 : 0,
      parsed.data.granted ? nowMs : null,
      parsed.data.granted ? null : nowMs,
    ],
  });

  return { ok: true, state: await loadConsents(db, userId) };
}

/**
 * Memastikan sebuah persetujuan sudah ada, atau mengembalikan kode galatnya.
 *
 * Dipakai di dua tempat yang berbeda jenisnya: `POST /products/:id/audio`
 * menolak perekaman tanpa `audio_processing`, dan `POST /products/:id/publish`
 * menolak penerbitan tanpa `publication`. Keduanya memakai kode yang sama —
 * katalog galat hanya punya satu kode untuk persetujuan, dan itu memang
 * cukup: yang perlu diketahui pengrajin adalah persetujuan mana yang
 * diminta, dan itu disampaikan antarmuka dari konteksnya.
 */
export async function requireConsent(
  db: Db,
  userId: string,
  kind: ConsentKind,
): Promise<ErrorCode | null> {
  const state = await loadConsents(db, userId);
  return hasConsent(state, kind) ? null : "CONSENT_REQUIRED";
}
