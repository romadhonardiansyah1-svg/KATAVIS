/**
 * Produk: pembuatan, transisi status, penerbitan, penghapusan, dan
 * permintaan pemrosesan.
 *
 * Tiga aturan membentuk berkas ini:
 *
 *   1. **Status hanya maju.** `draft → processing → review → published →
 *      archived`, tanpa jalan kembali. Produk yang sudah terbit tidak
 *      pernah diam-diam kembali menjadi draf.
 *
 *   2. **Penerbitan adalah keputusan pemilik karya.** Izinnya diperiksa
 *      `worker/rbac`, bukan diulang di sini — rbac adalah satu-satunya
 *      tempat aturan itu hidup, dan menduplikasinya berarti dua tempat
 *      yang dapat berbeda pendapat.
 *
 *   3. **Transkrip wajib ditinjau sebelum pemrosesan** (ADR-008). Gerbangnya
 *      ada di `requestGeneration`, dan ia diperiksa server.
 */

import { ulid } from "ulid";

import type { ErrorCode } from "../../lib/errors";
import {
  GenerateRequestSchema,
  ProductStatusSchema,
  PublishSchema,
  UlidSchema,
  type ImageStyle,
  type JobKind,
  type Locale,
  type ProductStatus,
} from "../../lib/schemas";

import {
  canDeleteProduct,
  canEditDraft,
  canPublish,
  canSubmitReview,
  parseCaregiverLink,
  type Actor,
  type CaregiverLink,
} from "../rbac";
import type { Db } from "../db";
import { loadProductDetail } from "../db";

import { isContentComplete } from "./content";
import { requireConsent } from "./consent";
import { requireReviewedTranscript } from "./transcript";

/**
 * Transisi status yang sah. Hanya maju.
 *
 * Tidak ada jalan kembali, termasuk dari `archived`. Produk yang terbit lalu
 * ditarik kembali tidak menjadi draf lagi — ia menjadi arsip, dan arsip
 * tetap arsip. Kalau kelak penarikan kembali dibutuhkan, ia layak menjadi
 * keputusan tersendiri, bukan pintu belakang pada tabel transisi.
 */
export const PRODUCT_STATUS_TRANSITIONS: Readonly<
  Record<ProductStatus, readonly ProductStatus[]>
> = {
  draft: ["processing"],
  processing: ["review"],
  review: ["published"],
  published: ["archived"],
  archived: [],
};

export function canTransition(from: ProductStatus, to: ProductStatus): boolean {
  return (PRODUCT_STATUS_TRANSITIONS[from] ?? []).includes(to);
}

// --- Pembacaan ---

export interface ProductRecord {
  readonly id: string;
  readonly artisanId: string;
  readonly status: ProductStatus;
  readonly slug: string | null;
  readonly progress: number;
}

interface ProductRow {
  readonly id: string;
  readonly artisan_id: string;
  readonly status: string;
  readonly slug: string | null;
  readonly progress: number;
}

/** Membaca satu produk. Satu kueri — rute tulis tidak perlu konten atau media. */
export async function loadProduct(
  db: Db,
  productId: string,
): Promise<ProductRecord | null> {
  const row = await db.first<ProductRow>({
    query: "SELECT id, artisan_id, status, slug, progress FROM products WHERE id = ?",
    params: [productId],
  });

  if (row === null) return null;

  const status = ProductStatusSchema.safeParse(row.status);
  if (!status.success) return null;

  return {
    id: row.id,
    artisanId: row.artisan_id,
    status: status.data,
    slug: row.slug,
    progress: row.progress,
  };
}

/**
 * Memuat tautan pendamping, hanya bila pemanggilnya memang pendamping.
 *
 * Pemeriksaan peran sebelum kueri menghemat satu kueri pada setiap rute
 * yang dijalankan pengrajin — dan itu rute yang paling sering dipakai.
 */
async function loadCaregiverLink(
  db: Db,
  actor: Actor,
  product: ProductRecord,
): Promise<CaregiverLink | null> {
  if (actor.role !== "caregiver") return null;

  const row = await db.first<{
    readonly id: string;
    readonly artisan_id: string;
    readonly caregiver_id: string | null;
    readonly permissions: string;
    readonly status: string;
    readonly expires_at: number;
  }>({
    query: `SELECT id, artisan_id, caregiver_id, permissions, status, expires_at
            FROM caregiver_links
            WHERE caregiver_id = ? AND artisan_id = ?`,
    params: [actor.id, product.artisanId],
  });

  return parseCaregiverLink(row);
}

// --- Pembuatan ---

/**
 * Jendela idempotensi.
 *
 * Kontrak API bagian 1: "Kunci yang sama dalam 24 jam mengembalikan respons
 * pertama, bukan membuat entitas baru." Angka itu tidak ada di LIMITS, jadi
 * ia ditulis di sini dengan rujukan ke dokumennya.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreatedProduct {
  readonly id: string;
  readonly status: ProductStatus;
  readonly progress: number;
  readonly createdAt: number;
}

export type CreateProductResult =
  | {
      readonly ok: true;
      readonly product: CreatedProduct;
      /** true bila ini pengulangan permintaan yang sama, bukan pembuatan baru. */
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly code: ErrorCode };

interface IdempotencyRow {
  readonly response_body: string;
  readonly created_at: number;
}

/**
 * Membuat draf kosong — `POST /products`.
 *
 * Kunci idempotensi dicari dengan `user_id` sekaligus. Tanpa syarat itu,
 * pengguna yang menebak kunci milik orang lain akan menerima isi respons
 * pertama orang tersebut. Kunci yang sah adalah ULID acak, jadi menebaknya
 * tidak praktis — tetapi menambahkan syaratnya tidak berbiaya apa pun, dan
 * satu kueri yang tidak memeriksanya adalah satu kueri yang harus
 * dipercaya.
 */
export async function createProduct(
  db: Db,
  artisanId: string,
  idempotencyKey: string | null,
  nowMs: number,
): Promise<CreateProductResult> {
  const key = UlidSchema.safeParse(idempotencyKey);
  if (!key.success) return { ok: false, code: "FORBIDDEN" };

  const previous = await db.first<IdempotencyRow>({
    query: `SELECT response_body, created_at FROM idempotency_keys
            WHERE key = ? AND user_id = ?`,
    params: [key.data, artisanId],
  });

  if (previous !== null && nowMs - previous.created_at < IDEMPOTENCY_TTL_MS) {
    const replayed = parseCreatedProduct(previous.response_body);
    if (replayed !== null) return { ok: true, product: replayed, replayed: true };
  }

  const product: CreatedProduct = {
    id: ulid(),
    status: "draft",
    progress: 0,
    createdAt: nowMs,
  };

  // Dua tulisan, satu putaran. Produk dan kuncinya harus lahir bersama:
  // produk tanpa kunci akan dibuat dua kali saat jaringan buruk, dan kunci
  // tanpa produk akan mengembalikan respons untuk entitas yang tidak ada.
  await db.batch([
    {
      query: `INSERT INTO products (id, artisan_id, status, progress, created_at, updated_at)
              VALUES (?, ?, 'draft', 0, ?, ?)`,
      params: [product.id, artisanId, nowMs, nowMs],
    },
    {
      query: `INSERT INTO idempotency_keys (key, user_id, response_body, created_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET
                response_body = excluded.response_body,
                created_at = excluded.created_at`,
      params: [key.data, artisanId, JSON.stringify(product), nowMs],
    },
  ]);

  return { ok: true, product, replayed: false };
}

function parseCreatedProduct(raw: string): CreatedProduct | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof decoded !== "object" || decoded === null) return null;
  const candidate = decoded as Record<string, unknown>;

  const id = UlidSchema.safeParse(candidate.id);
  const status = ProductStatusSchema.safeParse(candidate.status);
  if (!id.success || !status.success) return null;
  if (typeof candidate.progress !== "number") return null;
  if (typeof candidate.createdAt !== "number") return null;

  return {
    id: id.data,
    status: status.data,
    progress: candidate.progress,
    createdAt: candidate.createdAt,
  };
}

// --- Penerbitan ---

export type PublishResult =
  | { readonly ok: true; readonly product: ProductRecord }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Menerbitkan produk — `POST /products/:id/publish`.
 *
 * Urutan pemeriksaannya disengaja:
 *
 *   1. Izin lebih dulu. Pemanggil yang tidak berhak tidak boleh mengetahui
 *      apa pun tentang keadaan produk — termasuk apakah kontennya lengkap
 *      atau fotonya sudah ada.
 *   2. Persetujuan, karena itu urusan pemilik karya dan bukan soal mutu.
 *   3. Baru kelengkapan konten dan foto.
 *
 * Kelengkapan diperiksa pada bahasa `id` saja. Kontrak API bagian 4
 * menyebutnya eksplisit ("konten `id` belum lengkap"), dan itu masuk akal:
 * bahasa sumber adalah yang diperiksa manusia, sedangkan terjemahan boleh
 * menyusul.
 */
export async function publishProduct(
  db: Db,
  actor: Actor,
  productId: string,
  input: unknown,
  nowMs: number,
): Promise<PublishResult> {
  const parsed = PublishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "CONSENT_REQUIRED" };

  const product = await loadProduct(db, productId);
  if (product === null) return { ok: false, code: "NOT_FOUND" };

  // rbac tidak memeriksa tautan untuk menerbitkan: pendamping tidak pernah
  // dapat menerbitkan, dan memuat tautannya hanya akan membuang satu kueri.
  if (!canPublish(actor, product)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  if (!canTransition(product.status, "published")) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const consent = await requireConsent(db, product.artisanId, "publication");
  if (consent !== null) return { ok: false, code: consent };

  // Lima kueri dalam satu putaran, dan sekaligus sumber pemeriksaan foto.
  const detail = await loadProductDetail(db, productId);
  if (detail === null) return { ok: false, code: "NOT_FOUND" };

  if (!isContentComplete(detail.content.get("id") ?? null)) {
    return { ok: false, code: "CONTENT_INCOMPLETE" };
  }

  if (!detail.media.some((asset) => asset.isPrimary)) {
    return { ok: false, code: "PHOTO_REQUIRED" };
  }

  // `progress` 100 mengikuti contoh produk terbit di kontrak API bagian 4.
  await db.run({
    query: `UPDATE products
            SET status = 'published', progress = 100, published_at = ?, updated_at = ?
            WHERE id = ?`,
    params: [nowMs, nowMs, productId],
  });

  return { ok: true, product: { ...product, status: "published", progress: 100 } };
}

// --- Penghapusan ---

export type DeleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Menghapus produk — `DELETE /products/:id`.
 *
 * `?confirm=true` wajib. Aksi ini menghapus pekerjaan seseorang, dan satu
 * permintaan yang terkirim karena kesalahan jaringan tidak boleh cukup untuk
 * melakukannya.
 *
 * Baris `product_content`, `media_assets`, dan `jobs` ikut terhapus lewat
 * `ON DELETE CASCADE` di migrations/0001 (TC-I-02). Objek di R2 **tidak**
 * ikut terhapus — itu urusan `worker/media`, dan sampai sekarang belum ada
 * yang mengerjakannya.
 */
export async function deleteProduct(
  db: Db,
  actor: Actor,
  productId: string,
  confirmed: boolean,
): Promise<DeleteResult> {
  if (!confirmed) return { ok: false, code: "FORBIDDEN" };

  const product = await loadProduct(db, productId);
  if (product === null) return { ok: false, code: "NOT_FOUND" };

  // Sama seperti menerbitkan: menghapus tidak pernah didelegasikan, jadi
  // tautan pendamping tidak perlu dimuat.
  if (!canDeleteProduct(actor, product)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  await db.run({
    query: "DELETE FROM products WHERE id = ?",
    params: [productId],
  });

  return { ok: true };
}

// --- Pengajuan tinjauan ---

export type StatusChangeResult =
  | { readonly ok: true; readonly product: ProductRecord }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Mengajukan produk untuk ditinjau — `processing` menjadi `review`.
 *
 * Rute HTTP-nya belum ada di kontrak API bagian 4, jadi fungsi ini tidak
 * dipanggil dari mana pun untuk sekarang. Ia tetap ada karena tanpa
 * pemanggil, transisi `processing → review` tidak punya penggerak sama
 * sekali, dan izin `submit_review` yang sudah didefinisikan di
 * `worker/rbac` tidak punya konsumen. Pemanggilnya boleh rute baru atau
 * consumer antrian yang menandai seluruh pekerjaan selesai.
 *
 * Gerbang ADR-008 tidak diulang di sini: yang dijaga adalah transkrip
 * ditinjau **sebelum pemrosesan**, dan itu sudah ditegakkan di
 * `requestGeneration`. Produk yang berstatus `processing` sudah melewatinya.
 */
export async function submitForReview(
  db: Db,
  actor: Actor,
  productId: string,
  nowMs: number,
): Promise<StatusChangeResult> {
  const product = await loadProduct(db, productId);
  if (product === null) return { ok: false, code: "NOT_FOUND" };

  const link = await loadCaregiverLink(db, actor, product);
  if (!canSubmitReview(actor, product, link, nowMs)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  if (!canTransition(product.status, "review")) {
    return { ok: false, code: "FORBIDDEN" };
  }

  await db.run({
    query: "UPDATE products SET status = 'review', updated_at = ? WHERE id = ?",
    params: [nowMs, productId],
  });

  return { ok: true, product: { ...product, status: "review" } };
}

// --- Pemrosesan ---

/** Jenis pekerjaan yang hasilnya per bahasa. */
const LOCALE_SCOPED_TASKS: readonly JobKind[] = ["copy", "tts"];

export interface QueuedJob {
  readonly id: string;
  readonly kind: JobKind;
  readonly status: "queued";
}

export interface GenerationRequest {
  readonly tasks: readonly JobKind[];
  readonly locales: readonly Locale[];
  readonly imageStyle?: ImageStyle;
}

export type GenerationResult =
  | { readonly ok: true; readonly jobs: readonly QueuedJob[] }
  | { readonly ok: false; readonly code: ErrorCode };

/**
 * Menyiapkan pekerjaan AI — `POST /products/:id/generate`.
 *
 * **Gerbang ADR-008 ada di sini.** Transkrip yang belum ditinjau menolak
 * seluruh permintaan dengan `TRANSCRIPT_NOT_REVIEWED`, sebelum satu pekerjaan
 * pun dibuat. Alasannya ada di ADR-008: satu nama produk yang salah dengar
 * akan muncul di cerita, spesifikasi, caption, kata kunci, dan lima bahasa
 * terjemahan. Memperbaiki di hulu berarti menyunting satu kalimat.
 *
 * Setiap bahasa menjadi pekerjaan terpisah untuk `copy` dan `tts`, sesuai
 * F1-07: kegagalan satu bahasa tidak boleh menggagalkan bahasa lain.
 * Pekerjaan gambar tidak per bahasa — satu foto melayani semua bahasa.
 *
 * Status tidak dibatasi di sini. Kontrak API tidak menyebutkan batasnya, dan
 * mengarang satu akan menutup pemrosesan ulang yang mungkin justru
 * dibutuhkan saat demo. Yang dilakukan hanyalah memajukan `draft` menjadi
 * `processing`.
 */
export async function requestGeneration(
  db: Db,
  actor: Actor,
  productId: string,
  input: unknown,
  nowMs: number,
): Promise<GenerationResult> {
  const parsed = GenerateRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "CONTENT_INCOMPLETE" };

  const product = await loadProduct(db, productId);
  if (product === null) return { ok: false, code: "NOT_FOUND" };

  const link = await loadCaregiverLink(db, actor, product);
  if (!canEditDraft(actor, product, link, nowMs)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const unreviewed = await requireReviewedTranscript(db, productId);
  if (unreviewed !== null) return { ok: false, code: unreviewed };

  // Rencana pekerjaan disusun lebih dulu, lalu diterjemahkan menjadi
  // pernyataan. Satu lintasan, satu sumber kebenaran: id yang dikembalikan
  // ke pemanggil adalah id yang benar-benar ditulis.
  const planned: { readonly kind: JobKind; readonly locale: Locale | null }[] = [];
  for (const task of parsed.data.tasks) {
    if (LOCALE_SCOPED_TASKS.includes(task)) {
      for (const locale of parsed.data.locales) planned.push({ kind: task, locale });
    } else {
      planned.push({ kind: task, locale: null });
    }
  }

  const jobs: QueuedJob[] = [];

  // Semua pekerjaan masuk dalam satu putaran. Membuatnya satu per satu akan
  // menunda pekerjaan pertama sampai yang terakhir selesai ditulis, dan
  // membuat jumlah kueri tumbuh seiring jumlah bahasa.
  const statements = planned.map((entry) => {
    const id = ulid();
    jobs.push({ id, kind: entry.kind, status: "queued" });

    const payload =
      entry.kind === "image"
        ? JSON.stringify({
            style: parsed.data.imageStyle ?? "studio",
            prompt: `Buat foto produk studio profesional dari foto produk kerajinan ini dengan gaya ${
              parsed.data.imageStyle ?? "studio"
            }. JANGAN mengubah bentuk, warna, tekstur, atau proporsi produk. Pertahankan seluruh detail apa adanya.`,
          })
        : null;

    return {
      query: `INSERT INTO jobs (id, product_id, kind, status, locale, attempt, progress, payload, created_at)
              VALUES (?, ?, ?, 'queued', ?, 0, 0, ?, ?)`,
      params: [id, productId, entry.kind, entry.locale, payload, nowMs],
    };
  });

  if (product.status === "draft") {
    statements.push({
      query: "UPDATE products SET status = 'processing', updated_at = ? WHERE id = ?",
      params: [nowMs, productId],
    });
  }

  await db.batch(statements);

  return { ok: true, jobs };
}
