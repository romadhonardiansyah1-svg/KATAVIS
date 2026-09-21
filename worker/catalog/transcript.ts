/**
 * Transkrip: simpan, tinjau, sunting.
 *
 * Berkas ini menegakkan ADR-008. Keputusannya: satu layar disisipkan antara
 * ASR dan LLM, tempat pengrajin melihat dan mengoreksi transkrip sebelum
 * diteruskan.
 *
 * Alasannya bukan kesopanan, melainkan aritmetika kesalahan. Satu nama
 * produk yang salah dengar akan muncul di cerita, spesifikasi, caption
 * media sosial, kata kunci SEO, dan lima bahasa terjemahan. Memperbaiki di
 * hilir berarti menyunting belasan bidang; memperbaiki di hulu berarti
 * menyunting satu kalimat.
 *
 * Karena itu `reviewed` bukan sekadar penanda di antarmuka. Ia diperiksa
 * server, dan `POST /products/:id/generate` ditolak tanpanya — ADR-008
 * menyebutnya eksplisit: "di tingkat server, bukan hanya di antarmuka".
 */

import { ulid } from "ulid";

import type { ErrorCode } from "../../lib/errors";
import {
  LocaleSchema,
  TranscriptPutSchema,
  type Locale,
} from "../../lib/schemas";

import type { Db } from "../db";

export interface TranscriptRecord {
  readonly text: string;
  readonly locale: Locale;
  /** Sudah dilihat dan disetujui pengrajin. Gerbang ADR-008. */
  readonly reviewed: boolean;
  /** Pernah disentuh manusia. Sekali menyala, tidak padam lagi. */
  readonly edited: boolean;
  readonly provider: string | null;
  readonly durationMs: number | null;
}

export interface AsrTranscriptInput {
  readonly text: string;
  readonly locale: Locale;
  readonly provider: string;
  readonly durationMs: number;
}

interface TranscriptRow {
  readonly text: string;
  readonly locale: string;
  readonly reviewed: number;
  readonly edited: number;
  readonly provider: string | null;
  readonly duration_ms: number | null;
}

function toRecord(row: TranscriptRow): TranscriptRecord | null {
  const locale = LocaleSchema.safeParse(row.locale);
  if (!locale.success) return null;

  return {
    text: row.text,
    locale: locale.data,
    reviewed: row.reviewed === 1,
    edited: row.edited === 1,
    provider: row.provider,
    durationMs: row.duration_ms,
  };
}

export async function loadTranscript(
  db: Db,
  productId: string,
): Promise<TranscriptRecord | null> {
  const row = await db.first<TranscriptRow>({
    query: `SELECT text, locale, reviewed, edited, provider, duration_ms
            FROM transcripts WHERE product_id = ?`,
    params: [productId],
  });

  return row === null ? null : toRecord(row);
}

/**
 * Menyimpan hasil ASR mentah.
 *
 * Selalu `reviewed = 0`, termasuk saat menimpa transkrip lama. Merekam ulang
 * menghasilkan teks baru, dan teks baru belum pernah dibaca siapa pun —
 * membiarkan `reviewed` menyala dari rekaman sebelumnya akan meloloskan
 * transkrip yang tidak pernah diperiksa melewati gerbang ADR-008.
 */
export async function storeAsrTranscript(
  db: Db,
  productId: string,
  input: AsrTranscriptInput,
  nowMs: number,
): Promise<void> {
  await db.run({
    query: `INSERT INTO transcripts
              (id, product_id, text, locale, reviewed, edited, provider, duration_ms, created_at)
            VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE SET
              text = excluded.text,
              locale = excluded.locale,
              reviewed = 0,
              edited = 0,
              provider = excluded.provider,
              duration_ms = excluded.duration_ms,
              reviewed_at = NULL`,
    params: [
      ulid(),
      productId,
      input.text,
      input.locale,
      input.provider,
      input.durationMs,
      nowMs,
    ],
  });
}

export type TranscriptSubmitResult =
  | { readonly ok: true; readonly transcript: TranscriptRecord | null }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Menyimpan hasil tinjauan: `PUT /products/:id/transcript`.
 *
 * Inilah aksi "Sudah benar, lanjutkan" pada layar tinjau ADR-008. Ia
 * menyalakan `reviewed`, dan itulah satu-satunya cara menyalakannya.
 *
 * `edited` bersifat menetap: sekali pengrajin mengubah teksnya, penanda itu
 * tidak padam meski ia kemudian menekan simpan lagi tanpa perubahan. Yang
 * ditandai adalah "pernah disentuh manusia", dan mengembalikannya ke nol
 * akan menghapus jejak itu.
 */
export async function submitTranscript(
  db: Db,
  productId: string,
  text: string,
  nowMs: number,
): Promise<TranscriptSubmitResult> {
  const parsed = TranscriptPutSchema.safeParse({ text });
  if (!parsed.success) return { ok: false, code: "TRANSCRIPT_NOT_REVIEWED" };

  const existing = await loadTranscript(db, productId);
  // Tidak ada transkrip berarti tidak ada yang dapat ditinjau. Menolaknya
  // lebih benar daripada membuat baris kosong yang tampak sudah diperiksa.
  if (existing === null) return { ok: false, code: "NOT_FOUND" };

  const edited = existing.edited || existing.text !== parsed.data.text;

  await db.run({
    query: `UPDATE transcripts
            SET text = ?, edited = ?, reviewed = 1, reviewed_at = ?
            WHERE product_id = ?`,
    params: [parsed.data.text, edited ? 1 : 0, nowMs, productId],
  });

  return { ok: true, transcript: await loadTranscript(db, productId) };
}

/**
 * Gerbang ADR-008.
 *
 * `null` berarti transkrip sudah ditinjau dan pemrosesan boleh berlanjut;
 * selain itu `TRANSCRIPT_NOT_REVIEWED`.
 *
 * Transkrip yang tidak ada diperlakukan sebagai belum ditinjau. Tidak ada
 * yang lebih mudah dilupakan daripada jalur "belum ada datanya", dan di
 * sanalah gerbang yang gagal-terbuka akan lolos.
 */
export async function requireReviewedTranscript(
  db: Db,
  productId: string,
): Promise<ErrorCode | null> {
  const transcript = await loadTranscript(db, productId);
  if (transcript === null) return "TRANSCRIPT_NOT_REVIEWED";
  return transcript.reviewed ? null : "TRANSCRIPT_NOT_REVIEWED";
}
