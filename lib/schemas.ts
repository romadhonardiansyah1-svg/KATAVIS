/**
 * Skema validasi batas aplikasi.
 *
 * Cerminan `docs/spec/API-CONTRACT.md` dalam bentuk kode. Frontend dan
 * backend mengimpor skema yang sama, sehingga bentuk yang tidak cocok
 * tertangkap saat kompilasi, bukan saat demo.
 *
 * Data dari luar tidak pernah dipercaya. Setiap muatan masuk melewati
 * `.parse()` sebelum disentuh logika bisnis.
 */

import { z } from "zod";

// --- Primitif ---

/** ULID: 26 karakter Crockford base32. */
export const UlidSchema = z
  .string()
  .length(26)
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Bukan ULID yang sah");

/** Nomor Indonesia format E.164. */
export const PhoneSchema = z
  .string()
  .regex(/^\+62[1-9][0-9]{7,12}$/, "Nomor harus diawali +62");

export const LocaleSchema = z.enum(["id", "en", "ja", "zh", "ar"]);
export const RoleSchema = z.enum(["artisan", "caregiver", "admin", "buyer"]);

export const ProductStatusSchema = z.enum([
  "draft",
  "processing",
  "review",
  "published",
  "archived",
]);

export const JobKindSchema = z.enum(["asr", "copy", "image", "tts", "export"]);
export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const MediaKindSchema = z.enum([
  "photo_original",
  "photo_studio",
  "audio_raw",
  "audio_tts",
]);

/**
 * Hanya tiga izin yang dapat diberikan ke pendamping.
 * `publish` dan `delete` sengaja TIDAK ada: keduanya adalah keputusan
 * pemilik karya dan tidak dapat didelegasikan (FEATURE-SPECS S3).
 */
export const CaregiverPermissionSchema = z.enum([
  "edit_draft",
  "upload_media",
  "submit_review",
]);

export const ImageStyleSchema = z.enum([
  "marble_light",
  "wood_warm",
  "dark_gradient",
]);

// --- Batas yang mengikat ---

export const LIMITS = {
  /** Kontrak API bagian 5. Diuji di TC-U-CAT-04. */
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  /** Kontrak API bagian 6. Diuji di TC-U-CAT-01 sampai 03. */
  MIN_AUDIO_MS: 10_000,
  MAX_AUDIO_MS: 60_000,
  /** Paginasi berbasis kursor; OFFSET besar menghabiskan jatah kueri D1. */
  MAX_PAGE_SIZE: 20,
  /** Kontrak API bagian 7. */
  MAX_JOB_ATTEMPTS: 3,
  /** ADR-004. Batas waktu keras jalur Gemini. */
  GEMINI_TIMEOUT_MS: 45_000,
  /** Kontrak API bagian 8. Agen tanpa heartbeat dianggap mati. */
  AGENT_HEARTBEAT_TIMEOUT_MS: 30_000,
  /** Undangan pendamping. Diuji di TC-U-RBAC-13. */
  INVITE_TTL_MS: 24 * 60 * 60 * 1000,
  /** URL bertanda tangan. Diuji di TC-I-06. */
  UPLOAD_URL_TTL_MS: 15 * 60 * 1000,
  /** PRD bagian 6. */
  ACCESS_TOKEN_TTL_S: 15 * 60,
  REFRESH_TOKEN_TTL_MS: 30 * 24 * 60 * 60 * 1000,
  /** TC-SEC-13. */
  MAX_PIN_ATTEMPTS: 5,
  PIN_LOCKOUT_MS: 15 * 60 * 1000,
  /** TC-PERF-04. Ambang di bawah batas D1 free 50, memberi ruang aman. */
  MAX_D1_QUERIES_PER_REQUEST: 25,
} as const;

/**
 * SVG ditolak meski berupa gambar: ia dapat memuat skrip.
 * Diuji di TC-U-CAT-05 dan TC-SEC-09.
 */
export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/**
 * Magic bytes untuk verifikasi isi berkas. Validasi berdasar ekstensi
 * atau MIME yang dikirim klien dapat ditembus — TC-U-CAT-06.
 */
export const IMAGE_MAGIC_BYTES: Record<string, readonly number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46],
};

// --- Auth (kontrak API bagian 2) ---

export const OtpRequestSchema = z.object({ phone: PhoneSchema });

export const OtpVerifySchema = z.object({
  phone: PhoneSchema,
  code: z.string().length(6).regex(/^\d{6}$/),
});

export const PinSetSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, "PIN harus 6 angka"),
});

// --- Persetujuan (kontrak API bagian 3) ---

export const ConsentSchema = z.object({
  kind: z.enum(["audio_processing", "publication"]),
  granted: z.boolean(),
});

// --- Produk (kontrak API bagian 4) ---

export const ProductListQuerySchema = z.object({
  status: ProductStatusSchema.optional(),
  cursor: UlidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.MAX_PAGE_SIZE).default(10),
});

export const ContentPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    story: z.string().min(1).max(4000).optional(),
    specs: z.array(z.string().min(1).max(200)).max(12).optional(),
    socialCopy: z.string().max(1000).optional(),
    seoKeywords: z.array(z.string().min(1).max(60)).max(20).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Minimal satu bidang harus diisi",
  });

export const PublishSchema = z.object({
  consentConfirmed: z.literal(true),
});

// --- Media (kontrak API bagian 5) ---

export const UploadUrlRequestSchema = z.object({
  kind: MediaKindSchema,
  mimeType: z.enum(ALLOWED_IMAGE_MIME),
  bytes: z.number().int().positive().max(LIMITS.MAX_UPLOAD_BYTES),
});

export const MediaPatchSchema = z.object({
  altText: z.string().min(1).max(300).optional(),
  isPrimary: z.boolean().optional(),
});

// --- Transkrip (kontrak API bagian 6) ---

export const TranscriptPutSchema = z.object({
  text: z.string().min(1).max(8000),
});

// --- Pekerjaan (kontrak API bagian 7) ---

export const GenerateRequestSchema = z.object({
  tasks: z.array(z.enum(["copy", "image", "tts"])).min(1),
  locales: z.array(LocaleSchema).min(1).max(5),
  imageStyle: ImageStyleSchema.optional(),
});

// --- Studio Agent (kontrak API bagian 8) ---

export const AgentHeartbeatSchema = z.object({
  agentId: z.string().min(1).max(64),
  healthy: z.boolean(),
  selectorsOk: z.boolean(),
  chromeSessionOk: z.boolean(),
});

export const AgentClaimSchema = z.object({
  agentId: z.string().min(1).max(64),
  /** Satu peramban tidak menjalankan dua pekerjaan bersamaan (TC-SA-05). */
  max: z.literal(1).default(1),
});

export const AgentCompleteSchema = z.object({
  r2Key: z.string().min(1).max(512),
  durationMs: z.number().int().nonnegative(),
});

export const AgentFailSchema = z.object({
  reason: z.enum([
    "selector_not_found",
    "session_expired",
    "timeout",
    "generation_refused",
    "unknown",
  ]),
  durationMs: z.number().int().nonnegative(),
});

// --- Pendamping (kontrak API bagian 9) ---

export const CaregiverInviteSchema = z.object({
  phone: PhoneSchema,
  permissions: z.array(CaregiverPermissionSchema).min(1),
});

export const CaregiverAcceptSchema = z.object({
  token: z.string().min(16).max(256),
});

// --- Ekspor (kontrak API bagian 10) ---

export const ExportRequestSchema = z.object({
  format: z.enum(["pdf", "csv_merchant", "json"]),
  locale: LocaleSchema,
});

// --- Aksesibilitas (kontrak API bagian 11) ---

export const A11yProfileSchema = z.object({
  visual: z.boolean(),
  hearing: z.boolean(),
  motor: z.boolean(),
  cognitive: z.boolean(),
  voice: z.boolean(),
});

// --- Tipe turunan ---

export type Locale = z.infer<typeof LocaleSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type ProductStatus = z.infer<typeof ProductStatusSchema>;
export type JobKind = z.infer<typeof JobKindSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type MediaKind = z.infer<typeof MediaKindSchema>;
export type CaregiverPermission = z.infer<typeof CaregiverPermissionSchema>;
export type ImageStyle = z.infer<typeof ImageStyleSchema>;
export type A11yProfile = z.infer<typeof A11yProfileSchema>;
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;
