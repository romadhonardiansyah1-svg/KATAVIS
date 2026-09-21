/**
 * Ekspor publik modul catalog.
 *
 * Modul lain hanya boleh memanggil lewat berkas ini (ADR-001). Isinya:
 *
 *   products.ts    pembuatan, transisi status, penerbitan, penghapusan,
 *                  permintaan pemrosesan (gerbang ADR-008)
 *   content.ts     konten per bahasa dan penyuntingannya
 *   transcript.ts  simpan, tinjau, dan sunting transkrip
 *   consent.ts     persetujuan audio_processing dan publication
 *
 * Seluruh fungsi tulis memakai `Db` dari `worker/db`, sehingga setiap kueri
 * yang dijalankan modul ini tercatat pada penghitung dan dapat diperiksa
 * terhadap anggaran 25 kueri per invocation (TC-PERF-04).
 *
 * Pemeriksaan izin tidak diduplikasi di sini: ia hidup di `worker/rbac`, dan
 * modul ini hanya menyediakan datanya.
 */

export {
  IDEMPOTENCY_TTL_MS,
  PRODUCT_STATUS_TRANSITIONS,
  canTransition,
  createProduct,
  deleteProduct,
  loadProduct,
  publishProduct,
  submitForReview,
  requestGeneration,
} from "./products";

export type {
  CreateProductResult,
  CreatedProduct,
  DeleteResult,
  GenerationRequest,
  GenerationResult,
  ProductRecord,
  PublishResult,
  StatusChangeResult,
  QueuedJob,
} from "./products";

export {
  isContentComplete,
  loadContent,
  parseContentPatch,
  patchContent,
} from "./content";

export type {
  ContentDraft,
  ContentPatchResult,
  ContentRecord,
  ContentSource,
  ContentWriteResult,
} from "./content";

export {
  loadTranscript,
  requireReviewedTranscript,
  storeAsrTranscript,
  submitTranscript,
} from "./transcript";

export type {
  AsrTranscriptInput,
  TranscriptRecord,
  TranscriptSubmitResult,
} from "./transcript";

export {
  NO_CONSENT,
  hasConsent,
  loadConsents,
  requireConsent,
  setConsent,
} from "./consent";

export type {
  ConsentChange,
  ConsentKind,
  ConsentResult,
  ConsentState,
} from "./consent";

export { buildCaptions } from "./narration";

export type { Caption } from "./narration";
