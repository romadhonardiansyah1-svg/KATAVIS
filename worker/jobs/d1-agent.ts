/**
 * Akses D1 untuk antrian Studio Agent.
 *
 * Studio Agent di laptop mengambil pekerjaan gambar dari sini, dan heartbeat
 * -nya menentukan apakah rantai penyedia masih boleh menunggu Gemini atau
 * harus langsung ke Workers AI (TC-SA-02).
 *
 * Aturan siklus hidup pekerjaan tetap di `lifecycle.ts`, yang murni.
 */

import { d1ListJobs, type JobRecord } from "./d1-jobs";

export interface AgentHeartbeat {
  readonly agentId: string;
  readonly healthy: boolean;
  readonly selectorsOk: boolean;
  readonly chromeSessionOk: boolean;
}

export interface LatestHeartbeat {
  readonly agentId: string;
  readonly lastSeenAt: number;
  readonly healthy: boolean;
}

export async function d1UpsertHeartbeat(
  db: D1Database,
  heartbeat: AgentHeartbeat,
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO agent_heartbeats
         (agent_id, healthy, selectors_ok, chrome_session_ok, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET
         healthy = excluded.healthy,
         selectors_ok = excluded.selectors_ok,
         chrome_session_ok = excluded.chrome_session_ok,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      heartbeat.agentId,
      heartbeat.healthy ? 1 : 0,
      heartbeat.selectorsOk ? 1 : 0,
      heartbeat.chromeSessionOk ? 1 : 0,
      nowMs,
    )
    .run();
}

/** Heartbeat terbaru dari agen mana pun. null berarti belum ada agen yang melapor. */
export async function d1LatestHeartbeat(db: D1Database): Promise<LatestHeartbeat | null> {
  const row = await db
    .prepare(
      `SELECT agent_id, healthy, last_seen_at FROM agent_heartbeats
       ORDER BY last_seen_at DESC LIMIT 1`,
    )
    .first<{ readonly agent_id: string; readonly healthy: number; readonly last_seen_at: number }>();

  if (row === null) return null;

  return {
    agentId: row.agent_id,
    lastSeenAt: row.last_seen_at,
    healthy: row.healthy === 1,
  };
}

/**
 * Menyiapkan satu pekerjaan.
 *
 * Dipakai `POST /products/:id/audio`, yang membuat pekerjaan ASR di luar
 * `requestGeneration` — perekaman bukan bagian dari pemrosesan konten, dan
 * transkripnya justru yang harus ditinjau sebelum pemrosesan dimulai
 * (ADR-008).
 */
export async function d1InsertJob(
  db: D1Database,
  job: { readonly id: string; readonly productId: string; readonly kind: string },
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO jobs (id, product_id, kind, status, attempt, progress, created_at)
       VALUES (?, ?, ?, 'queued', 0, 0, ?)`,
    )
    .bind(job.id, job.productId, job.kind, nowMs)
    .run();
}

export interface ClaimedJob {
  readonly id: string;
  readonly productId: string;
  readonly sourceImageUrl: string | null;
  readonly prompt: string;
  readonly deadlineAt: number;
}

/**
 * Mengambil pekerjaan gambar yang menunggu.
 *
 * Dua kueri, bukan satu per pekerjaan. Yang pertama menandai sekaligus
 * mengambil pekerjaannya lewat `RETURNING`; yang kedua mengambil kunci foto
 * asli untuk seluruh produk yang terlibat sekaligus. Pola N+1 di sini akan
 * terasa tepat saat antriannya sedang panjang — yaitu saat demo.
 *
 * `deadline_at` disimpan sebagai waktu absolut, bukan durasi: agen yang
 * jamnya bergeser tetap tahu kapan harus berhenti.
 */
export async function d1ClaimImageJobs(
  db: D1Database,
  input: {
    readonly agentId: string;
    readonly max: number;
    readonly deadlineAt: number;
    readonly provider: string;
  },
  nowMs: number,
): Promise<readonly ClaimedJob[]> {
  const claimed = await db
    .prepare(
      `UPDATE jobs
       SET status = 'running', claimed_by = ?, started_at = ?, deadline_at = ?,
           attempt = attempt + 1, provider = ?, progress = 0
       WHERE id IN (
         SELECT id FROM jobs
         WHERE kind = 'image' AND status = 'queued'
         ORDER BY created_at
         LIMIT ?
       )
       RETURNING id, product_id, payload, deadline_at`,
    )
    .bind(input.agentId, nowMs, input.deadlineAt, input.provider, input.max)
    .all<{
      readonly id: string;
      readonly product_id: string;
      readonly payload: string | null;
      readonly deadline_at: number | null;
    }>();

  const productIds = claimed.results.map((row) => row.product_id);
  const sourceKeys = await d1FindSourceKeys(db, productIds);

  return claimed.results.map((row) => ({
    id: row.id,
    productId: row.product_id,
    sourceImageUrl: sourceKeys.get(row.product_id) ?? null,
    prompt: promptFromPayload(row.payload),
    deadlineAt: row.deadline_at ?? input.deadlineAt,
  }));
}

async function d1FindSourceKeys(
  db: D1Database,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (productIds.length === 0) return new Map();

  const placeholders = productIds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT product_id, r2_key FROM media_assets
       WHERE product_id IN (${placeholders})
         AND kind = 'photo_original' AND upload_status = 'confirmed'
       ORDER BY created_at`,
    )
    .bind(...productIds)
    .all<{ readonly product_id: string; readonly r2_key: string }>();

  const keys = new Map<string, string>();
  for (const row of rows.results) {
    if (!keys.has(row.product_id)) keys.set(row.product_id, row.r2_key);
  }

  return keys;
}

function promptFromPayload(payload: string | null): string {
  if (payload === null) return "";

  try {
    const decoded = JSON.parse(payload) as { prompt?: unknown };
    return typeof decoded.prompt === "string" ? decoded.prompt : "";
  } catch {
    // Muatan bukan JSON. Prompt kosong, bukan alasan menggagalkan klaim —
    // agen tetap dapat bekerja dan kegagalannya akan terlihat di sana.
    return "";
  }
}

export async function d1FindJob(db: D1Database, jobId: string): Promise<JobRecord | null> {
  const jobs = await db
    .prepare("SELECT product_id FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ readonly product_id: string }>();

  if (jobs === null) return null;

  const all = await d1ListJobs(db, jobs.product_id);
  return all.find((job) => job.id === jobId) ?? null;
}

/**
 * Menandai pekerjaan selesai.
 *
 * Syarat `status = 'running'` ada di dalam WHERE supaya dua laporan yang
 * tiba bersamaan tidak sama-sama dianggap berhasil.
 */
export async function d1CompleteJob(
  db: D1Database,
  jobId: string,
  nowMs: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs
       SET status = 'succeeded', progress = 100, completed_at = ?, error_code = NULL
       WHERE id = ? AND status = 'running'`,
    )
    .bind(nowMs, jobId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/**
 * Mengembalikan pekerjaan ke antrian setelah Gemini gagal.
 *
 * Bukan `failed`: kontrak API bagian 8 menyatakan kegagalan mengembalikan
 * pekerjaan ke antrian dengan penanda `gemini_failed`, lalu consumer Workers
 * AI mengambilnya. Status `failed` akan membuat pekerjaan itu berhenti
 * padahal penyedia cadangannya belum pernah dicoba.
 *
 * Alasan mentahnya disimpan di `payload`, sedangkan `error_code` memakai
 * kode katalog — kode itulah yang sampai ke antarmuka, dan pesannya harus
 * terbaca pengrajin.
 */
export async function d1ReturnJobToQueue(
  db: D1Database,
  jobId: string,
  input: { readonly reason: string; readonly fallbackProvider: string },
  nowMs: number,
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT payload FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ readonly payload: string | null }>();

  if (existing === null) return false;

  let merged: Record<string, unknown> = {};
  if (existing.payload !== null) {
    try {
      const decoded: unknown = JSON.parse(existing.payload);
      if (typeof decoded === "object" && decoded !== null) {
        merged = decoded as Record<string, unknown>;
      }
    } catch {
      // Muatan lama bukan JSON. Ia digantikan, bukan dibiarkan menggagalkan
      // pengembalian pekerjaan ke antrian.
    }
  }

  const result = await db
    .prepare(
      `UPDATE jobs
       SET status = 'queued', provider = ?, error_code = 'IMAGE_GENERATE_FAILED',
           payload = ?, claimed_by = NULL, deadline_at = NULL, started_at = NULL,
           completed_at = NULL, progress = 0
       WHERE id = ? AND status = 'running'`,
    )
    .bind(
      input.fallbackProvider,
      JSON.stringify({ ...merged, geminiFailure: input.reason, failedAt: nowMs }),
      jobId,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/** Mengembalikan pekerjaan yang gagal ke antrian untuk dicoba ulang. */
export async function d1RetryJob(
  db: D1Database,
  jobId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE jobs
       SET status = 'queued', attempt = attempt + 1, progress = 0, error_code = NULL,
           provider = NULL, claimed_by = NULL, started_at = NULL, completed_at = NULL,
           deadline_at = NULL
       WHERE id = ? AND status IN ('failed', 'cancelled')`,
    )
    .bind(jobId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}
