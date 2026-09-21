/**
 * Klien API.
 *
 * Seluruh fungsi di sini memanggil endpoint yang ada di
 * `docs/spec/API-CONTRACT.md` dan tidak ada yang lain. Bentuk responsnya
 * juga dari sana: `{ ok: true, data }` atau `{ ok: false, error }`.
 *
 * Kegagalan jaringan dipetakan ke `NETWORK_OFFLINE`, bukan dilempar. Alur
 * enam langkah harus tetap dapat dilanjutkan saat koneksi putus di tengah
 * jalan — itu keadaan lazim pada pengguna sasaran, dan S5 menyatakan
 * pekerjaan pengrajin tidak boleh hilang karenanya.
 */

import { ERROR_CATALOG, type ErrorCode } from "@/lib/errors";

/**
 * Alamat Worker.
 *
 * Diisi lewat `NEXT_PUBLIC_API_BASE_URL`. Bawaannya alamat `wrangler dev`
 * supaya pengembangan lokal berjalan tanpa konfigurasi.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const API_PREFIX = "/api/v1";

export interface ApiFailure {
  readonly code: ErrorCode;
  readonly message: string;
  readonly action: string;
  readonly workSafe: boolean;
}

export type ApiResult<TValue> =
  | { readonly ok: true; readonly data: TValue }
  | { readonly ok: false; readonly error: ApiFailure };

function failureOf(code: ErrorCode): ApiFailure {
  const entry = ERROR_CATALOG[code];
  return {
    code,
    message: entry.message,
    action: entry.action,
    // Seluruh galat bernilai `workSafe: true` — itu invarian sistem, bukan
    // bidang per kode (AGENTS.md aturan 2). Kegagalan apa pun tidak boleh
    // menghilangkan pekerjaan pengrajin.
    workSafe: true,
  };
}

async function request<TValue>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<ApiResult<TValue>> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    // Tidak ada koneksi. Ini keadaan yang sudah diperhitungkan, bukan galat
    // yang tidak terduga: pekerjaan pengrajin tersimpan di perangkat.
    return { ok: false, error: failureOf("NETWORK_OFFLINE") };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Badan respons bukan JSON. Tidak ada kode katalog yang cocok untuk
    // "server menjawab sesuatu yang tidak dimengerti", jadi yang dipakai
    // adalah kode umumnya.
    return { ok: false, error: failureOf("INTERNAL_ERROR") };
  }

  if (typeof body !== "object" || body === null) {
    return { ok: false, error: failureOf("INTERNAL_ERROR") };
  }

  const envelope = body as { ok?: unknown; data?: unknown; error?: unknown };

  if (envelope.ok === true) {
    return { ok: true, data: envelope.data as TValue };
  }

  const error = envelope.error as Partial<ApiFailure> | undefined;
  const code = typeof error?.code === "string" ? (error.code as ErrorCode) : "INTERNAL_ERROR";

  return {
    ok: false,
    error: {
      ...failureOf(code),
      // Pesan dari server dipakai bila ada: ia yang sudah disusun untuk
      // dibaca pengrajin, dan menyusunnya ulang di klien berarti dua versi
      // yang bisa berbeda.
      message: typeof error?.message === "string" ? error.message : failureOf(code).message,
    },
  };
}

function jsonRequest<TValue>(
  path: string,
  token: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<TValue>> {
  return request<TValue>(path, token, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// --- Produk (§4) ---

export interface CreatedProduct {
  readonly id: string;
  readonly status: string;
  readonly progress: number;
  readonly createdAt: number;
}

export function createProduct(
  token: string,
  idempotencyKey: string,
): Promise<ApiResult<CreatedProduct>> {
  return request<CreatedProduct>("/products", token, {
    method: "POST",
    // Idempotency-Key wajib pada permintaan yang mengubah data (§1).
    // Tanpa itu, jaringan buruk membuat pengrajin punya dua draf.
    headers: { "Idempotency-Key": idempotencyKey, "Content-Type": "application/json" },
    body: "{}",
  });
}

export interface ProductContent {
  readonly name: string | null;
  readonly story: string | null;
  readonly specs: readonly string[];
  readonly socialCopy: string | null;
  readonly seoKeywords: readonly string[];
  readonly source: string;
}

export interface ProductDetail {
  readonly id: string;
  readonly status: string;
  readonly progress: number;
  readonly content: Readonly<Record<string, ProductContent>>;
  readonly media: readonly {
    readonly id: string;
    readonly kind: string;
    readonly url: string;
    readonly altText: string | null;
    readonly isPrimary: boolean;
  }[];
  readonly jobs: readonly {
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly provider: string | null;
  }[];
  readonly transcript: { readonly text: string; readonly edited: boolean } | null;
}

export function getProduct(token: string, productId: string): Promise<ApiResult<ProductDetail>> {
  return request<ProductDetail>(`/products/${productId}`, token);
}

export function patchContent(
  token: string,
  productId: string,
  locale: string,
  patch: Record<string, unknown>,
): Promise<ApiResult<{ readonly locale: string; readonly source: string }>> {
  return jsonRequest(`/products/${productId}/content/${locale}`, token, "PATCH", patch);
}

export function publishProduct(
  token: string,
  productId: string,
): Promise<ApiResult<{ readonly id: string; readonly status: string; readonly slug: string | null }>> {
  return jsonRequest(`/products/${productId}/publish`, token, "POST", {
    consentConfirmed: true,
  });
}

// --- Persetujuan (§3) ---

export function setConsent(
  token: string,
  kind: "audio_processing" | "publication",
  granted: boolean,
): Promise<ApiResult<unknown>> {
  return jsonRequest("/consent", token, "POST", { kind, granted });
}

// --- Media (§5) ---

export interface UploadTicket {
  readonly mediaId: string;
  readonly uploadUrl: string;
  readonly expiresAt: number;
}

export function requestUploadUrl(
  token: string,
  productId: string,
  body: { readonly kind: string; readonly mimeType: string; readonly bytes: number },
): Promise<ApiResult<UploadTicket>> {
  return jsonRequest(`/products/${productId}/media/upload-url`, token, "POST", body);
}

/**
 * Mengunggah ke URL bertanda tangan.
 *
 * Bukan endpoint API: `uploadUrl` adalah alamat bertanda tangan yang
 * diterbitkan endpoint di atas, dan berkasnya pergi langsung ke sana tanpa
 * header autentikasi — tanda tangan di dalam URL itulah autentikasinya.
 */
export async function uploadToSignedUrl(
  uploadUrl: string,
  file: Blob,
): Promise<ApiResult<unknown>> {
  try {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(file.size) },
      body: file,
    });

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const error = (body as { error?: Partial<ApiFailure> } | null)?.error;
      const code = typeof error?.code === "string" ? (error.code as ErrorCode) : "INTERNAL_ERROR";
      return { ok: false, error: { ...failureOf(code), message: error?.message ?? failureOf(code).message } };
    }

    return { ok: true, data: null };
  } catch {
    return { ok: false, error: failureOf("NETWORK_OFFLINE") };
  }
}

export function confirmMedia(
  token: string,
  productId: string,
  mediaId: string,
): Promise<ApiResult<{ readonly id: string; readonly uploadStatus: string }>> {
  return request(`/products/${productId}/media/${mediaId}/confirm`, token, { method: "POST" });
}

// --- Audio dan transkrip (§6) ---

export function requestTranscription(
  token: string,
  productId: string,
  audio: Blob,
): Promise<ApiResult<{ readonly jobId: string; readonly kind: string; readonly status: string }>> {
  const form = new FormData();
  form.append("audio", audio, "rekaman.webm");

  return request(`/products/${productId}/audio`, token, { method: "POST", body: form });
}

export function getTranscript(
  token: string,
  productId: string,
): Promise<ApiResult<{ readonly text: string; readonly edited: boolean }>> {
  return request(`/products/${productId}/transcript`, token);
}

export function putTranscript(
  token: string,
  productId: string,
  text: string,
): Promise<ApiResult<{ readonly text: string; readonly edited: boolean }>> {
  return jsonRequest(`/products/${productId}/transcript`, token, "PUT", { text });
}

// --- Pekerjaan (§7) ---

export interface JobView {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly provider: string | null;
  readonly progress: number;
  readonly attempt: number;
  /** Bentuk galat yang sama seperti bagian 1, hanya pada pekerjaan gagal. */
  readonly error?: { readonly code: string; readonly message: string; readonly action: string } | null;
}

export function requestGeneration(
  token: string,
  productId: string,
  body: { readonly tasks: readonly string[]; readonly locales: readonly string[] },
): Promise<ApiResult<{ readonly jobs: readonly { readonly id: string; readonly kind: string }[] }>> {
  return jsonRequest(`/products/${productId}/generate`, token, "POST", body);
}

export function getJobs(
  token: string,
  productId: string,
): Promise<ApiResult<{ readonly jobs: readonly JobView[]; readonly overallProgress: number }>> {
  return request(`/products/${productId}/jobs`, token);
}

// --- Ekspor dan katalog publik (§10) ---

export function publicCatalogUrl(slug: string): string {
  return `${API_BASE_URL}${API_PREFIX}/public/catalog/${slug}`;
}
