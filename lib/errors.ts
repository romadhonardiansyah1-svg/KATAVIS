/**
 * Katalog galat KATAVIS.
 *
 * Sumber kebenaran tunggal untuk seluruh galat yang dapat dikembalikan API.
 * Cerminan `docs/spec/API-CONTRACT.md` bagian 12 dalam bentuk kode.
 *
 * Menambah galat baru berarti menambah barisnya di kontrak API lebih dulu,
 * lalu di sini. Galat yang tidak ada di tabel ini tidak boleh dikembalikan.
 */

export const ERROR_CATALOG = {
  UNAUTHENTICATED: {
    status: 401,
    action: "LOGIN",
    message: "Sesi Anda sudah berakhir. Silakan masuk lagi.",
  },
  FORBIDDEN: {
    status: 403,
    action: "NONE",
    message: "Anda tidak punya akses untuk tindakan ini.",
  },
  NOT_FOUND: {
    status: 404,
    action: "GO_BACK",
    message: "Halaman tidak ditemukan.",
  },
  RATE_LIMITED: {
    status: 429,
    action: "WAIT",
    message: "Terlalu banyak percobaan. Coba lagi beberapa menit lagi.",
  },
  ACCOUNT_LOCKED: {
    status: 423,
    action: "WAIT",
    message: "Akun terkunci sementara. Coba lagi 15 menit lagi.",
  },
  CONSENT_REQUIRED: {
    status: 403,
    action: "GIVE_CONSENT",
    message: "Perlu persetujuan Anda sebelum melanjutkan.",
  },
  FILE_TOO_LARGE: {
    status: 413,
    action: "PICK_OTHER_FILE",
    message: "Foto terlalu besar. Maksimal 10 MB.",
  },
  UNSUPPORTED_FORMAT: {
    status: 415,
    action: "PICK_OTHER_FILE",
    message: "Format foto tidak didukung. Gunakan JPG atau PNG.",
  },
  CONTENT_MISMATCH: {
    status: 400,
    action: "PICK_OTHER_FILE",
    message: "Berkas ini bukan foto. Silakan pilih foto lain.",
  },
  ASR_TOO_SHORT: {
    status: 400,
    action: "RETRY_RECORD",
    message: "Rekaman terlalu pendek. Ceritakan sekitar 30 detik.",
  },
  ASR_TOO_LONG: {
    status: 400,
    action: "RETRY_RECORD",
    message: "Rekaman terlalu panjang. Maksimal 60 detik.",
  },
  ASR_NO_SPEECH: {
    status: 422,
    action: "RETRY_RECORD",
    message: "Suara belum terdengar jelas. Rekam lagi di tempat lebih tenang.",
  },
  TRANSCRIPT_NOT_REVIEWED: {
    status: 409,
    action: "REVIEW_TRANSCRIPT",
    message: "Periksa dulu hasil transkrip Anda.",
  },
  CONTENT_INCOMPLETE: {
    status: 409,
    action: "COMPLETE_CONTENT",
    message: "Katalog belum lengkap. Lengkapi dulu nama dan cerita produk.",
  },
  PHOTO_REQUIRED: {
    status: 409,
    action: "ADD_PHOTO",
    message: "Tambahkan minimal satu foto produk.",
  },
  IMAGE_GENERATE_FAILED: {
    status: 502,
    action: "RETRY_OR_USE_ORIGINAL",
    message: "Foto studio belum berhasil dibuat. Foto asli Anda tetap tersimpan.",
  },
  COPY_GENERATE_FAILED: {
    status: 502,
    action: "RETRY",
    message: "Cerita belum berhasil dibuat. Rekaman Anda tetap tersimpan.",
  },
  MAX_RETRIES_EXCEEDED: {
    status: 429,
    action: "USE_ORIGINAL",
    message: "Sudah dicoba beberapa kali. Anda bisa memakai foto asli.",
  },
  QUOTA_EXCEEDED: {
    status: 503,
    action: "WAIT",
    message: "Sistem sedang sibuk. Pekerjaan Anda tersimpan.",
  },
  NETWORK_OFFLINE: {
    status: 503,
    action: "WAIT_ONLINE",
    message: "Tidak ada koneksi. Pekerjaan Anda tersimpan dan akan dilanjutkan.",
  },
  INVITE_EXPIRED: {
    status: 410,
    action: "REQUEST_NEW_INVITE",
    message: "Undangan sudah kedaluwarsa. Minta undangan baru.",
  },
  INVITE_ALREADY_USED: {
    status: 409,
    action: "NONE",
    message: "Undangan ini sudah dipakai.",
  },
  INTERNAL_ERROR: {
    status: 500,
    action: "RETRY",
    message: "Terjadi gangguan. Pekerjaan Anda tersimpan. Coba lagi.",
  },
} as const satisfies Record<string, ErrorDefinition>;

interface ErrorDefinition {
  readonly status: number;
  readonly action: string;
  readonly message: string;
}

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface ApiErrorBody {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    action: string;
    /**
     * Selalu true. Ini invarian sistem: kegagalan apa pun tidak boleh
     * menghilangkan pekerjaan pengguna. Bila suatu saat muncul galat yang
     * memaksa nilai false, itu pertanda cacat rancangan — bukan alasan
     * menambah bidang baru.
     */
    workSafe: true;
  };
}

export interface ApiSuccessBody<T> {
  ok: true;
  data: T;
}

/** Membentuk respons galat sesuai kontrak API bagian 1. */
export function apiError(code: ErrorCode, overrideMessage?: string): Response {
  const definition = ERROR_CATALOG[code];
  const body: ApiErrorBody = {
    ok: false,
    error: {
      code,
      message: overrideMessage ?? definition.message,
      action: definition.action,
      workSafe: true,
    },
  };
  return Response.json(body, { status: definition.status });
}

/** Membentuk respons berhasil sesuai kontrak API bagian 1. */
export function apiOk<T>(data: T, status = 200): Response {
  const body: ApiSuccessBody<T> = { ok: true, data };
  return Response.json(body, { status });
}

/**
 * Istilah yang tidak boleh muncul dalam pesan ke pengrajin.
 * Dipakai TC-E2E-20 untuk memeriksa seluruh pesan secara otomatis,
 * bukan lewat tinjauan manual yang bisa terlewat.
 */
export const FORBIDDEN_MESSAGE_TERMS = [
  "error",
  "failed",
  "exception",
  "null",
  "undefined",
  "500",
  "404",
  "timeout",
  "stack",
] as const;
