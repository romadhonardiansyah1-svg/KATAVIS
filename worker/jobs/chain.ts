/**
 * Rantai fallback dengan batas waktu.
 *
 * Aturan yang mengikat seluruh berkas ini (prompt P2, ADR-004):
 *
 *   1. Batas waktu memakai AbortController. Penyedia menerima signal dan
 *      wajib mematuhinya.
 *   2. Hasil yang datang SETELAH batas waktu diabaikan sepenuhnya. Ia tidak
 *      boleh menimpa hasil penyedia berikutnya. Karena itu hasil diambil
 *      dari `Promise.race` yang sudah selesai — bukan dari variabel bersama
 *      yang bisa ditulis ulang oleh pemenang yang kalah.
 *   3. `Promise.race` dipakai bersama pembatalan, bukan sendirian.
 *      Race tanpa abort membuat penyedia yang kalah tetap berjalan dan
 *      membuang jatah neuron.
 *   4. Galat keluar sebagai `ErrorCode` dari lib/errors.ts, tidak pernah
 *      sebagai pesan mentah penyedia.
 *
 * Berkas ini tidak menyentuh D1 maupun R2. Seluruh kasus ujinya berjalan
 * di Node tanpa basis data.
 */

import { apiError, type ErrorCode } from "../../lib/errors";
import type { Locale } from "../../lib/schemas";
import {
  IMAGE_CHAIN,
  ProviderError,
  TEXT_CHAIN,
  TRANSCRIPTION_CHAIN,
  type Content,
  type ContentRequest,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  type ProviderId,
  type TextProvider,
  type Transcript,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from "./providers";

// --- Bentuk hasil ---

export interface ChainStep<TValue> {
  readonly id: ProviderId;
  readonly timeoutMs: number;
  run(signal: AbortSignal): Promise<TValue>;
}

export interface JobFailure {
  readonly code: ErrorCode;
  /** Lapis terakhir yang dicoba. null bila rantai tidak punya langkah sama sekali. */
  readonly provider: ProviderId | null;
  /** Berapa lapis rantai yang dicoba pada percobaan ini. */
  readonly layersTried: number;
  /**
   * Keterangan dari penyedia, untuk log saja.
   *
   * Ia TIDAK pernah masuk `jobs.error_code` dan TIDAK pernah masuk respons.
   * Yang disimpan dan ditampilkan hanyalah `code` — itulah yang membuat
   * "Error 500" tidak pernah sampai ke pengrajin (TC-U-JOB-06).
   */
  readonly diagnostic: string;
}

export type ChainOutcome<TValue> =
  | {
      readonly ok: true;
      readonly value: TValue;
      readonly provider: ProviderId;
      readonly layersTried: number;
      readonly durationMs: number;
    }
  | { readonly ok: false; readonly failure: JobFailure };

export interface LocaleOutcome<TValue> {
  readonly locale: Locale;
  readonly outcome: ChainOutcome<TValue>;
}

// --- Pemetaan galat ---

/**
 * Status HTTP yang punya kode galat khusus di kontrak API bagian 12.
 *
 * Sengaja hanya dua. Status lain tidak dipetakan ke kode yang kebetulan
 * mirip: pemetaan yang mengarang akan mengubah "penyedia gagal" menjadi
 * klaim yang tidak benar tentang penyebabnya.
 */
const HTTP_STATUS_TO_ERROR_CODE: Readonly<Record<number, ErrorCode>> = {
  429: "RATE_LIMITED",
  503: "QUOTA_EXCEEDED",
};

class StepDeadlineExceeded extends Error {
  constructor(readonly providerId: ProviderId) {
    super(`Batas waktu lapis ${providerId} terlampaui`);
    this.name = "StepDeadlineExceeded";
  }
}

function describeUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Penyedia gagal tanpa keterangan.";
}

/** Galat yang tidak berasal dari penyedia. Dipakai saat pemanggil sendiri meledak. */
export function unexpectedFailure(error: unknown): JobFailure {
  return {
    code: "INTERNAL_ERROR",
    provider: null,
    layersTried: 0,
    diagnostic: describeUnknown(error),
  };
}

// --- Inti rantai ---

type StepOutcome<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | {
      readonly ok: false;
      /** Kode khusus bila penyedia memberi status yang dikenali; null bila tidak. */
      readonly code: ErrorCode | null;
      readonly diagnostic: string;
    };

/**
 * Satu langkah rantai.
 *
 * Dua hal yang membuat fungsi ini pendek dan sulit dirusak:
 *   - `deadline` menolak tepat saat timer berbunyi, jadi rantai tidak
 *     menggantung pada penyedia yang mengabaikan signal.
 *   - `clearTimeout` di `finally` memastikan timer tidak pernah bocor ke
 *     langkah berikutnya.
 */
async function runStep<TValue>(step: ChainStep<TValue>): Promise<StepOutcome<TValue>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new StepDeadlineExceeded(step.id));
    }, step.timeoutMs);
  });

  try {
    // Pemenang balapan diambil dari sini. Pihak yang kalah — termasuk
    // penyedia yang menjawab setelah dibatalkan — tidak punya jalan untuk
    // menulis apa pun ke hasil.
    const value = await Promise.race([step.run(controller.signal), deadline]);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof StepDeadlineExceeded) {
      return {
        ok: false,
        code: null,
        diagnostic: `Batas waktu ${step.timeoutMs} ms pada lapis ${step.id} terlampaui.`,
      };
    }
    if (error instanceof ProviderError) {
      return {
        ok: false,
        code: HTTP_STATUS_TO_ERROR_CODE[error.status] ?? null,
        diagnostic: error.diagnostic,
      };
    }
    return { ok: false, code: null, diagnostic: describeUnknown(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Menjalankan rantai sampai ada lapis yang berhasil.
 *
 * `exhaustedCode` adalah kode yang dipakai bila seluruh lapis gagal tanpa
 * sebab yang dikenali — ditetapkan pemanggil sesuai jenis pekerjaan
 * (`IMAGE_GENERATE_FAILED`, `COPY_GENERATE_FAILED`), karena rantai ini
 * sendiri tidak tahu ia sedang membuat gambar atau cerita.
 *
 * Bila ada lapis yang melaporkan status yang dikenali (429, 503), kode itu
 * yang menang: "sistem sedang sibuk" lebih benar daripada "gambar gagal
 * dibuat" ketika penyebabnya memang kuota.
 */
export async function runProviderChain<TValue>(
  steps: readonly ChainStep<TValue>[],
  exhaustedCode: ErrorCode,
): Promise<ChainOutcome<TValue>> {
  const startedAt = Date.now();
  let layersTried = 0;
  let lastProvider: ProviderId | null = null;
  let specificCode: ErrorCode | null = null;
  let diagnostic = "Tidak ada penyedia yang terdaftar pada rantai ini.";

  for (const step of steps) {
    layersTried += 1;
    lastProvider = step.id;

    const attempt = await runStep(step);

    if (attempt.ok) {
      return {
        ok: true,
        value: attempt.value,
        provider: step.id,
        layersTried,
        durationMs: Date.now() - startedAt,
      };
    }

    diagnostic = attempt.diagnostic;
    if (attempt.code !== null) specificCode = attempt.code;
  }

  return {
    ok: false,
    failure: {
      code: specificCode ?? exhaustedCode,
      provider: lastProvider,
      layersTried,
      diagnostic,
    },
  };
}

/**
 * Menjalankan pekerjaan per bahasa, terpisah satu sama lain.
 *
 * Setiap bahasa adalah pekerjaan sendiri dengan baris `product_content`
 * sendiri (ARCHITECTURE bagian 6). Karena itu kegagalan satu bahasa tidak
 * boleh menggagalkan yang lain: seluruh bahasa tetap dijalankan, dan
 * hasilnya dikumpulkan lengkap — bukan dihentikan pada kegagalan pertama.
 * Diuji di TC-U-JOB-10.
 */
export async function runPerLocale<TValue>(
  locales: readonly Locale[],
  runForLocale: (locale: Locale) => Promise<ChainOutcome<TValue>>,
): Promise<readonly LocaleOutcome<TValue>[]> {
  return Promise.all(
    locales.map(async (locale): Promise<LocaleOutcome<TValue>> => {
      try {
        return { locale, outcome: await runForLocale(locale) };
      } catch (error) {
        // Pemanggil yang meledak tetap menjadi galat terstruktur, dan
        // bahasa lain tidak ikut berhenti.
        return { locale, outcome: { ok: false, failure: unexpectedFailure(error) } };
      }
    }),
  );
}

// --- Penyusunan langkah ---

interface ChainableProvider {
  readonly id: ProviderId;
  readonly timeoutMs: number;
}

function buildChain<TProvider extends ChainableProvider, TValue>(
  order: readonly ProviderId[],
  providers: readonly TProvider[],
  invoke: (provider: TProvider, signal: AbortSignal) => Promise<TValue>,
): readonly ChainStep<TValue>[] {
  const steps: ChainStep<TValue>[] = [];

  for (const id of order) {
    const provider = providers.find((candidate) => candidate.id === id);
    // Penyedia yang tidak terdaftar dilewati, bukan menggagalkan rantai.
    // Tanpa Studio Agent yang hidup, lapis 1 memang tidak ada.
    if (provider === undefined) continue;

    steps.push({
      id,
      timeoutMs: provider.timeoutMs,
      run: (signal) => invoke(provider, signal),
    });
  }

  return steps;
}

export function imageChainSteps(
  providers: readonly ImageProvider[],
  request: Omit<ImageRequest, "signal">,
): readonly ChainStep<ImageResult>[] {
  return buildChain(IMAGE_CHAIN, providers, (provider, signal) =>
    provider.generate({ ...request, signal }),
  );
}

export function transcriptionChainSteps(
  providers: readonly TranscriptionProvider[],
  request: Omit<TranscriptionRequest, "signal">,
): readonly ChainStep<Transcript>[] {
  return buildChain(TRANSCRIPTION_CHAIN, providers, (provider, signal) =>
    provider.transcribe({ ...request, signal }),
  );
}

export function textChainSteps(
  providers: readonly TextProvider[],
  request: Omit<ContentRequest, "signal">,
): readonly ChainStep<Content>[] {
  return buildChain(TEXT_CHAIN, providers, (provider, signal) =>
    provider.generate({ ...request, signal }),
  );
}

// --- Ke lapisan API ---

/**
 * Mengubah kegagalan menjadi respons API.
 *
 * Hanya `code` yang menentukan pesan. `diagnostic` dari penyedia tidak ikut
 * dengan sengaja — ia boleh memuat "timeout", "500", atau jejak tumpukan,
 * dan tidak satu pun boleh terbaca pengrajin (AGENTS.md aturan 2).
 */
export function failureResponse(failure: JobFailure): Response {
  return apiError(failure.code);
}
