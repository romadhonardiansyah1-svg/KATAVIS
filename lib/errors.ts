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
    message: "Sesi Anda sudah berakhir. Pekerjaan Anda tetap tersimpan. Silakan masuk lagi.",
  },
  FORBIDDEN: {
    status: 403,
    action: "NONE",
    message: "Anda tidak punya akses untuk tindakan ini. Pekerjaan Anda tetap aman. Kembali ke halaman sebelumnya.",
  },
  NOT_FOUND: {
    status: 404,
    action: "GO_BACK",
    message: "Halaman tidak ditemukan. Pekerjaan Anda tidak hilang. Kembali ke halaman sebelumnya.",
  },
  RATE_LIMITED: {
    status: 429,
    action: "WAIT",
    message: "Terlalu banyak percobaan. Pekerjaan Anda tetap tersimpan. Coba lagi beberapa menit lagi.",
  },
  ACCOUNT_LOCKED: {
    status: 423,
    action: "WAIT",
    message: "Akun terkunci sementara. Pekerjaan Anda tetap tersimpan. Coba lagi 15 menit lagi.",
  },
  CONSENT_REQUIRED: {
    status: 403,
    action: "GIVE_CONSENT",
    message: "Perlu persetujuan Anda sebelum melanjutkan. Katalog Anda tetap utuh.",
  },
  FILE_TOO_LARGE: {
    status: 413,
    action: "PICK_OTHER_FILE",
    message: "Foto terlalu besar, maksimal 10 MB. Pekerjaan Anda tetap tersimpan. Pilih foto lain.",
  },
  UNSUPPORTED_FORMAT: {
    status: 415,
    action: "PICK_OTHER_FILE",
    message: "Format foto tidak didukung. Pekerjaan Anda tetap tersimpan. Gunakan JPG atau PNG.",
  },
  CONTENT_MISMATCH: {
    status: 400,
    action: "PICK_OTHER_FILE",
    message: "Berkas ini bukan foto. Pekerjaan Anda tetap tersimpan. Silakan pilih foto lain.",
  },
  ASR_TOO_SHORT: {
    status: 400,
    action: "RETRY_RECORD",
    message: "Rekaman terlalu pendek. Cerita Anda tidak hilang. Rekam lagi sekitar 30 detik.",
  },
  ASR_TOO_LONG: {
    status: 400,
    action: "RETRY_RECORD",
    message: "Rekaman terlalu panjang. Cerita Anda tidak hilang. Rekam lagi maksimal 60 detik.",
  },
  ASR_NO_SPEECH: {
    status: 422,
    action: "RETRY_RECORD",
    message: "Suara belum terdengar jelas. Cerita Anda tidak hilang. Rekam lagi di tempat lebih tenang.",
  },
  TRANSCRIPT_NOT_REVIEWED: {
    status: 409,
    action: "REVIEW_TRANSCRIPT",
    message: "Periksa dulu hasil transkrip Anda. Draf Anda tetap tersimpan.",
  },
  CONTENT_INCOMPLETE: {
    status: 409,
    action: "COMPLETE_CONTENT",
    message: "Katalog belum lengkap. Draf Anda tetap tersimpan. Lengkapi dulu nama dan cerita produk.",
  },
  PHOTO_REQUIRED: {
    status: 409,
    action: "ADD_PHOTO",
    message: "Tambahkan minimal satu foto produk. Draf Anda tetap tersimpan.",
  },
  IMAGE_GENERATE_FAILED: {
    status: 502,
    action: "RETRY_OR_USE_ORIGINAL",
    message: "Foto studio belum berhasil dibuat. Foto asli Anda tetap tersimpan. Coba lagi atau pakai foto asli.",
  },
  COPY_GENERATE_FAILED: {
    status: 502,
    action: "RETRY",
    message: "Cerita belum berhasil dibuat. Rekaman Anda tetap tersimpan. Coba lagi.",
  },
  MAX_RETRIES_EXCEEDED: {
    status: 429,
    action: "USE_ORIGINAL",
    message: "Sudah dicoba beberapa kali. Foto asli Anda tetap tersimpan. Pakai foto asli.",
  },
  QUOTA_EXCEEDED: {
    status: 503,
    action: "WAIT",
    message: "Sistem sedang sibuk. Pekerjaan Anda tetap tersimpan. Tunggu sebentar lalu coba lagi.",
  },
  NETWORK_OFFLINE: {
    status: 503,
    action: "WAIT_ONLINE",
    message: "Tidak ada koneksi. Pekerjaan Anda tetap tersimpan dan akan dilanjutkan. Tunggu sampai tersambung kembali.",
  },
  INVITE_EXPIRED: {
    status: 410,
    action: "REQUEST_NEW_INVITE",
    message: "Undangan sudah kedaluwarsa. Pekerjaan Anda tetap tersimpan. Minta undangan baru.",
  },
  INVITE_ALREADY_USED: {
    status: 409,
    action: "NONE",
    message: "Undangan ini sudah dipakai. Pekerjaan Anda tetap tersimpan. Kembali dan masuk dengan akun Anda.",
  },
  INTERNAL_ERROR: {
    status: 500,
    action: "RETRY",
    message: "Terjadi gangguan. Pekerjaan Anda tetap tersimpan. Coba lagi.",
  },
} as const satisfies Record<string, ErrorDefinition>;

interface ErrorDefinition {
  readonly status: number;
  readonly action: string;
  readonly message: string;
}

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** Kode aksi yang muncul di katalog — kontrak API bagian 12. */
export type ErrorAction = (typeof ERROR_CATALOG)[ErrorCode]["action"];

/**
 * Label tombol untuk setiap kode aksi.
 *
 * Kontrak API bagian 12 menyatakan `action` adalah kode mesin dan "antarmuka
 * memetakannya ke tombol". Sebelum peta ini ada, `StepShell` menampilkan
 * kodenya apa adanya, sehingga pengrajin membaca "RETRY_OR_USE_ORIGINAL" di
 * layar — ditemukan TC-E2E-21, dan yang paling parah: pesan yang seharusnya
 * memuat langkah berikutnya justru memuat nama internalnya.
 *
 * Tipe `Record<ErrorAction, string>` membuat katalog dan peta ini tidak dapat
 * berbeda pendapat: menambahkan kode aksi baru tanpa labelnya gagal saat
 * typecheck, bukan saat demo.
 *
 * `NONE` sengaja kosong: ia berarti "tidak ada yang perlu dikerjakan
 * pengguna", dan tombol kosong lebih membingungkan daripada tidak ada tombol.
 */
export const ACTION_LABELS: Readonly<Record<ErrorAction, string>> = {
  ADD_PHOTO: "Tambahkan foto",
  COMPLETE_CONTENT: "Lengkapi katalog",
  GIVE_CONSENT: "Beri persetujuan",
  GO_BACK: "Kembali",
  LOGIN: "Masuk lagi",
  NONE: "",
  PICK_OTHER_FILE: "Pilih foto lain",
  REQUEST_NEW_INVITE: "Minta undangan baru",
  RETRY: "Coba lagi",
  RETRY_OR_USE_ORIGINAL: "Coba lagi atau pakai foto asli",
  RETRY_RECORD: "Rekam lagi",
  REVIEW_TRANSCRIPT: "Periksa transkrip",
  USE_ORIGINAL: "Pakai foto asli",
  WAIT: "Tunggu sebentar",
  WAIT_ONLINE: "Tunggu sampai tersambung",
};

/**
 * Label untuk sebuah kode aksi.
 *
 * Kode yang tidak dikenal mengembalikan string kosong, bukan kodenya sendiri:
 * server yang lebih baru boleh mengirim aksi yang belum dikenal peramban ini,
 * dan menampilkan "SOME_NEW_CODE" ke pengrajin adalah persis kegagalan yang
 * peta ini ada untuk mencegahnya.
 */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action as ErrorAction] ?? "";
}

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
