/**
 * Antarmuka penyedia AI — ARCHITECTURE.md bagian 8.
 *
 * Tiga antarmuka, masing-masing dengan minimal dua implementasi. Tidak ada
 * satu penyedia pun yang, bila mati, menghentikan demo. Itu bukan
 * kesantunan arsitektur: penilaian lomba berupa demo langsung, dan satu
 * penyedia yang mati tanpa cadangan berarti nilai nol.
 *
 * Berkas ini hanya mendefinisikan bentuk. Implementasi konkretnya
 * (memanggil Studio Agent lewat antrian, Workers AI lewat binding `AI`,
 * membaca aset pra-produksi dari R2) menyusul di modul lain.
 */

import type { JobKind, Locale } from "../../lib/schemas";

/**
 * Nilai kolom `provider` pada kontrak API bagian 7 dan `media_assets.provider`
 * pada migrations/0001. Antarmuka tidak menampilkannya ke pengrajin, tetapi
 * ia wajib tercatat — saat demo, inilah yang menjelaskan mengapa satu
 * pekerjaan memakan 28 detik dan yang lain 12 detik.
 */
export type ProviderId =
  | "gemini_web"
  | "workers_ai"
  | "cache"
  | "groq"
  | "9router";

/** Tugas teks yang punya penyedia sendiri (kontrak API bagian 7). */
export type TextTask = Extract<JobKind, "copy" | "tts">;

/**
 * Galat yang dilempar penyedia.
 *
 * Bentuknya sengaja sempit: status HTTP dan keterangan diagnostik.
 * `diagnostic` hanya untuk log — yang pernah sampai ke pengrajin hanyalah
 * `ErrorCode` (lib/errors.ts). Menyimpan pesan penyedia ke basis data lalu
 * menampilkannya adalah salah satu jebakan yang dilarang prompt P2.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly diagnostic: string;

  constructor(status: number, diagnostic: string) {
    super(diagnostic);
    this.name = "ProviderError";
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

// --- Gambar ---

export interface ImageRequest {
  readonly productId: string;
  readonly sourceImageUrl: string;
  readonly stylePrompt: string;
  /** Dibatalkan rantai saat batas waktu terlampaui. Penyedia wajib mematuhinya. */
  readonly signal: AbortSignal;
}

export interface ImageResult {
  /**
   * Kunci objek hasil.
   *
   * Kosong bila penyedia mengembalikan bita alih-alih menunjuk objek yang
   * sudah ada — itulah yang dilakukan penyedia generatif, dan konsumen yang
   * membentuk kuncinya setelah mengunggah. Lapis `cache` justru sebaliknya:
   * ia tidak punya bita sama sekali.
   */
  readonly r2Key: string;
  /** Bita hasil, atau null bila penyedia hanya menunjuk objek yang sudah ada. */
  readonly bytes: Uint8Array | null;
  readonly mimeType: string;
  readonly provider: ProviderId;
  readonly durationMs: number;
}

export interface ImageProvider {
  readonly id: ProviderId;
  /**
   * Batas waktu keras penyedia ini.
   *
   * GeminiWebProvider **wajib** memakai `LIMITS.GEMINI_TIMEOUT_MS` (45 detik,
   * ADR-004). Satu percobaan, lalu menyerah — bukan percobaan ulang tanpa
   * batas. Lapis lain belum diukur, jadi angkanya ditetapkan masing-masing
   * implementasi, bukan dikarang di sini.
   */
  readonly timeoutMs: number;
  generate(request: ImageRequest): Promise<ImageResult>;
}

// --- ASR ---

export interface TranscriptionRequest {
  readonly audioUrl: string;
  readonly audioBytes?: Uint8Array | null;
  readonly locale: Locale;
  readonly signal: AbortSignal;
}

export interface Transcript {
  readonly text: string;
  readonly provider: ProviderId;
  readonly durationMs: number;
}

export interface TranscriptionProvider {
  readonly id: ProviderId;
  readonly timeoutMs: number;
  transcribe(request: TranscriptionRequest): Promise<Transcript>;
}

// --- Teks ---

export interface ContentRequest {
  readonly transcript: string;
  readonly locale: Locale;
  readonly task: TextTask;
  readonly signal: AbortSignal;
}

export interface Content {
  readonly name: string;
  readonly story: string;
  /**
   * Bidang tambahan dari kontrak API bagian 4.
   *
   * `specs`, `socialCopy`, dan `seoKeywords` bukan hiasan: `POST
   * /products/:id/generate` menjadwalkan pekerjaan `copy` justru untuk
   * mengisinya, dan baris `product_content` punya kolomnya masing-masing.
   * Ketiganya opsional-bernilai-null supaya penyedia yang hanya dapat
   * menghasilkan nama dan cerita tetap sah — kekosongan yang jujur lebih
   * baik daripada karangan yang mengisi kolomnya.
   */
  readonly specs: readonly string[];
  readonly socialCopy: string | null;
  readonly seoKeywords: readonly string[];
  readonly provider: ProviderId;
  readonly durationMs: number;
}

export interface TextProvider {
  readonly id: ProviderId;
  readonly timeoutMs: number;
  generate(request: ContentRequest): Promise<Content>;
}

// --- Urutan rantai ---

/**
 * Urutan wajib. Kegagalan atau kelewatan batas waktu pada satu lapis
 * memindahkan pekerjaan ke lapis berikutnya tanpa campur tangan manusia
 * (ADR-004). Mengubah urutan ini berarti mengubah dokumen itu lebih dulu.
 *
 * Penyedia yang tidak terdaftar pada rantai akan dilewati, bukan
 * menggagalkan rantai. Itulah yang membuat agen yang mati tidak
 * memperlambat siapa pun: tanpa Studio Agent, lapis 1 tidak pernah ada
 * dan pekerjaan langsung menuju Workers AI (ARCHITECTURE bagian 4).
 */
export const IMAGE_CHAIN: readonly ProviderId[] = [
  "gemini_web",
  "workers_ai",
  "cache",
];

export const TRANSCRIPTION_CHAIN: readonly ProviderId[] = ["groq", "workers_ai"];

export const TEXT_CHAIN: readonly ProviderId[] = ["9router", "workers_ai"];
