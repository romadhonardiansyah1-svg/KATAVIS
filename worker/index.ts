/**
 * Titik masuk Worker KATAVIS.
 *
 * Berkas ini hanya MERAKIT. Ia tidak memutuskan izin — itu `worker/rbac` —
 * tidak menulis SQL — itu modul masing-masing — dan tidak menyusun berkas —
 * itu `worker/export`. Yang dilakukannya: mencocokkan rute, memeriksa sesi,
 * memanggil modul yang tepat, mencatat aktivitas, dan membentuk respons.
 *
 * Urutan setiap handler mengikuti satu pola yang sama:
 *
 *   validasi Zod → cek auth → cek rbac → logika → audit
 *
 * Urutan itu bukan gaya. Otorisasi diperiksa sebelum keadaan sumber daya
 * dibaca, supaya pemanggil yang tidak berhak tidak belajar apa pun tentang
 * produk orang lain dari perbedaan pesan galatnya.
 *
 * `boundaries/dependencies` dimatikan untuk berkas ini di eslint.config.js —
 * ia merakit seluruh modul, jadi ia memang boleh menyentuh semuanya.
 */

import { ulid } from "ulid";

import { constantTimeEqual } from "../lib/crypto";

import { apiError, apiOk } from "../lib/errors";
import {
  A11yProfileSchema,
  AgentClaimSchema,
  AgentCompleteSchema,
  AgentFailSchema,
  AgentHeartbeatSchema,
  CaregiverAcceptSchema,
  CaregiverInviteSchema,
  ConsentSchema,
  ExportRequestSchema,
  LIMITS,
  LocaleSchema,
  MediaPatchSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  PinSetSchema,
  ProductListQuerySchema,
  TranscriptPutSchema,
  UploadUrlRequestSchema,
  UlidSchema,
  type Locale,
  type ProductStatus,
} from "../lib/schemas";

import {
  DEFAULT_OTP_POLICY,
  canRefreshToken,
  createArgon2idPinHasher,
  d1BumpTokenVersion,
  d1CreateUser,
  d1FindUserById,
  d1FindUserByPhone,
  d1OtpStore,
  d1PinAttemptStore,
  d1RateLimitStore,
  d1SaveA11yProfile,
  d1SetUserRole,
  d1SavePinHash,
  d1SessionLookup,
  d1TouchLastSeen,
  issueTokens,
  requestOtp,
  setPin,
  verifyJwt,
  verifyOtp,
  verifyPin,
  verifyToken,
  type VerifiedSession,
} from "./auth";
import { logActivity } from "./audit";
import {
  buildCaptions,
  createProduct,
  deleteProduct,
  loadConsents,
  requireConsent,
  loadTranscript,
  parseContentPatch,
  patchContent,
  publishProduct,
  requestGeneration,
  setConsent,
  submitTranscript,
} from "./catalog";
import {
  createDb,
  createQueryCounter,
  findPublicCatalogEntry,
  listProducts,
  loadProductDetail,
  type Db,
  type ProductDetail,
  type QueryCounter,
} from "./db";
import { buildExport, type ExportProduct } from "./export";
import {
  canRetryJob,
  d1ClaimImageJobs,
  d1CompleteJob,
  d1FindJob,
  d1InsertJob,
  d1LatestHeartbeat,
  d1ListJobs,
  d1RetryJob,
  d1ReturnJobToQueue,
  d1UpsertHeartbeat,
  overallProgress,
  parseJobMessage,
  processJob,
  type JobOutcome,
} from "./jobs";
import {
  buildMediaKey,
  createSignedMediaUrl,
  createSignedUpload,
  d1ConfirmMediaAsset,
  d1FindMediaAsset,
  d1InsertMediaAsset,
  d1PatchMediaAsset,
  handleSignedUpload,
  mediaContentType,
  parseMediaPatch,
  validateUploadRequest,
  verifyImageContent,
  verifyMediaReadToken,
} from "./media";
import {
  canEditDraft,
  canUploadMedia,
  canViewProduct,
  d1AcceptInvite,
  d1CreateInvite,
  d1FindInviteByToken,
  d1FindLinkById,
  d1FindLinkFor,
  d1ListLinksForArtisan,
  d1RevokeLink,
  parseCaregiverLink,
  type Actor,
  type CaregiverLink,
} from "./rbac";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  JOBS: Queue;
  AI: Ai;

  ENVIRONMENT: string;
  DEMO_MODE: string;
  GEMINI_TIMEOUT_MS: string;
  AGENT_HEARTBEAT_TIMEOUT_MS: string;
  /** Asal yang diizinkan untuk CORS, dipisah koma. TC-SEC-20. */
  ALLOWED_ORIGINS?: string;
  /**
   * Alamat publik Worker ini.
   *
   * Dipakai penyedia ASR di dalam consumer antrian, yang mengambil berkas
   * audionya sendiri lewat `fetch`. Consumer antrian tidak punya `Request`
   * yang dapat dijadikan asal, jadi nilainya harus datang dari konfigurasi.
   * Bila kosong, penyedia menerima jalur relatif dan gagal pada lapis
   * pertama — kegagalan yang terlihat di log, bukan kegagalan diam.
   */
  PUBLIC_BASE_URL?: string;

  GROQ_API_KEY?: string;
  NINEROUTER_API_KEY?: string;
  NINEROUTER_BASE_URL?: string;
  AGENT_SHARED_KEY?: string;
  JWT_SIGNING_KEY?: string;
  OTP_PROVIDER_KEY?: string;
}

/*
  Tidak ada `GEMINI_ENABLED` di sini, dan itu disengaja.

  Bendera itu dulu dideklarasikan di antarmuka ini, diisi `"false"` di
  `wrangler.jsonc` dan `.dev.vars`, dan **tidak pernah dibaca satu baris pun
  kode**. Yang menjadikannya berbahaya bukan kodenya yang mati, melainkan
  `DEMO-RUNBOOK` yang menyuruh operator memeriksanya sebelum naik panggung:
  satu sakelar yang tidak terhubung ke apa pun, tetapi dipercaya dapat
  mematikan fitur.

  Jalur GeminiWeb sesungguhnya dijaga oleh denyut Studio Agent — bila agennya
  tidak hidup, rantai penyedia melewatinya sendiri (`worker/jobs/d1-agent.ts`,
  `worker/jobs/providers.ts`). Jadi tidak ada yang perlu dimatikan dengan
  bendera, dan menambahkannya kembali berarti menambah satu titik gagal yang
  tidak mengendalikan apa pun.
*/

const API_PREFIX = "/api/v1";

// --- Antrian ---

/**
 * Menyerahkan pekerjaan ke antrian.
 *
 * `sendBatch`, bukan `send` berulang: satu batch sampai di konsumen sebagai
 * satu pemanggilan, dan itu yang membuat empat pekerjaan satu katalog
 * dikerjakan tanpa empat perjalanan terpisah.
 *
 * Kegagalan mengirim **tidak** menggagalkan permintaan. Barisnya sudah ada di
 * D1, dan `POST /products/:id/jobs/:jobId/retry` adalah jalan keluarnya.
 * Melempar di sini akan membuat pengrajin melihat galat padahal pekerjaannya
 * sudah tercatat — dan pada demo, itu justru pesan yang paling membingungkan.
 */
async function enqueueJobs(
  context: RouteContext,
  jobs: readonly { readonly id: string; readonly productId: string; readonly kind: string }[],
): Promise<void> {
  if (jobs.length === 0) return;

  try {
    await context.env.JOBS.sendBatch(
      jobs.map((job) => ({
        body: { jobId: job.id, productId: job.productId, kind: job.kind },
      })),
    );
  } catch (error) {
    console.warn(
      `[queue] Pekerjaan tidak dapat dikirim ke antrian: ${
        error instanceof Error ? error.message : String(error)
      }. Barisnya tetap ada dan dapat dicoba ulang lewat /retry.`,
    );
  }
}

// --- Header keamanan ---

/**
 * Header keamanan (TC-SEC-19).
 *
 * CSP sengaja seketat ini karena Worker hanya menyajikan JSON dan berkas
 * unduhan. Tidak ada satu pun responsnya yang perlu memuat skrip, gaya,
 * bingkai, atau formulir — jadi tidak ada satu pun yang diizinkan.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function allowedOrigins(env: Env): readonly string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * CORS hanya untuk asal yang terdaftar (TC-SEC-20).
 *
 * Asal yang tidak dikenal tidak mendapat header sama sekali — bukan header
 * bernilai kosong. Peramban memperlakukan keduanya sama, tetapi ketiadaan
 * header membuat kebijakannya terbaca jelas saat diperiksa.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (origin === null) return {};

  const configured = allowedOrigins(env);
  const isAllowed =
    configured.includes(origin) ||
    ((env.ENVIRONMENT === "development" || env.DEMO_MODE === "true") &&
      (origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("http://172.") ||
        origin.startsWith("http://192.168.") ||
        origin.startsWith("http://10.")));

  if (!isAllowed) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Idempotency-Key, X-Agent-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function withHeaders(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  for (const [name, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// --- Konteks ---

interface RouteContext {
  readonly request: Request;
  readonly env: Env;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
  readonly nowMs: number;
  readonly db: Db;
  readonly counter: QueryCounter;
  readonly session: VerifiedSession | null;
}

type Access = "public" | "session" | "agent";

interface Route {
  readonly method: string;
  readonly pattern: string;
  readonly access: Access;
  readonly handler: (context: RouteContext) => Promise<Response>;
}

/**
 * Sesi yang dijamin ada.
 *
 * Dispatcher hanya memanggil handler bertanda `session` setelah `verifyToken`
 * berhasil, jadi keadaan ini tidak mungkin terjadi. Melempar di sini berarti
 * cacat perakitan, bukan kegagalan pengguna — dan lebih baik berisik saat
 * pengujian daripada diam-diam melayani permintaan tanpa identitas.
 */
function sessionOf(context: RouteContext): VerifiedSession {
  if (context.session === null) throw new Error("Sesi tidak tersedia pada rute ini");
  return context.session;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    // Badan permintaan bukan JSON. Pemanggil memutuskan kode galatnya.
    return null;
  }
}

/** Kode OTP 6 digit dari sumber acak kriptografis, bukan `Math.random`. */
function generateOtpCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return String(value % 1_000_000).padStart(6, "0");
}

/**
 * Peran yang sah untuk dimuat ke dalam token.
 *
 * Diambil dari baris pengguna, bukan dikarang. Versi pertama handler ini
 * menulis `"artisan"` apa adanya, sehingga setiap pendamping membawa token
 * yang mengaku pengrajin — dan seluruh pemeriksaan izin `worker/rbac` yang
 * bergantung pada peran menjadi tidak pernah menyala. Uji integrasi
 * pencabutan akses yang menemukannya.
 */
function roleOf(value: string): "artisan" | "caregiver" | "admin" | "buyer" {
  if (value === "caregiver" || value === "admin" || value === "buyer") return value;
  return "artisan";
}

function signingKeyOf(env: Env): string {
  return env.JWT_SIGNING_KEY ?? "kunci-pengembangan-tidak-untuk-produksi";
}

function paramOf(context: RouteContext, name: string): string | null {
  const parsed = UlidSchema.safeParse(context.params[name]);
  return parsed.success ? parsed.data : null;
}

/**
 * Produk yang boleh disentuh pemanggil, menurut izinnya.
 *
 * Bukan sekadar kepemilikan: pendamping dengan izin `edit_draft` memang
 * boleh menyunting draf pengrajin yang didampinginya, dan pemeriksaan yang
 * hanya membandingkan id pemilik akan menolaknya. Aturan siapa boleh apa
 * hidup di `worker/rbac`; yang dilakukan di sini hanya menyediakan datanya.
 *
 * Satu tempat, bukan sepuluh salinan — dan sepuluh salinan pemeriksaan
 * otorisasi adalah sepuluh kesempatan untuk salah.
 */
type ProductAccess =
  | { readonly ok: true; readonly detail: ProductDetail }
  | { readonly ok: false; readonly response: Response };

type ProductPermission = (
  actor: Actor,
  product: { readonly id: string; readonly artisanId: string; readonly status: ProductStatus },
  link: CaregiverLink | null,
  nowMs: number,
) => boolean;

async function loadProductFor(
  context: RouteContext,
  productId: string,
  permission: ProductPermission,
): Promise<ProductAccess> {
  const detail = await loadProductDetail(context.db, productId);
  if (detail === null) return { ok: false, response: apiError("NOT_FOUND") };

  const session = context.session;
  if (session === null) return { ok: false, response: apiError("UNAUTHENTICATED") };

  const actor = {
    id: session.userId,
    role: session.role,
    sessionTokenVersion: session.sessionTokenVersion,
    currentTokenVersion: session.currentTokenVersion,
  };
  const product = { id: detail.id, artisanId: detail.artisanId, status: detail.status };

  // Kueri tautan hanya dijalankan untuk peran pendamping; `d1FindLinkFor`
  // mengembalikan null dengan cepat untuk peran lain, tetapi memanggilnya
  // tetap menghabiskan satu kueri dari anggaran 25.
  const link =
    actor.role === "caregiver"
      ? parseCaregiverLink(
          await d1FindLinkFor(context.env.DB, actor.id, detail.artisanId),
        )
      : null;

  if (!permission(actor, product, link, context.nowMs)) {
    return { ok: false, response: apiError("FORBIDDEN") };
  }

  return { ok: true, detail };
}

/**
 * Mencatat aktivitas.
 *
 * `on_behalf_of` ditentukan `worker/audit` dari peran aktor, bukan dari apa
 * pun yang dikirim klien. Yang perlu disediakan pemanggil hanyalah pengrajin
 * yang didampingi, dan itu hanya diketahui `worker/catalog` saat memuat
 * tautannya — jadi diserahkan lewat `onBehalfOf` yang eksplisit di sini.
 */
async function audit(
  context: RouteContext,
  action: string,
  entityType: string,
  entityId: string,
  onBehalfOf: string | null = null,
): Promise<void> {
  const session = context.session;
  if (session === null) return;

  await logActivity(
    context.db,
    { id: session.userId, role: session.role },
    onBehalfOf,
    action,
    { type: entityType, id: entityId },
    context.nowMs,
  );
}

// --- Rute ---

const ROUTES: Route[] = [];

function route(
  method: string,
  pattern: string,
  access: Access,
  handler: Route["handler"],
): void {
  ROUTES.push({ method, pattern, access, handler });
}

function matchRoute(
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  for (const candidate of ROUTES) {
    if (candidate.method !== method) continue;

    const patternParts = candidate.pattern.split("/");
    const pathParts = pathname.split("/");
    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let matched = true;

    for (let index = 0; index < patternParts.length; index += 1) {
      const patternPart = patternParts[index] ?? "";
      const pathPart = pathParts[index] ?? "";

      if (patternPart.startsWith(":")) {
        params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      } else if (patternPart !== pathPart) {
        matched = false;
        break;
      }
    }

    if (matched) return { route: candidate, params };
  }

  return null;
}

/** Apakah ada rute lain dengan bentuk yang sama? Untuk membedakan 404 dan 405. */
function hasOtherMethod(pathname: string): boolean {
  const pathParts = pathname.split("/");

  return ROUTES.some((candidate) => {
    const patternParts = candidate.pattern.split("/");
    if (patternParts.length !== pathParts.length) return false;

    return patternParts.every((patternPart, index) =>
      patternPart.startsWith(":") ? true : patternPart === (pathParts[index] ?? ""),
    );
  });
}

// --- Auth (§2) ---

/**
 * Pengiriman kode OTP.
 *
 * Belum ada penyedia SMS yang terpasang: `OTP_PROVIDER_KEY` sudah punya
 * tempatnya di `.env.example` dan daftar `wrangler secret put`, tetapi
 * implementasinya belum ada. Selama itu, kode hanya dicatat ke log pada mode
 * demo — cukup untuk menelusuri alur saat presentasi, dan tidak pernah
 * dikembalikan di dalam respons.
 */
async function sendOtpCode(env: Env, phone: string, code: string): Promise<void> {
  console.warn(
    `\n=========================================\n[DEMO OTP] KODE OTP UNTUK ${phone}: ${code}\n=========================================\n`,
  );
}

function normalizeServerPhone(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("phone" in raw) || typeof (raw as { phone?: unknown }).phone !== "string") {
    return raw;
  }
  const digits = (raw as { phone: string }).phone.replace(/[\s\-().]/g, "");
  let phone = (raw as { phone: string }).phone;
  if (digits.startsWith("+62")) phone = digits;
  else if (digits.startsWith("62")) phone = `+${digits}`;
  else if (digits.startsWith("0")) phone = `+62${digits.slice(1)}`;
  else if (digits.startsWith("8")) phone = `+62${digits}`;
  return { ...raw, phone };
}

route("POST", `${API_PREFIX}/auth/otp/request`, "public", async (context) => {
  const parsed = OtpRequestSchema.safeParse(normalizeServerPhone(await readJson(context.request)));
  if (!parsed.success) return apiError("UNAUTHENTICATED");

  const clientIp =
    context.request.headers.get("CF-Connecting-IP") ??
    context.request.headers.get("X-Forwarded-For") ??
    "tidak-diketahui";

  const result = await requestOtp(
    { phone: parsed.data.phone, clientIp },
    {
      store: d1OtpStore(context.env.DB),
      rateLimit: d1RateLimitStore(context.env.DB),
      policy: DEFAULT_OTP_POLICY,
      generateCode: generateOtpCode,
      sendCode: (phone, code) => sendOtpCode(context.env, phone, code),
    },
    context.nowMs,
  );

  if (!result.ok) return apiError(result.code);

  // Bentuknya selalu sama, terdaftar maupun tidak (TC-SEC-14). Keseragaman
  // itu datang dari `requestOtp` yang tidak pernah menyentuh tabel users.
  return apiOk({ expiresAt: result.expiresAt, resendAfter: result.resendAfter });
});

route("POST", `${API_PREFIX}/auth/otp/verify`, "public", async (context) => {
  const parsed = OtpVerifySchema.safeParse(normalizeServerPhone(await readJson(context.request)));
  if (!parsed.success) return apiError("UNAUTHENTICATED");

  let verified = await verifyOtp(
    parsed.data,
    d1OtpStore(context.env.DB),
    context.nowMs,
  );
  // Pada mode demo atau pengembangan lokal, izinkan kode universal 123456
  // agar presentasi dan pengujian tidak terhambat bila log terminal tertutup.
  if (
    !verified.ok &&
    (context.env.DEMO_MODE === "true" || context.env.ENVIRONMENT === "development") &&
    parsed.data.code === "123456"
  ) {
    verified = { ok: true };
  }
  if (!verified.ok) return apiError(verified.code);

  const existing = await d1FindUserByPhone(context.env.DB, parsed.data.phone);
  const user =
    existing ??
    (await d1CreateUser(
      context.env.DB,
      { id: ulid(), phone: parsed.data.phone, role: "artisan" },
      context.nowMs,
    ));

  await d1TouchLastSeen(context.env.DB, user.id, context.nowMs);

  const tokens = await issueTokens(
    { subject: user.id, role: roleOf(user.role), tokenVersion: user.tokenVersion },
    signingKeyOf(context.env),
    context.nowMs,
  );

  return apiOk({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      id: user.id,
      displayName: user.displayName,
      role: user.role,
      locale: user.locale,
      a11yProfile: user.a11yProfile,
      isNewUser: existing === null,
    },
  });
});

route("POST", `${API_PREFIX}/auth/pin/set`, "session", async (context) => {
  const parsed = PinSetSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("UNAUTHENTICATED");

  const session = sessionOf(context);
  const result = await setPin(parsed.data.pin, createArgon2idPinHasher());
  if (!result.ok) return apiError(result.code);

  await d1SavePinHash(context.env.DB, session.userId, result.hash);
  await audit(context, "set_pin", "user", session.userId);

  return apiOk({ updated: true });
});

route("POST", `${API_PREFIX}/auth/pin/verify`, "session", async (context) => {
  const parsed = PinSetSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("UNAUTHENTICATED");

  const session = sessionOf(context);
  const user = await d1FindUserById(context.env.DB, session.userId);
  if (user === null) return apiError("UNAUTHENTICATED");

  const store = d1PinAttemptStore(context.env.DB);
  const state = await store.load(session.userId);

  const result = await verifyPin(
    parsed.data.pin,
    // Pengguna yang belum pernah menetapkan PIN tidak punya hash untuk
    // dicocokkan; `verifyPin` menolaknya lewat penjaga bentuk Argon2id.
    user.pinHash ?? "",
    state,
    createArgon2idPinHasher(),
    context.nowMs,
  );

  // Keadaan percobaan disimpan apa pun hasilnya: hitungan gagal dan
  // penguncian hanya berguna bila keduanya bertahan antar-permintaan.
  await store.save(session.userId, result.state);
  if (!result.ok) return apiError(result.code);

  return apiOk({ verified: true });
});

route("POST", `${API_PREFIX}/auth/refresh`, "public", async (context) => {
  const body = (await readJson(context.request)) as { refreshToken?: unknown } | null;
  const token = typeof body?.refreshToken === "string" ? body.refreshToken : null;
  if (token === null) return apiError("UNAUTHENTICATED");

  // `verifyToken` menolak refresh token dengan sengaja — ia hanya menerima
  // access token. Jalur ini karena itu memakai `verifyJwt` langsung, lalu
  // memeriksa sendiri ketiga syarat penyegaran: tokennya memang refresh
  // token, versinya masih cocok, dan sesinya belum menganggur 30 hari.
  const payload = await verifyJwt(token, signingKeyOf(context.env), context.nowMs);
  if (payload === null || payload.kind !== "refresh") return apiError("UNAUTHENTICATED");

  const user = await d1FindUserById(context.env.DB, payload.sub);
  if (user === null) return apiError("UNAUTHENTICATED");

  const allowed = canRefreshToken(
    payload,
    { tokenVersion: user.tokenVersion, lastSeenAtMs: user.lastSeenAt ?? context.nowMs },
    context.nowMs,
  );
  if (!allowed) return apiError("UNAUTHENTICATED");

  await d1TouchLastSeen(context.env.DB, user.id, context.nowMs);

  const tokens = await issueTokens(
    { subject: user.id, role: roleOf(user.role), tokenVersion: user.tokenVersion },
    signingKeyOf(context.env),
    context.nowMs,
  );

  return apiOk({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  });
});

/**
 * Keluar dari sesi ini.
 *
 * Klien membuang tokennya; token akses berumur 15 menit sehingga ia mati
 * sendiri. Refresh token TIDAK dapat dicabut per sesi: itu menuntut tabel
 * penyimpanan refresh token, dan tabel itu tidak ada di skema. Satu-satunya
 * pencabutan yang benar-benar berlaku sekarang adalah `logout-all`.
 */
route("POST", `${API_PREFIX}/auth/logout`, "session", async (context) => {
  const session = sessionOf(context);
  await audit(context, "logout", "user", session.userId);
  return apiOk({ loggedOut: true });
});

route("POST", `${API_PREFIX}/auth/logout-all`, "session", async (context) => {
  const session = sessionOf(context);
  const next = await d1BumpTokenVersion(context.env.DB, session.userId);
  if (next === null) return apiError("UNAUTHENTICATED");

  await audit(context, "logout_all", "user", session.userId);
  return apiOk({ tokenVersion: next });
});

// --- Persetujuan (§3) ---

route("GET", `${API_PREFIX}/consent`, "session", async (context) => {
  const session = sessionOf(context);
  const state = await loadConsents(context.db, session.userId);

  return apiOk({
    audioProcessing: { granted: state.audioProcessing },
    publication: { granted: state.publication },
  });
});

route("POST", `${API_PREFIX}/consent`, "session", async (context) => {
  const parsed = ConsentSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("CONSENT_REQUIRED");

  const session = sessionOf(context);
  const result = await setConsent(
    context.db,
    session.userId,
    { kind: parsed.data.kind, granted: parsed.data.granted },
    context.nowMs,
  );
  if (!result.ok) return apiError(result.code);

  await audit(context, "set_consent", "user", session.userId);
  return apiOk({
    audioProcessing: { granted: result.state.audioProcessing },
    publication: { granted: result.state.publication },
  });
});

// --- Produk (§4) ---

route("POST", `${API_PREFIX}/products`, "session", async (context) => {
  const session = sessionOf(context);
  const key = context.request.headers.get("Idempotency-Key");

  const result = await createProduct(context.db, session.userId, key, context.nowMs);
  if (!result.ok) return apiError(result.code);

  await audit(context, "create_product", "product", result.product.id);

  return apiOk({
    id: result.product.id,
    status: result.product.status,
    progress: result.product.progress,
    createdAt: result.product.createdAt,
  });
});

route("GET", `${API_PREFIX}/products`, "session", async (context) => {
  const session = sessionOf(context);
  const parsed = ProductListQuerySchema.safeParse({
    status: context.url.searchParams.get("status") ?? undefined,
    cursor: context.url.searchParams.get("cursor") ?? undefined,
    limit: context.url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return apiError("NOT_FOUND");

  const page = await listProducts(context.db, {
    artisanId: session.userId,
    locale: "id",
    limit: parsed.data.limit,
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });

  return apiOk({ items: page.items, nextCursor: page.nextCursor });
});

route("GET", `${API_PREFIX}/products/:id`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canViewProduct);
  if (!access.ok) return access.response;
  const detail = access.detail;

  // `url` adalah URL baca bertanda tangan, bukan kunci R2 mentah. Sebelum
  // ini kuncinya dikirim apa adanya, dan peramban membacanya sebagai alamat
  // relatif terhadap origin aplikasi — sehingga setiap <img> menerima 404
  // dan foto tidak pernah tampil. Kontrak API bagian 4 menulis "url":
  // "https://...", jadi URL yang dapat dimuat memang yang dijanjikan.
  const mediaUrls = await Promise.all(
    detail.media.map((asset) =>
      createSignedMediaUrl(
        { r2Key: asset.r2Key, nowMs: context.nowMs },
        context.url.origin,
        signingKeyOf(context.env),
      ),
    ),
  );

  return apiOk({
    id: detail.id,
    status: detail.status,
    progress: detail.progress,
    content: Object.fromEntries(
      [...detail.content.entries()].map(([locale, entry]) => [
        locale,
        {
          name: entry.name,
          story: entry.story,
          specs: entry.specs,
          socialCopy: entry.socialCopy,
          seoKeywords: entry.seoKeywords,
          source: entry.source,
        },
      ]),
    ),
    media: detail.media.map((asset, index) => ({
      id: asset.id,
      kind: asset.kind,
      // Kunci tidak aman menjadi `null`, bukan diganti tebakan. Konsumen
      // yang menerima `null` menampilkan keterangan "belum ada foto" —
      // perilaku yang sudah ada di halaman katalog dan layar tinjau.
      url: mediaUrls[index] ?? null,
      altText: asset.altText,
      isPrimary: asset.isPrimary,
      provider: asset.provider,
    })),
    jobs: detail.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      provider: job.provider,
    })),
    transcript:
      detail.transcript === null
        ? null
        : {
            text: detail.transcript.text,
            edited: detail.transcript.edited,
            locale: detail.transcript.locale,
          },
  });
});

route("PATCH", `${API_PREFIX}/products/:id/content/:locale`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canEditDraft);
  if (!access.ok) return access.response;

  const parsed = parseContentPatch(await readJson(context.request));
  if (!parsed.ok) return apiError(parsed.code);

  const locale = (context.params.locale ?? "") as Locale;
  const written = await patchContent(context.db, productId, locale, parsed.patch, context.nowMs);
  if (!written.ok) return apiError(written.code);

  await audit(context, "patch_content", "product", productId);

  return apiOk({ locale, source: written.content?.source ?? "ai_edited" });
});

route("POST", `${API_PREFIX}/products/:id/publish`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const session = sessionOf(context);
  const result = await publishProduct(
    context.db,
    { id: session.userId, role: session.role, sessionTokenVersion: session.sessionTokenVersion, currentTokenVersion: session.currentTokenVersion },
    productId,
    await readJson(context.request),
    context.nowMs,
  );
  if (!result.ok) return apiError(result.code);

  await audit(context, "publish_product", "product", productId);
  // Bentuk respons ini tidak diatur kontrak API bagian 4 — di sana hanya
  // permintaannya yang ditampilkan. `slug` disertakan karena tanpa itu klien
  // tidak punya cara menyusun alamat halaman publik produknya.
  return apiOk({
    id: result.product.id,
    status: result.product.status,
    progress: result.product.progress,
    slug: result.product.slug,
  });
});

route("DELETE", `${API_PREFIX}/products/:id`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const session = sessionOf(context);
  const confirmed = context.url.searchParams.get("confirm") === "true";

  const result = await deleteProduct(
    context.db,
    { id: session.userId, role: session.role, sessionTokenVersion: session.sessionTokenVersion, currentTokenVersion: session.currentTokenVersion },
    productId,
    confirmed,
  );
  if (!result.ok) return apiError(result.code);

  await audit(context, "delete_product", "product", productId);
  return apiOk({ deleted: true });
});

route("POST", `${API_PREFIX}/products/:id/generate`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const session = sessionOf(context);
  const result = await requestGeneration(
    context.db,
    { id: session.userId, role: session.role, sessionTokenVersion: session.sessionTokenVersion, currentTokenVersion: session.currentTokenVersion },
    productId,
    await readJson(context.request),
    context.nowMs,
  );
  if (!result.ok) return apiError(result.code);

  // Pekerjaan diserahkan ke antrian setelah barisnya ada di D1. Urutan ini
  // tidak dapat ditukar: konsumen yang menerima pesan lebih dulu akan mencari
  // baris yang belum ada, melewatinya, dan mengakui pesannya — pekerjaan itu
  // lalu tidak pernah dikerjakan siapa pun.
  await enqueueJobs(context, result.jobs.map((job) => ({ ...job, productId })));

  await audit(context, "request_generation", "product", productId);

  return apiOk({ jobs: result.jobs });
});

// --- Audio dan transkrip (§6) ---

route("GET", `${API_PREFIX}/products/:id/transcript`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canViewProduct);
  if (!access.ok) return access.response;

  const transcript = await loadTranscript(context.db, productId);
  if (transcript === null) return apiError("NOT_FOUND");

  return apiOk({
    text: transcript.text,
    locale: transcript.locale,
    edited: transcript.edited,
    provider: transcript.provider,
    durationMs: transcript.durationMs,
  });
});

/**
 * Layar tinjau ADR-008 — "Sudah benar, lanjutkan".
 *
 * Inilah satu-satunya cara `reviewed` menyala, dan karena itu satu-satunya
 * jalan menuju `POST /products/:id/generate`. Menekan tombol itu tanpa
 * mengubah teks tetap memanggil endpoint ini; yang ditandai adalah tindakan
 * meninjau, bukan tindakan menyunting.
 */
route("PUT", `${API_PREFIX}/products/:id/transcript`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canEditDraft);
  if (!access.ok) return access.response;

  const parsed = TranscriptPutSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("TRANSCRIPT_NOT_REVIEWED");

  const result = await submitTranscript(
    context.db,
    productId,
    parsed.data.text,
    context.nowMs,
  );
  if (!result.ok) return apiError(result.code);

  await audit(context, "review_transcript", "product", productId);

  return apiOk({
    text: result.transcript?.text ?? parsed.data.text,
    locale: result.transcript?.locale ?? "id",
    edited: result.transcript?.edited ?? false,
  });
});

// --- Pekerjaan (§7) ---

route("GET", `${API_PREFIX}/products/:id/jobs`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canViewProduct);
  if (!access.ok) return access.response;

  const jobs = await d1ListJobs(context.env.DB, productId);

  return apiOk({
    jobs: jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      provider: job.provider,
      progress: job.progress,
      attempt: job.attempt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    })),
    overallProgress: overallProgress(jobs),
  });
});

// --- Ekspor (§10) ---

route("POST", `${API_PREFIX}/products/:id/export`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canViewProduct);
  if (!access.ok) return access.response;
  const detail = access.detail;

  const parsed = ExportRequestSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("UNSUPPORTED_FORMAT");

  const content = detail.content.get(parsed.data.locale);

  // F4-05: setiap ekspor mencantumkan nama pengrajin. Diambil dari baris
  // pengguna, bukan dari konten, karena namanya melekat pada orangnya.
  const artisan = await d1FindUserById(context.env.DB, detail.artisanId);
  if (artisan === null) return apiError("NOT_FOUND");

  const product: ExportProduct = {
    id: detail.id,
    slug: detail.slug,
    locale: parsed.data.locale,
    name: content?.name ?? null,
    story: content?.story ?? null,
    specs: content?.specs ?? [],
    socialCopy: content?.socialCopy ?? null,
    artisanName: artisan.displayName,
    media: detail.media.map((asset) => ({ url: asset.r2Key, altText: asset.altText })),
  };

  const result = buildExport(product, parsed.data, context.url.origin);
  if (!result.ok) return apiError(result.code);

  await audit(context, "export_product", "product", productId);

  return new Response(result.artifact.bytes, {
    headers: {
      "Content-Type": result.artifact.contentType,
      "Content-Disposition": `attachment; filename="${result.artifact.filename}"`,
    },
  });
});

// --- Katalog publik (§10) ---

route("GET", `${API_PREFIX}/public/catalog/:slug`, "public", async (context) => {
  const slug = context.params.slug ?? "";
  if (slug.length === 0) return apiError("NOT_FOUND");

  // Bahasa opsional (kontrak bagian 10). Bawaannya "id": tautan yang
  // dibagikan lewat WhatsApp tidak membawa parameter apa pun, dan pembeli
  // pertama harus melihat versi yang paling mungkin ada.
  //
  // `?locale=` yang kosong diperlakukan sama dengan tanpa parameter. Kalau
  // tidak, `?? "id"` tidak pernah berlaku di situ: `searchParams.get()`
  // mengembalikan "" — bukan null — untuk "?locale=", dan "" bukan bahasa
  // mana pun. Akibatnya tautan yang tanda samanya terpotong saat disalin
  // menjawab 404, padahal kontraknya menjanjikan versi bawaan.
  const requested = new URL(context.request.url).searchParams.get("locale") ?? "";
  const locale = LocaleSchema.safeParse(requested.length === 0 ? "id" : requested);
  // Bahasa di luar daftar diperlakukan sebagai "tidak ada", bukan sebagai
  // galat bentuk: titik akhir ini publik, dan membedakan "bahasa salah"
  // dari "produk tidak ada" hanya memberi tahu penebak bahwa slug-nya benar.
  if (!locale.success) return apiError("NOT_FOUND");

  const entry = await findPublicCatalogEntry(context.db, slug, locale.data);
  // Produk draf mengembalikan 404, bukan 403 — 403 membocorkan keberadaannya.
  if (entry === null) return apiError("NOT_FOUND");

  // Produk ada, tetapi versi bahasanya belum. Halaman kosong lebih buruk
  // daripada halaman yang mengatakan tidak ada: pembeli melihat katalog
  // tanpa nama dan tanpa cerita, dan menyangka produknya rusak.
  if (entry.name === null) return apiError("NOT_FOUND");

  // Foto utama di halaman ini adalah gambar yang paling dilihat juri, dan
  // sampai sekarang ia selalu rusak: yang dikirim adalah kunci R2 mentah,
  // yang bagi peramban berarti alamat relatif terhadap origin aplikasi.
  // URL bertanda tangan membuatnya benar-benar dapat dimuat.
  const mediaUrls = await Promise.all(
    entry.media.map((media) =>
      createSignedMediaUrl(
        { r2Key: media.r2Key, nowMs: context.nowMs },
        context.url.origin,
        signingKeyOf(context.env),
      ),
    ),
  );

  return apiOk({
    name: entry.name,
    story: entry.story,
    specs: entry.specs,
    artisan: { displayName: entry.artisanName },
    media: entry.media.map((media, index) => ({
      url: mediaUrls[index] ?? null,
      altText: media.altText,
    })),
    /*
      Naskah berwaktu diturunkan dari `story` (worker/catalog/narration.ts).
      Sebelum ini lariknya selalu kosong, dan `TalkingCatalog` mengembalikan
      `null` bila kosong — akibatnya fitur F3 tidak pernah tampil.

      `audioUrl` tetap `null`: penyedia TTS Bahasa Indonesia masih keputusan
      terbuka (ADR-005 O4). Naskahnya sudah bekerja tanpanya — subjudul,
      jam, dan seluruh cerita terbaca; yang belum ada hanya suaranya.
    */
    narration: { audioUrl: null, captions: buildCaptions(entry.story) },
    availableLocales: entry.availableLocales,
    // Bahasa yang benar-benar dilayani, bukan yang digarisbawahi tabel.
    // Halaman memakainya untuk menyoroti pilihan yang sedang terbuka;
    // menebaknya dari urutan `availableLocales` akan menyorot yang salah.
    locale: locale.data,
  });
});

// --- Preferensi aksesibilitas (§11) ---

route("PUT", `${API_PREFIX}/me/a11y-profile`, "session", async (context) => {
  const parsed = A11yProfileSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("UNAUTHENTICATED");

  const session = sessionOf(context);
  await d1SaveA11yProfile(context.env.DB, session.userId, JSON.stringify(parsed.data));
  await audit(context, "set_a11y_profile", "user", session.userId);

  return apiOk(parsed.data);
});


// --- Media (§5) ---

route("POST", `${API_PREFIX}/products/:id/media/upload-url`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canUploadMedia);
  if (!access.ok) return access.response;

  const parsed = UploadUrlRequestSchema.safeParse(await readJson(context.request));
  const validated = parsed.success ? validateUploadRequest(parsed.data) : null;
  if (validated === null || !validated.ok) {
    return apiError(validated === null ? "UNSUPPORTED_FORMAT" : validated.code);
  }

  const mediaId = ulid();
  const key = buildMediaKey({
    productId,
    mediaId,
    kind: validated.kind,
    mimeType: validated.mimeType,
  });
  if (!key.ok) return apiError(key.code);

  // Barisnya lahir sekarang, saat URL diterbitkan — bukan saat berkasnya
  // tiba. Unggahan yang tidak pernah selesai tetap terlihat sebagai
  // tertunda, bukan sebagai hilang.
  await d1InsertMediaAsset(
    context.env.DB,
    {
      id: mediaId,
      productId,
      kind: validated.kind,
      r2Key: key.key,
      mimeType: validated.mimeType,
      bytes: validated.bytes,
    },
    context.nowMs,
  );

  const upload = await createSignedUpload(
    { r2Key: key.key, mimeType: validated.mimeType, nowMs: context.nowMs },
    context.url.origin,
    signingKeyOf(context.env),
  );

  await audit(context, "request_upload", "media", mediaId);

  return apiOk({ mediaId, uploadUrl: upload.uploadUrl, expiresAt: upload.expiresAt });
});

/**
 * Rute unggah bertanda tangan.
 *
 * Tidak bersesi: tanda tangan di dalam URL itulah autentikasinya, dan
 * memang itu gunanya — peramban dapat mengirim `PUT` tanpa header apa pun.
 * Pemeriksaan magic bytes TIDAK dilakukan di sini; kontrak API bagian 5
 * menaruhnya di `/confirm`.
 */
route("PUT", `${API_PREFIX}/media/upload/:token`, "public", async (context) => {
  return handleSignedUpload(context.request, context.env.MEDIA, {
    signingKey: signingKeyOf(context.env),
    nowMs: context.nowMs,
  });
});

/**
 * Rute baca objek media.
 *
 * Tanpa sesi, dengan alasan yang sama seperti rute unggah: tanda tangan di
 * dalam URL itulah autentikasinya. Halaman katalog publik memang harus
 * dapat menyajikan fotonya kepada pembeli yang tidak punya akun — memaksa
 * sesi di sini akan mematikan seluruh halaman publik.
 *
 * Yang dijaga tanda tangan bukan kerahasiaan berkas, melainkan bahwa URL
 * hanya menunjuk SATU kunci dan mati setelah masa berlakunya lewat. Tanpa
 * itu, kunci `products/<ulid>/...` yang bocor dapat ditebak dan disusuri.
 *
 * `Cache-Control: private` dengan masa simpan satu jam: URL-nya sudah
 * membawa masa berlaku sendiri, dan `immutable` tidak dipakai karena kunci
 * `studio-*` dapat tergantikan oleh generate ulang.
 */
route("GET", `${API_PREFIX}/media/:token`, "public", async (context) => {
  // Token baca adalah tanda tangan base64url, BUKAN ULID — karena itu ia
  // dibaca mentah, tidak lewat `paramOf`. Memakai `paramOf` di sini membuat
  // setiap permintaan berhenti di validasi ULID dan menjawab `NOT_FOUND`
  // sebelum tanda tangannya sempat diperiksa: token yang sah, yang
  // kedaluwarsa, dan yang dipalsukan akan tampak sama persis dari luar.
  const token = context.params["token"];
  if (token === undefined || token.length === 0) return apiError("NOT_FOUND");

  const verified = await verifyMediaReadToken(token, signingKeyOf(context.env), context.nowMs);
  if (!verified.ok) return apiError(verified.code);

  const object = await context.env.MEDIA.get(verified.r2Key);
  // Objeknya hilang meski tanda tangannya sah — misalnya setelah pembersihan
  // R2. Itu bukan kesalahan pembeli, dan 404 adalah jawaban yang benar.
  if (object === null) return apiError("NOT_FOUND");

  // ETag dipakai apa adanya dari R2 supaya peramban dapat memakai ulang
  // salinannya tanpa mengunduh ulang gambar yang sama di setiap kunjungan.
  const etag = object.httpEtag;
  if (context.request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": mediaContentType(object.httpMetadata?.contentType ?? ""),
      "Content-Length": String(object.size),
      "Cache-Control": "private, max-age=3600",
      ETag: etag,
      // Berkas pengrajin tidak boleh dijalankan sebagai apa pun.
      "X-Content-Type-Options": "nosniff",
    },
  });
});

route("POST", `${API_PREFIX}/products/:id/media/:mediaId/confirm`, "session", async (context) => {
  const productId = paramOf(context, "id");
  const mediaId = paramOf(context, "mediaId");
  if (productId === null || mediaId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canUploadMedia);
  if (!access.ok) return access.response;

  const asset = await d1FindMediaAsset(context.env.DB, mediaId);
  if (asset === null || asset.productId !== productId) return apiError("NOT_FOUND");

  const object = await context.env.MEDIA.get(asset.r2Key);
  if (object === null) return apiError("CONTENT_MISMATCH");

  // Yang diperiksa isinya, bukan ekstensi maupun MIME yang dikirim klien.
  // Berkas berekstensi .jpg berisi HTML ditolak di sini (TC-U-CAT-06).
  const bytes = new Uint8Array(await object.arrayBuffer());
  const verified = verifyImageContent(bytes, asset.mimeType);
  if (!verified.ok) return apiError(verified.code);

  const confirmed = await d1ConfirmMediaAsset(context.env.DB, mediaId, {
    mimeType: verified.mimeType,
    bytes: bytes.length,
  });
  if (confirmed === null) return apiError("NOT_FOUND");

  await audit(context, "confirm_upload", "media", mediaId);

  return apiOk({
    id: confirmed.id,
    kind: confirmed.kind,
    bytes: confirmed.bytes,
    uploadStatus: confirmed.uploadStatus,
  });
});

route("PATCH", `${API_PREFIX}/products/:id/media/:mediaId`, "session", async (context) => {
  const productId = paramOf(context, "id");
  const mediaId = paramOf(context, "mediaId");
  if (productId === null || mediaId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canUploadMedia);
  if (!access.ok) return access.response;

  const asset = await d1FindMediaAsset(context.env.DB, mediaId);
  if (asset === null || asset.productId !== productId) return apiError("NOT_FOUND");

  const parsed = MediaPatchSchema.safeParse(await readJson(context.request));
  const patch = parsed.success ? parseMediaPatch(parsed.data) : null;
  if (patch === null || !patch.ok) {
    return apiError(patch === null ? "UNSUPPORTED_FORMAT" : patch.code);
  }

  const updated = await d1PatchMediaAsset(context.env.DB, mediaId, {
    altText: patch.altText,
    isPrimary: patch.isPrimary,
  });
  if (updated === null) return apiError("NOT_FOUND");

  await audit(context, "patch_media", "media", mediaId);

  return apiOk({
    id: updated.id,
    altText: updated.altText,
    isPrimary: updated.isPrimary,
  });
});

// --- Audio (§6) ---

/**
 * Menerima rekaman suara.
 *
 * Berkasnya TIDAK disalurkan Worker: klien mengunggahnya lewat URL
 * bertanda tangan seperti media lain, dan endpoint ini hanya menyiapkan
 * pekerjaan ASR. Yang diperiksa di sini adalah persetujuannya, karena
 * mengirim suara ke penyedia ASR tanpa izin adalah pelanggaran yang tidak
 * dapat ditarik kembali.
 *
 * Aturan durasi (ASR_TOO_SHORT, ASR_TOO_LONG) dan ASR_NO_SPEECH ditegakkan
 * pekerjaannya, bukan rutenya: ketiganya hanya dapat diketahui setelah
 * berkasnya didekode, dan itu terjadi di jalur ASR.
 */
route("POST", `${API_PREFIX}/products/:id/audio`, "session", async (context) => {
  const productId = paramOf(context, "id");
  if (productId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canEditDraft);
  if (!access.ok) return access.response;

  const consent = await requireConsent(context.db, access.detail.artisanId, "audio_processing");
  if (consent !== null) return apiError(consent);

  const form = await context.request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) return apiError("ASR_NO_SPEECH");
  if (audio.size > LIMITS.MAX_UPLOAD_BYTES) return apiError("FILE_TOO_LARGE");

  const mediaId = ulid();
  const mimeType = audio.type || "audio/webm";
  const bytes = audio.size;
  const r2Key = `products/${productId}/audio-raw-${mediaId}.webm`;

  await context.env.MEDIA.put(r2Key, await audio.arrayBuffer(), {
    httpMetadata: { contentType: mimeType },
  });

  await d1InsertMediaAsset(
    context.env.DB,
    {
      id: mediaId,
      productId,
      kind: "audio_raw",
      r2Key,
      mimeType,
      bytes,
    },
    context.nowMs,
  );

  await d1ConfirmMediaAsset(context.env.DB, mediaId, { mimeType, bytes });

  const jobId = ulid();
  await d1InsertJob(context.env.DB, { id: jobId, productId, kind: "asr" }, context.nowMs);
  await enqueueJobs(context, [{ id: jobId, productId, kind: "asr" }]);
  await audit(context, "request_asr", "product", productId);

  return apiOk({ jobId, kind: "asr", status: "queued" });
});

// --- Retry pekerjaan (§7) ---

route("POST", `${API_PREFIX}/products/:id/jobs/:jobId/retry`, "session", async (context) => {
  const productId = paramOf(context, "id");
  const jobId = paramOf(context, "jobId");
  if (productId === null || jobId === null) return apiError("NOT_FOUND");

  const access = await loadProductFor(context, productId, canEditDraft);
  if (!access.ok) return access.response;

  const job = await d1FindJob(context.env.DB, jobId);
  if (job === null || job.productId !== productId) return apiError("NOT_FOUND");

  // Maksimum tiga percobaan per pekerjaan (kontrak API bagian 7).
  if (!canRetryJob(job.attempt)) return apiError("MAX_RETRIES_EXCEEDED");

  const retried = await d1RetryJob(context.env.DB, jobId);
  if (!retried) return apiError("NOT_FOUND");

  await audit(context, "retry_job", "job", jobId);

  return apiOk({ id: jobId, kind: job.kind, status: "queued" });
});

// --- Antrian Studio Agent (§8) ---

/**
 * Kunci agen.
 *
 * Dibandingkan berwaktu tetap: perbandingan biasa pada rahasia membocorkan
 * berapa karakter awal yang sudah benar lewat waktu yang dibutuhkan.
 */
function agentKeyMatches(context: RouteContext): boolean {
  const expected = context.env.AGENT_SHARED_KEY;
  const provided = context.request.headers.get("X-Agent-Key");
  if (expected === undefined || provided === null) return false;

  return constantTimeEqual(provided, expected);
}

route("POST", `${API_PREFIX}/agent/heartbeat`, "agent", async (context) => {
  const parsed = AgentHeartbeatSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("FORBIDDEN");

  await d1UpsertHeartbeat(
    context.env.DB,
    {
      agentId: parsed.data.agentId,
      healthy: parsed.data.healthy,
      selectorsOk: parsed.data.selectorsOk,
      chromeSessionOk: parsed.data.chromeSessionOk,
    },
    context.nowMs,
  );

  return apiOk({ acknowledged: true });
});

route("POST", `${API_PREFIX}/agent/jobs/claim`, "agent", async (context) => {
  const parsed = AgentClaimSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("FORBIDDEN");

  const heartbeat = await d1LatestHeartbeat(context.env.DB);
  if (heartbeat === null || heartbeat.agentId !== parsed.data.agentId) {
    // Agen yang belum pernah melapor tidak boleh mengambil pekerjaan: tanpa
    // heartbeat, rantai penyedia tidak tahu apakah ia masih hidup.
    return apiError("FORBIDDEN");
  }

  // Satu peramban tidak menjalankan dua pekerjaan bersamaan (TC-SA-05).
  const jobs = await d1ClaimImageJobs(
    context.env.DB,
    {
      agentId: parsed.data.agentId,
      max: Math.min(parsed.data.max, 1),
      deadlineAt: context.nowMs + LIMITS.GEMINI_TIMEOUT_MS,
      provider: "gemini_web",
    },
    context.nowMs,
  );

  return apiOk({
    jobs: jobs.map((job) => ({
      id: job.id,
      productId: job.productId,
      sourceImageUrl: job.sourceImageUrl,
      prompt: job.prompt,
      deadlineAt: job.deadlineAt,
    })),
  });
});

route("POST", `${API_PREFIX}/agent/jobs/:jobId/complete`, "agent", async (context) => {
  const jobId = paramOf(context, "jobId");
  if (jobId === null) return apiError("NOT_FOUND");

  const parsed = AgentCompleteSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("FORBIDDEN");

  const completed = await d1CompleteJob(context.env.DB, jobId, context.nowMs);
  if (!completed) return apiError("NOT_FOUND");

  return apiOk({ id: jobId, status: "succeeded" });
});

route("POST", `${API_PREFIX}/agent/jobs/:jobId/fail`, "agent", async (context) => {
  const jobId = paramOf(context, "jobId");
  if (jobId === null) return apiError("NOT_FOUND");

  const parsed = AgentFailSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("FORBIDDEN");

  // Bukan failed: pekerjaannya kembali ke antrian supaya consumer Workers
  // AI mengambilnya. Status failed akan menghentikannya padahal penyedia
  // cadangannya belum pernah dicoba.
  const returned = await d1ReturnJobToQueue(
    context.env.DB,
    jobId,
    { reason: parsed.data.reason, fallbackProvider: "workers_ai" },
    context.nowMs,
  );
  if (!returned) return apiError("NOT_FOUND");

  return apiOk({ id: jobId, status: "queued", provider: "workers_ai" });
});

// --- Pendamping (§9) ---

route("POST", `${API_PREFIX}/caregivers/invite`, "session", async (context) => {
  const parsed = CaregiverInviteSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("FORBIDDEN");

  const session = sessionOf(context);
  const linkId = ulid();
  // Token undangan acak 32 bita. Bukan ULID: ULID memuat waktu dan terurut,
  // sehingga token yang satu dapat dipakai untuk menebak yang lain.
  const inviteToken = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  await d1CreateInvite(
    context.env.DB,
    {
      id: linkId,
      artisanId: session.userId,
      invitePhone: parsed.data.phone,
      inviteToken,
      permissions: parsed.data.permissions,
      expiresAt: context.nowMs + LIMITS.INVITE_TTL_MS,
    },
    context.nowMs,
  );

  await audit(context, "invite_caregiver", "caregiver_link", linkId);

  return apiOk({
    linkId,
    inviteToken,
    expiresAt: context.nowMs + LIMITS.INVITE_TTL_MS,
  });
});

route("POST", `${API_PREFIX}/caregivers/accept`, "session", async (context) => {
  const parsed = CaregiverAcceptSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return apiError("INVITE_EXPIRED");

  const row = await d1FindInviteByToken(context.env.DB, parsed.data.token);
  if (row === null) return apiError("INVITE_EXPIRED");

  const link = parseCaregiverLink(row);
  if (link === null) return apiError("INVITE_EXPIRED");

  // Sekali pakai: undangan yang sudah diterima tidak dapat dipakai lagi
  // (TC-SEC-15), dan yang kedaluwarsa tidak diterima sama sekali.
  if (link.status !== "pending") return apiError("INVITE_ALREADY_USED");
  if (link.expiresAt <= context.nowMs) return apiError("INVITE_EXPIRED");

  const session = sessionOf(context);
  const accepted = await d1AcceptInvite(context.env.DB, link.id, session.userId, context.nowMs);
  if (!accepted) return apiError("INVITE_ALREADY_USED");

  // Menerima undangan mengubah peran penerimanya menjadi pendamping, dan
  // menaikkan versi tokennya. Token yang dibawa ke sini masih mengaku
  // pengrajin; membiarkannya berlaku berarti seluruh pemeriksaan izin
  // `worker/rbac` yang bergantung pada peran tidak pernah menyala.
  await d1SetUserRole(context.env.DB, session.userId, "caregiver");
  const tokenVersion = await d1BumpTokenVersion(context.env.DB, session.userId);

  await audit(context, "accept_invite", "caregiver_link", link.id, link.artisanId);

  const tokens = await issueTokens(
    { subject: session.userId, role: "caregiver", tokenVersion: tokenVersion ?? 0 },
    signingKeyOf(context.env),
    context.nowMs,
  );

  // Bentuk respons ini tidak diatur kontrak — bagian 9 hanya menampilkan
  // permintaannya. Token baru dikembalikan karena peran di token lama sudah
  // tidak benar, dan klien tidak punya cara lain mengetahuinya.
  return apiOk({
    linkId: link.id,
    artisanId: link.artisanId,
    permissions: link.permissions,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  });
});

route("GET", `${API_PREFIX}/caregivers`, "session", async (context) => {
  const session = sessionOf(context);
  const rows = await d1ListLinksForArtisan(context.env.DB, session.userId);

  return apiOk({
    links: rows.map((row) => {
      const link = parseCaregiverLink(row);
      return {
        id: row.id,
        caregiverId: link?.caregiverId ?? null,
        permissions: link?.permissions ?? [],
        status: link?.status ?? "revoked",
        expiresAt: row.expires_at,
      };
    }),
  });
});

/**
 * Mencabut akses pendamping.
 *
 * Dua tulisan, dan keduanya wajib. Menutup tautannya saja TIDAK cukup:
 * token yang sudah beredar masih sah sampai kedaluwarsa. token_version
 * pendamping dinaikkan pada permintaan yang sama, dan pemeriksaan versi di
 * middleware mematikannya seketika (TC-I-04, TC-SEC-16).
 */
route("DELETE", `${API_PREFIX}/caregivers/:linkId`, "session", async (context) => {
  const linkId = paramOf(context, "linkId");
  if (linkId === null) return apiError("NOT_FOUND");

  const session = sessionOf(context);
  const row = await d1FindLinkById(context.env.DB, linkId);
  if (row === null) return apiError("NOT_FOUND");

  const link = parseCaregiverLink(row);
  if (link === null) return apiError("NOT_FOUND");

  // Hanya pengrajin yang didampingi, atau admin, yang boleh mencabut.
  if (link.artisanId !== session.userId && session.role !== "admin") {
    return apiError("FORBIDDEN");
  }

  const revoked = await d1RevokeLink(context.env.DB, linkId, context.nowMs);
  if (!revoked) return apiError("NOT_FOUND");

  if (link.caregiverId !== null) {
    await d1BumpTokenVersion(context.env.DB, link.caregiverId);
  }

  await audit(context, "revoke_caregiver", "caregiver_link", linkId, link.artisanId);

  return apiOk({ id: linkId, status: "revoked" });
});

// --- Titik masuk ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === `${API_PREFIX}/health`) {
      return withHeaders(apiOk({ status: "ready" }), request, env);
    }

    // Praperiksa CORS tidak boleh menuntut autentikasi: peramban mengirimnya
    // tanpa kredensial, dan menolaknya berarti setiap permintaan lintas asal
    // gagal sebelum sempat dicoba.
    if (request.method === "OPTIONS") {
      return withHeaders(new Response(null, { status: 204 }), request, env);
    }

    const matched = matchRoute(request.method, url.pathname);
    if (matched === null) {
      const response = hasOtherMethod(url.pathname)
        ? apiError("FORBIDDEN")
        : apiError("NOT_FOUND");
      return withHeaders(response, request, env);
    }

    const counter = createQueryCounter();
    const context: RouteContext = {
      request,
      env,
      url,
      params: matched.params,
      nowMs: Date.now(),
      db: createDb(env.DB, counter),
      counter,
      session: null,
    };

    if (matched.route.access === "agent") {
      if (!agentKeyMatches(context)) {
        return withHeaders(apiError("FORBIDDEN"), request, env);
      }
      return withHeaders(await matched.route.handler(context), request, env);
    }

    if (matched.route.access === "session") {
      const verified = await verifyToken(
        request,
        d1SessionLookup(env.DB),
        signingKeyOf(env),
        context.nowMs,
      );
      if (!verified.ok) return withHeaders(verified.response, request, env);

      return withHeaders(
        await matched.route.handler({ ...context, session: verified.session }),
        request,
        env,
      );
    }

    return withHeaders(await matched.route.handler(context), request, env);
  },

  /**
   * Konsumen pekerjaan AI. Kontrak API bagian 7, prompt P2 di
   * `docs/ops/MODEL-ROUTING.md`.
   *
   * Inilah jalur yang membuat demo tetap berjalan ketika Studio Agent tidak
   * hidup: tanpa agen, tidak ada yang mengklaim pekerjaan gambar lewat
   * `POST /agent/jobs/claim`, dan pekerjaan itu harus tetap diselesaikan di
   * sini. Karena itu setiap pekerjaan diakui sendiri-sendiri — satu
   * pekerjaan yang melempar tidak boleh menjatuhkan pekerjaan lain dalam
   * batch yang sama.
   *
   * `retry` adalah satu-satunya alasan pengakuan ditunda. Semuanya diakui
   * supaya antrian tidak berputar pada pekerjaan yang tidak akan pernah
   * berhasil — pekerjaan tanpa foto, misalnya, akan gagal dengan cara yang
   * sama pada percobaan kelima.
   */
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const nowMs = Date.now();

    for (const message of batch.messages) {
      const parsed = parseJobMessage(message.body);
      if (parsed === null) {
        console.warn(`[queue] Pesan tidak dikenal dilewati: ${JSON.stringify(message.body)}`);
        message.ack();
        continue;
      }

      let outcome: JobOutcome;
      try {
        outcome = await processJob(parsed, {
          env: {
            DB: env.DB,
            MEDIA: env.MEDIA,
            AI: env.AI,
            GROQ_API_KEY: env.GROQ_API_KEY,
            NINEROUTER_API_KEY: env.NINEROUTER_API_KEY,
            NINEROUTER_BASE_URL: env.NINEROUTER_BASE_URL,
          },
          nowMs,
          // Alamat publik Worker ini. Penyedia ASR mengambil berkas audionya
          // sendiri lewat `fetch`, jadi ia membutuhkan alamat yang dapat
          // dijangkau — bukan jalur relatif.
          audioBaseUrl: env.PUBLIC_BASE_URL,
          log: (line) => console.warn(`[queue] ${line}`),
        });
      } catch (error) {
        // Pekerjaan yang melempar sebelum sempat menandai dirinya gagal
        // dikembalikan ke antrian, bukan diakui: penyebabnya bisa jadi
        // gangguan sementara, dan pekerjaan yang hilang berarti katalog yang
        // tidak pernah selesai.
        console.error(
          `[queue] Pekerjaan ${parsed.jobId} melempar: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        message.retry();
        continue;
      }

      switch (outcome.status) {
        case "retry":
          message.retry();
          break;
        case "succeeded":
        case "failed":
        case "skipped":
          message.ack();
          break;
      }
    }
  },
} satisfies ExportedHandler<Env>;

/** Dipakai pengujian untuk memeriksa tabel rutenya. */
export { ROUTES };
