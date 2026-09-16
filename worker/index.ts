/**
 * Titik masuk Worker KATAVIS.
 *
 * Tujuh modul dengan batas tegas (ADR-001): auth, rbac, catalog, media,
 * jobs, export, audit. Modul tidak mengimpor bagian dalam modul lain.
 *
 * Bentuk seluruh respons mengikuti docs/spec/API-CONTRACT.md bagian 1.
 */

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  JOBS: Queue;
  AI: Ai;

  ENVIRONMENT: string;
  GEMINI_ENABLED: string;
  DEMO_MODE: string;
  GEMINI_TIMEOUT_MS: string;
  AGENT_HEARTBEAT_TIMEOUT_MS: string;

  GROQ_API_KEY?: string;
  NINEROUTER_API_KEY?: string;
  AGENT_SHARED_KEY?: string;
  JWT_SIGNING_KEY?: string;
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/v1/health") {
      return Response.json({ ok: true, data: { status: "ready" } });
    }

    return Response.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Halaman tidak ditemukan.",
          action: "GO_BACK",
          workSafe: true,
        },
      },
      { status: 404 },
    );
  },

  async queue(_batch: MessageBatch<unknown>, _env: Env): Promise<void> {
    // Konsumen pekerjaan AI. Lihat docs/spec/API-CONTRACT.md bagian 7
    // dan prompt P2 di docs/ops/MODEL-ROUTING.md.
  },
} satisfies ExportedHandler<Env>;
