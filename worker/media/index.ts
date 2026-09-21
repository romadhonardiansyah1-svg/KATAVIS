/**
 * Ekspor publik modul media.
 *
 * Modul lain hanya boleh memanggil lewat berkas ini (ADR-001).
 *
 * Isinya berlaku untuk kedua jalur transfer berkas yang masih menunggu
 * keputusan pemilik proyek: validasi permintaan unggah, pemeriksaan isi
 * berkas lewat magic bytes, penyusunan kunci R2, dan pemeriksaan suntingan
 * media. Yang belum ada adalah URL bertanda tangan itu sendiri — alasannya
 * dicatat di akhir `upload.ts`.
 */

export {
  UPLOAD_TOKEN_TTL_MS,
  buildGeneratedMediaKey,
  buildMediaKey,
  createSignedUpload,
  detectImageMime,
  handleSignedUpload,
  isSafeMediaKey,
  parseMediaPatch,
  validateUploadRequest,
  verifyImageContent,
  verifyUploadToken,
} from "./upload";

export type {
  AllowedImageMime,
  ImageContentResult,
  MediaKeyInput,
  MediaKeyResult,
  MediaPatchInput,
  MediaPatchResult,
  SignedUpload,
  UploadRequestInput,
  UploadRequestResult,
  UploadRouteDeps,
  UploadVerification,
} from "./upload";

// Akses D1 aset media. Terpisah dari validasi di `upload.ts`, yang murni.
export {
  d1ConfirmMediaAsset,
  d1FindMediaAsset,
  d1InsertMediaAsset,
  d1PatchMediaAsset,
} from "./d1-media";

export type { MediaAssetRecord, UploadStatus } from "./d1-media";
