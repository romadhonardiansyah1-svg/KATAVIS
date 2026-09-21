/**
 * Log aktivitas.
 *
 * Modul ini hanya menulis. Ia tidak memutuskan siapa yang boleh melakukan
 * apa — itu tugas `worker/rbac` — dan tidak tahu apa arti sebuah tindakan.
 * Yang dilakukannya satu: mencatat siapa mengubah apa, dan kapan.
 *
 * Satu kolom menentukan seluruh berkas ini: `on_behalf_of`.
 *
 * ARCHITECTURE bagian 6 menjelaskan mengapa ia ada. Pendamping membantu
 * tanpa mengambil alih akun. Tanpa kolom itu, tindakan pendamping tercatat
 * seolah dilakukan atas namanya sendiri, dan pengrajin kehilangan
 * kemampuan mengaudit siapa mengubah karyanya — persis yang dijanjikan
 * `Fitur pendukung.pdf` halaman 5 dan ditegakkan S3-05.
 *
 * Karena itu aturannya tidak diserahkan pada pemanggil. `logActivity`
 * memeriksa peran aktornya sendiri: pendamping yang bertindak tanpa
 * menyebut pengrajinnya ditolak, dan peran selain pendamping tidak pernah
 * menghasilkan `on_behalf_of` meski pemanggil mengirimkannya.
 */

import { ulid } from "ulid";

import type { Db } from "../db";

/**
 * Siapa yang bertindak.
 *
 * Cukup dua bidang, dan keduanya sudah ada di sesi terverifikasi
 * (`worker/auth.VerifiedSession`). Peran bertipe `string`, bukan union,
 * dengan alasan yang sama seperti di `worker/rbac`: nilainya berasal dari
 * token, jadi ia data luar sampai dicocokkan.
 */
export interface AuditActor {
  readonly id: string;
  readonly role: string;
}

/** Apa yang disentuh. `type` dan `id` memetakan langsung ke dua kolom. */
export interface AuditEntity {
  readonly type: string;
  readonly id: string;
}

export interface ActivityEntry {
  readonly id: string;
  readonly actorId: string;
  /** Terisi hanya bila pendamping bertindak atas nama pengrajin. */
  readonly onBehalfOf: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly metadata: string | null;
  readonly createdAt: number;
}

/**
 * Alasan sebuah catatan ditolak.
 *
 * Ini **bukan** kode galat API dan tidak pernah sampai ke pengrajin. Ia
 * menandai cacat pemanggil: logika bisnis yang mencapai titik ini dengan
 * argumen yang salah. Katalog galat di lib/errors.ts tidak dipakai karena
 * tidak ada satu pun kode di sana yang berarti "pemanggil salah", dan
 * menambahkan kode baru ke sana menuntut perubahan kontrak API.
 */
export type AuditRejection =
  | "CAREGIVER_WITHOUT_ARTISAN"
  | "INVALID_ACTOR"
  | "INVALID_ACTION"
  | "INVALID_ENTITY";

export type AttributionResult =
  | { readonly ok: true; readonly onBehalfOf: string | null }
  | { readonly ok: false; readonly reason: AuditRejection };

/**
 * Menerjemahkan peran menjadi isi kolom `on_behalf_of`.
 *
 * Dua arah yang keduanya penting:
 *
 *   - Pendamping **wajib** membawa pengrajin yang didampinginya. Tanpa itu
 *     catatannya salah, jadi ia ditolak alih-alih ditulis dengan kolom
 *     kosong.
 *   - Peran lain **tidak pernah** menghasilkan `on_behalf_of`, termasuk
 *     bila pemanggil mengirimkannya. Pengrajin yang bertindak atas namanya
 *     sendiri harus tercatat begitu (TC-I-10), dan mengabaikan masukan yang
 *     salah lebih aman daripada mempercayainya.
 */
export function resolveOnBehalfOf(
  actor: AuditActor,
  onBehalfOf: string | null,
): AttributionResult {
  if (actor.role !== "caregiver") return { ok: true, onBehalfOf: null };

  if (onBehalfOf === null || onBehalfOf.trim().length === 0) {
    return { ok: false, reason: "CAREGIVER_WITHOUT_ARTISAN" };
  }

  return { ok: true, onBehalfOf };
}

export type AuditResult =
  | { readonly ok: true; readonly entry: ActivityEntry }
  | { readonly ok: false; readonly reason: AuditRejection };

function isFilled(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Mencatat satu aktivitas.
 *
 * `action` dan `entity` tidak dibatasi kosakata: tidak ada dokumen yang
 * menetapkan daftar nama tindakan, dan mengarang satu di sini berarti
 * modul ini ikut memutuskan sesuatu yang bukan urusannya. Yang diperiksa
 * hanya bahwa keduanya terisi — baris dengan tindakan kosong tidak berguna
 * untuk audit, dan lebih baik ditolak di sini daripada ditemukan setahun
 * kemudian.
 *
 * `metadata` opsional dan disimpan sebagai JSON. Ia yang membedakan catatan
 * "seseorang mengubah produk X" dari "seseorang mengubah produk X, bidang
 * name dan story" — dan untuk karya kelompok rentan, yang kedua jauh lebih
 * berguna saat ditanyakan.
 *
 * Satu pernyataan, satu kueri. Modul ini tidak pernah membaca.
 */
export async function logActivity(
  db: Db,
  actor: AuditActor,
  onBehalfOf: string | null,
  action: string,
  entity: AuditEntity,
  nowMs: number,
  metadata?: Record<string, unknown>,
): Promise<AuditResult> {
  if (!isFilled(actor.id)) return { ok: false, reason: "INVALID_ACTOR" };
  if (!isFilled(action)) return { ok: false, reason: "INVALID_ACTION" };
  if (!isFilled(entity.type) || !isFilled(entity.id)) {
    return { ok: false, reason: "INVALID_ENTITY" };
  }

  const attribution = resolveOnBehalfOf(actor, onBehalfOf);
  if (!attribution.ok) return { ok: false, reason: attribution.reason };

  const entry: ActivityEntry = {
    id: ulid(),
    actorId: actor.id,
    onBehalfOf: attribution.onBehalfOf,
    action,
    entityType: entity.type,
    entityId: entity.id,
    metadata: metadata === undefined ? null : JSON.stringify(metadata),
    createdAt: nowMs,
  };

  await db.run({
    query: `INSERT INTO activity_log
              (id, actor_id, on_behalf_of, action, entity_type, entity_id, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      entry.id,
      entry.actorId,
      entry.onBehalfOf,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.metadata,
      entry.createdAt,
    ],
  });

  return { ok: true, entry };
}
