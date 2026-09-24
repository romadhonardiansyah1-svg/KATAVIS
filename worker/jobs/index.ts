/**
 * Ekspor publik modul jobs.
 *
 * Modul lain hanya boleh memanggil lewat berkas ini (ADR-001). Aturannya
 * sendiri terbagi tiga:
 *
 *   providers.ts  bentuk antarmuka penyedia dan urutan rantai yang wajib
 *   chain.ts      rantai fallback, batas waktu, isolasi per bahasa
 *   lifecycle.ts  status, transisi, batas percobaan ulang
 *
 * Konsumen antrian (pekerjaan dari Cloudflare Queues, klaim Studio Agent,
 * penulisan ke D1) belum ada di sini: ia menuntut binding `Env` dan baru
 * punya arti setelah modul `catalog` menulis baris `products`. Yang
 * tersedia sekarang adalah seluruh keputusan yang dibutuhkannya.
 */

export {
  IMAGE_CHAIN,
  ProviderError,
  TEXT_CHAIN,
  TRANSCRIPTION_CHAIN,
} from "./providers";

export type {
  Content,
  ContentRequest,
  ImageProvider,
  ImageRequest,
  ImageResult,
  ProviderId,
  TextProvider,
  TextTask,
  Transcript,
  TranscriptionProvider,
  TranscriptionRequest,
} from "./providers";

export {
  failureResponse,
  imageChainSteps,
  runPerLocale,
  runProviderChain,
  textChainSteps,
  transcriptionChainSteps,
  unexpectedFailure,
} from "./chain";

export type { ChainOutcome, ChainStep, JobFailure, LocaleOutcome } from "./chain";

export {
  JOB_STATUS_TRANSITIONS,
  canRetryJob,
  canTransition,
  isTerminal,
} from "./lifecycle";

// Akses D1 pekerjaan. Terpisah dari aturan siklus hidupnya, yang tetap murni
// dan tidak menyentuh basis data.
export { d1ListJobs, latestJobs, overallProgress } from "./d1-jobs";

export type { JobRecord } from "./d1-jobs";

// Antrian Studio Agent: heartbeat dan klaim pekerjaan.
export {
  d1ClaimImageJobs,
  d1CompleteJob,
  d1FindJob,
  d1InsertJob,
  d1LatestHeartbeat,
  d1RetryJob,
  d1ReturnJobToQueue,
  d1UpsertHeartbeat,
} from "./d1-agent";

export type { AgentHeartbeat, ClaimedJob, LatestHeartbeat } from "./d1-agent";

// Consumer antrian: jalur yang harus bekerja tanpa Studio Agent sama sekali.
export { parseJobMessage, processJob } from "./consumer";

export type { ConsumerDependencies, ConsumerEnv, JobMessage, JobOutcome } from "./consumer";

// Penyedia AI konkret. Bentuknya di `providers.ts`, implementasinya di sini.
export {
  buildCopyPrompt,
  createGroqTextProvider,
  createGroqTranscriptionProvider,
  createNineRouterTextProvider,
  createWorkersAiImageProvider,
  createWorkersAiTextProvider,
  createWorkersAiTranscriptionProvider,
  createCacheImageProvider,
  parseCopyResponse,
} from "./providers-impl";

export { buildImagePrompt, parseImagePayload } from "./payload";

export type { ImageJobPayload } from "./payload";
