/**
 * Klien HTTP untuk antrian Studio Agent.
 *
 * Seluruh bentuk permintaan dan respons di berkas ini berasal dari
 * `docs/spec/API-CONTRACT.md` bagian 8 dan skema Zod di `lib/schemas.ts`.
 * Tidak ada endpoint, medan, atau nilai yang dikarang di sini. Bila Anda
 * membutuhkan sesuatu yang belum ada di kedua sumber itu, hal yang benar
 * adalah bertanya — bukan menambahkannya diam-diam.
 *
 * Autentikasi memakai `X-Agent-Key`, bukan token sesi pengrajin: agen bukan
 * pengguna, dan memberinya token sesi berarti memberinya kemampuan yang jauh
 * lebih luas daripada yang dibutuhkannya.
 */

import { AgentRuntimeError } from "./chrome.js";

/**
 * Galat yang membawa kode dari katalog API.
 *
 * `code` tidak pernah ditampilkan ke pengrajin — antarmuka memetakannya ke
 * tampilan. Yang menampilkannya adalah log agen, untuk keperluan operator.
 */
export class ApiRequestError extends Error {
  /**
   * @param {number} status
   * @param {{ code: string, message: string, action: string, workSafe: boolean } | null} failure
   */
  constructor(status, failure) {
    super(failure?.message ?? `Permintaan gagal dengan status ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.failure = failure;
    // Kode yang menandakan gangguan sementara. Percobaan ulang HANYA
    // dilakukan pada heartbeat; pengambilan pekerjaan dan pelaporan hasil
    // tidak pernah mencoba ulang sendiri (P3 aturan 6: gagal cepat).
    this.retryable = status === 429 || status >= 500 || failure?.code === "QUOTA_EXCEEDED";
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Membaca badan JSON dengan aman.
 *
 * Badan yang bukan JSON tidak boleh menggagalkan pemanggilan dengan galat
 * sintaksis: yang perlu diketahui pemanggil adalah apakah permintaannya
 * berhasil, dan itu ditentukan status HTTP.
 *
 * @param {Response} response
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readBody(response) {
  try {
    const parsed = await response.json();
    if (typeof parsed === "object" && parsed !== null) {
      return /** @type {Record<string, unknown>} */ (parsed);
    }
    return null;
  } catch {
    return null;
  }
}

export class AgentApiClient {
  /**
   * @param {{ baseUrl: string, agentKey: string }} options
   */
  constructor(options) {
    // Garis miring di ujung akan menghasilkan URL dengan garis miring ganda,
    // dan sebagian proksi menolaknya. Dihilangkan sekali di sini.
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.agentKey = options.agentKey;
  }

  /** Kontrak API bagian 8. Seluruh rute agen berada di bawah /api/v1. */
  /**
   * @param {string} path
   * @param {Record<string, unknown>} payload
   * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async post(path, payload, options = {}) {
    const url = `${this.baseUrl}/api/v1${path}`;

    // Batas waktu per permintaan digabung dengan sinyal dari pemanggil:
    // keduanya dapat membatalkan, dan yang pertama tiba menang.
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const signal =
      options.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([options.signal, timeoutSignal]);

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Key": this.agentKey,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch {
      // Jaringan putus terhadap Worker. Ini bukan kegagalan pekerjaan:
      // pekerjaannya masih ada di antrian server dan akan diambil ulang.
      throw new AgentRuntimeError(
        `Tidak dapat menghubungi Worker di ${this.baseUrl}. ` +
          "Periksa koneksi lalu jalankan agen lagi.",
        "unknown",
      );
    }

    const body = await readBody(response);

    if (!response.ok) {
      throw new ApiRequestError(response.status, extractFailure(body));
    }

    if (body === null || body.ok !== true || typeof body.data !== "object") {
      throw new ApiRequestError(response.status, null);
    }

    return /** @type {Record<string, unknown>} */ (body.data);
  }

  /**
   * Mengunduh berkas biner dari Worker lewat endpoint agen.
   *
   * @param {string} path
   * @returns {Promise<Uint8Array | null>}
   */
  async getBinary(path) {
    const url = `${this.baseUrl}/api/v1${path}`;
    try {
      const response = await fetch(url, {
        headers: { "X-Agent-Key": this.agentKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  /**
   * Mengunggah biner langsung ke URL bertanda tangan.
   *
   * Kontrak API bagian 5: `uploadUrl` adalah URL bertanda tangan milik Worker,
   * dan klien melakukan `PUT` biner langsung ke sana. Permintaan ini TIDAK
   * memakai `X-Agent-Key` — tanda tangannya sendiri yang menjadi otorisasi,
   * dan menyertakan kunci agen ke URL yang berbeda memperluas jangkauan
   * rahasia itu tanpa alasan.
   *
   * @param {string} uploadUrl
   * @param {Uint8Array} bytes
   * @param {string} mimeType
   * @param {{ signal?: AbortSignal }} [options]
   */
  async putBinary(uploadUrl, bytes, mimeType, options = {}) {
    /** @type {RequestInit} */
    const init = {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: bytes,
    };
    if (options.signal !== undefined) init.signal = options.signal;

    let response;
    try {
      response = await fetch(uploadUrl, init);
    } catch {
      throw new AgentRuntimeError(
        "Unggahan hasil tidak sampai ke penyimpanan. Periksa koneksi.",
        "unknown",
      );
    }

    if (!response.ok) {
      throw new ApiRequestError(response.status, null);
    }
  }
}

/**
 * @param {Record<string, unknown> | null} body
 * @returns {{ code: string, message: string, action: string, workSafe: boolean } | null}
 */
function extractFailure(body) {
  if (body === null) return null;

  const error = body.error;
  if (typeof error !== "object" || error === null) return null;

  const candidate = /** @type {Record<string, unknown>} */ (error);
  if (typeof candidate.code !== "string") return null;

  return {
    code: candidate.code,
    message: typeof candidate.message === "string" ? candidate.message : "",
    action: typeof candidate.action === "string" ? candidate.action : "NONE",
    workSafe: candidate.workSafe === true,
  };
}
