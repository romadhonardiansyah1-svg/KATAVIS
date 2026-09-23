/**
 * Harness bersama untuk seluruh pengujian E2E.
 *
 * Yang dijaga berkas ini adalah satu hal: **tidak ada bentuk yang dikarang di
 * dalam kasus uji**. Draf, token, dan amplop API di sini semuanya disalin dari
 * sumber yang mengikat:
 *
 *   `app/create/flow.ts`          -> bentuk `Draft` dan syarat tiap langkah
 *   `lib/session.ts`              -> kunci `localStorage` untuk access token
 *   `docs/spec/API-CONTRACT.md`   -> amplop `{ ok, data }` / `{ ok, error }`
 *   `lib/errors.ts`               -> pesan, `action`, dan `workSafe`
 *
 * Kalau kontrak berubah, berkas ini yang berubah lebih dulu — bukan dua puluh
 * kasus uji yang masing-masing menyimpan salinannya sendiri.
 */

import { expect, type Page, type Route } from "@playwright/test";

// --- Draf (app/create/flow.ts) ---

/** Sama persis dengan `Draft` di `app/create/flow.ts`. */
export interface Draft {
  readonly productId: string | null;
  readonly photoMediaId: string | null;
  readonly audioJobId: string | null;
  readonly transcript: string;
  readonly transcriptReviewed: boolean;
  readonly generatedAt: number | null;
  readonly contentReviewedAt: number | null;
  readonly publishedAt: number | null;
  readonly slug: string | null;
  readonly updatedAt: number;
}

export const EMPTY_DRAFT: Draft = {
  productId: null,
  photoMediaId: null,
  audioJobId: null,
  transcript: "",
  transcriptReviewed: false,
  generatedAt: null,
  contentReviewedAt: null,
  publishedAt: null,
  slug: null,
  updatedAt: 0,
};

/**
 * ULID 26 karakter Crockford base32 — bentuk yang diminta kontrak API
 * bagian 1. Huruf I, L, O, dan U tidak dipakai, dan `UlidSchema` menolaknya.
 */
export const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDP012";
export const MEDIA_ID = "01J8ZQFX9K7YWVTN3MABCDM012";
export const JOB_ID = "01J8ZQFX9K7YWVTN3MABCDJ012";
export const LINK_ID = "01J8ZQFX9K7YWVTN3MABCD1012";
export const SLUG = "tas-kulit-nusantara";

/** Halaman alur membaca drafnya dari IndexedDB, bukan dari server. */
export const DRAFT_DATABASE = "katavis";
export const DRAFT_STORE = "drafts";
export const DRAFT_KEY = "current";

/** `lib/session.ts`. */
const ACCESS_TOKEN_KEY = "katavis.accessToken";

/** `components/a11y/ProfileProvider.tsx`. */
const PROFILE_MIRROR_KEY = "katavis.a11yProfile";

/** `useCreateFlow`: penyimpanan otomatis berjalan setiap lima detik (S5-01). */
export const AUTOSAVE_INTERVAL_MS = 5_000;

/**
 * Batas yang mengikat — salinan `LIMITS` di `lib/schemas.ts`.
 *
 * Disalin, bukan dikarang: angkanya dipakai untuk menguji perilaku terhadap
 * batas itu, dan mengetiknya ulang di dalam kasus uji berarti dua tempat yang
 * dapat berbeda pendapat tentang berapa batasnya.
 */
export const LIMITS = {
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  MIN_AUDIO_MS: 10_000,
  MAX_AUDIO_MS: 60_000,
  MAX_PAGE_SIZE: 20,
  MAX_JOB_ATTEMPTS: 3,
  GEMINI_TIMEOUT_MS: 45_000,
  AGENT_HEARTBEAT_TIMEOUT_MS: 30_000,
  INVITE_TTL_MS: 24 * 60 * 60 * 1000,
  UPLOAD_URL_TTL_MS: 15 * 60 * 1000,
  ACCESS_TOKEN_TTL_S: 15 * 60,
  REFRESH_TOKEN_TTL_MS: 30 * 24 * 60 * 60 * 1000,
  MAX_PIN_ATTEMPTS: 5,
  PIN_LOCKOUT_MS: 15 * 60 * 1000,
  MAX_D1_QUERIES_PER_REQUEST: 25,
} as const;

/**
 * Alamat Worker saat pengujian.
 *
 * `playwright.config.ts` hanya mengenal `baseURL` untuk aplikasi Next.js.
 * Alur memanggil Worker di port terpisah, jadi alamatnya dinyatakan di sini
 * supaya penyadapan rute menyasar host yang benar.
 */
export const API_ORIGIN = process.env.API_BASE_URL ?? "http://localhost:8787";
export const API_PREFIX = "/api/v1";

/**
 * Penanda untuk kasus uji yang membutuhkan Worker sungguhan.
 *
 * Halaman katalog publik adalah Server Component: pengambilannya terjadi di
 * server Next.js, dan `page.route` — yang bekerja di tingkat peramban —
 * tidak pernah melihat permintaan itu. Satu-satunya cara menjalankannya
 * adalah dengan Worker yang benar-benar berjalan:
 *
 *   E2E_WITH_WORKER=1  +  pnpm run dev:worker  +  produk terbit tersemai
 */
export const NEEDS_LIVE_WORKER = process.env.E2E_WITH_WORKER !== "1";
export const LIVE_WORKER_REASON =
  "Katalog publik diambil di sisi server (SSR). Jalankan dengan E2E_WITH_WORKER=1, pnpm run dev:worker, dan produk terbit tersemai (e2e/fixtures/seed-local-d1.sql).";

export function apiPattern(path: string): string {
  return `${API_ORIGIN}${API_PREFIX}${path}`;
}

/**
 * Jalur kontrak API diterjemahkan ke regex dengan jangkar penuh.
 *
 * `:id` menjadi `[^/]+` — tepat satu segmen, bukan `**` yang juga cocok
 * dengan garis miring. Tanpa ketepatan ini, stub `/products/:id`
 * (pola `.../products/**`) ikut mencocokkan `/products/:id/jobs` dan —
 * karena rute terakhir berprioritas tertinggi di Playwright — mengembalikan
 * muatan detail produk untuk permintaan jobs. Kesalahannya senyap: tidak
 * ada permintaan yang gagal, hanya jawaban yang salah.
 */
function apiRouteRegex(path: string): RegExp {
  const literal = `${API_ORIGIN}${API_PREFIX}${path}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${literal.replace(/:([A-Za-z]+)/g, "[^/]+")}$`);
}

// --- Amplop respons (kontrak API bagian 1) ---

export interface StubResponse {
  readonly status?: number;
  readonly contentType?: string;
  readonly body: unknown;
}

/**
 * Halaman berjalan di `localhost:3000` dan Worker di `localhost:8787` —
 * lintas asal. Peramban menolak membaca respons tanpa kepala ini, dan
 * kegagalannya senyap: `fetch` tolak, kasus uji menunggu selamanya.
 */
const CORS_ALLOW_ORIGIN = { "access-control-allow-origin": "*" } as const;

const PREFLIGHT_HEADERS = {
  ...CORS_ALLOW_ORIGIN,
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
} as const;

/**
 * Amplop berhasil.
 *
 * Mengembalikan `StubResponse`, bukan hanya muatannya: dengan begitu
 * pemanggil dapat menulis `() => apiOk({ ... })` langsung sebagai penangan
 * rute, tanpa membungkusnya lagi di setiap tempat. Amplopnya sendiri tetap
 * berbentuk apa adanya dari kontrak API bagian 1 — `{ ok: true, data }`.
 */
export function apiOk<TData>(data: TData): StubResponse {
  return { status: 200, body: { ok: true, data } };
}

/**
 * Amplop galat.
 *
 * `code`, `message`, dan `action` wajib diberikan pemanggil: nilai itu diambil
 * dari `lib/errors.ts`, bukan dikarang di sini. `workSafe` selalu `true` —
 * itu invarian sistem, bukan bidang per kode (`lib/errors.ts` baris 149).
 */
export function apiErrorBody(
  code: string,
  message: string,
  action: string,
  status: number,
): StubResponse {
  return {
    status,
    body: { ok: false, error: { code, message, action, workSafe: true } },
  };
}

// --- Penyadapan rute ---

export type Handler = (route: Route) => Promise<StubResponse> | StubResponse;

export async function fulfill(route: Route, stub: StubResponse): Promise<void> {
  await route.fulfill({
    status: stub.status ?? 200,
    contentType: stub.contentType ?? "application/json",
    headers: { ...CORS_ALLOW_ORIGIN },
    // Tanggapan bukan JSON (mis. CSV) dikirim mentah, bukan dibungkus
    // JSON.stringify — yang akan menambah tanda kutip pada isinya.
    body: typeof stub.body === "string" ? stub.body : JSON.stringify(stub.body),
  });
}

/**
 * Menjawab preflight OPTIONS, lalu meneruskan metode lain ke `fulfill`.
 *
 * Setiap permintaan dengan kepala `Authorization` ke asal berbeda memicu
 * preflight. Tanpa jawaban 204 yang sah, peramban membatalkan permintaan
 * aslinya sebelum penangan rute sempat melihatnya.
 *
 * `method` opsional: bila diberikan dan tidak cocok, rute diteruskan ke
 * penangan yang lebih lama lewat `fallback`. Diperlukan saat satu pola URL
 * melayani beberapa metode dengan penangan berbeda — tanpa gerbang ini,
 * penangan rute mentah menaungi stub `stubApi` yang terdaftar lebih dulu.
 */
export async function corsRoute(
  route: Route,
  respond: () => Promise<StubResponse> | StubResponse,
  method?: string,
): Promise<void> {
  const actual = route.request().method();
  if (actual === "OPTIONS") {
    await route.fulfill({ status: 204, headers: { ...PREFLIGHT_HEADERS } });
    return;
  }
  if (method !== undefined && actual !== method) {
    await route.fallback();
    return;
  }
  await fulfill(route, await respond());
}

/**
 * Menyadap satu endpoint.
 *
 * `path` memakai bentuk kontrak API (`/products/:id`) dan diterjemahkan ke
 * pola glob Playwright. Rute dipasang **sebelum** halaman dimuat supaya
 * permintaan pertama pun tertangkap — memasangnya sesudah `goto` menyisakan
 * satu permintaan yang lolos ke server sungguhan, dan kegagalannya muncul
 * sebagai kesalahan yang tidak ada hubungannya dengan yang sedang diuji.
 */
export async function stubApi(
  page: Page,
  method: string,
  path: string,
  handler: Handler,
): Promise<void> {
  const pattern = apiRouteRegex(path);

  await page.route(pattern, async (route) => {
    // Preflight dijawab langsung; meneruskannya ke `fallback` hanya
    // mengirimkannya ke Worker sungguhan yang tidak berjalan saat uji.
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { ...PREFLIGHT_HEADERS } });
      return;
    }
    if (route.request().method() !== method) {
      await route.fallback();
      return;
    }
    await fulfill(route, await handler(route));
  });
}

/** Menyadap endpoint dengan satu jawaban tetap. */
export async function stubApiOnce(
  page: Page,
  method: string,
  path: string,
  stub: StubResponse,
): Promise<void> {
  await stubApi(page, method, path, () => stub);
}

/** Memutus seluruh permintaan ke Worker — jaringan yang benar-benar putus. */
export async function offline(page: Page): Promise<void> {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    await route.abort("internetdisconnected");
  });
}

// --- Keadaan peramban ---

/**
 * Menyemai access token.
 *
 * Layar masuk belum ada (`lib/session.ts` baris 4 menyatakannya sendiri), jadi
 * token ditanam langsung — sama seperti aplikasi native yang menyimpan token
 * hasil login sebelumnya. Yang diuji bukan cara memperoleh token, melainkan
 * apa yang terjadi sesudahnya.
 */
export async function seedAccessToken(page: Page, token = "uji.token.akses"): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [ACCESS_TOKEN_KEY, token] as const,
  );
}

/** Menyemai cermin profil aksesibilitas, supaya pemulihannya tidak tergantung server. */
export async function seedA11yMirror(
  page: Page,
  profile: {
    readonly visual?: boolean;
    readonly hearing?: boolean;
    readonly motor?: boolean;
    readonly cognitive?: boolean;
    readonly voice?: boolean;
  },
): Promise<void> {
  const full = {
    visual: false,
    hearing: false,
    motor: false,
    cognitive: false,
    voice: false,
    ...profile,
  };

  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, JSON.stringify(value));
    },
    [PROFILE_MIRROR_KEY, full] as const,
  );
}

/**
 * Menyemai draf sebelum halaman dimuat.
 *
 * Dipasang lewat `addInitScript`, bukan lewat `page.evaluate` sesudah
 * navigasi: halaman alur membaca drafnya saat dipasang, dan draf yang ditulis
 * sesudahnya sudah terlambat — penjagaan langkahnya sudah terlanjur
 * mengalihkan pengrajin ke langkah lain.
 */
export async function seedDraft(page: Page, seed: Partial<Draft> = {}): Promise<void> {
  const draft: Draft = { ...EMPTY_DRAFT, ...seed, updatedAt: Date.now() };

  await page.addInitScript(
    ([databaseName, storeName, key, value]) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open(databaseName as string, 1);

        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(storeName as string)) {
            database.createObjectStore(storeName as string);
          }
        };
        // Penyemaian yang gagal tidak menghentikan pengujian di sini;
        // kegagalannya muncul sebagai langkah yang salah, dan itu lebih
        // mudah dibaca daripada galat IndexedDB di tengah jalan.
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(storeName as string, "readwrite");
          transaction.objectStore(storeName as string).put(value, key as string);
          transaction.oncomplete = () => {
            // Wajib ditutup. Koneksi yang dibiarkan terbuka memblokir
            // pembukaan berikutnya, dan halamannya berhenti di keadaan memuat
            // selamanya — di WebKit tanpa galat apa pun.
            database.close();
            resolve();
          };
          transaction.onerror = () => resolve();
        };
      }),
    [DRAFT_DATABASE, DRAFT_STORE, DRAFT_KEY, draft] as const,
  );
}

/** Membaca draf yang tersimpan di perangkat, apa adanya. */
export async function readStoredDraft(page: Page): Promise<Draft | null> {
  return page.evaluate(
    ([databaseName, storeName, key]) =>
      new Promise<Draft | null>((resolve) => {
        const request = indexedDB.open(databaseName as string, 1);

        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(storeName as string)) {
            database.createObjectStore(storeName as string);
          }
        };
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(storeName as string, "readonly");
          const read = transaction.objectStore(storeName as string).get(key as string);
          read.onsuccess = () => {
            database.close();
            resolve((read.result as Draft | undefined) ?? null);
          };
          read.onerror = () => {
            database.close();
            resolve(null);
          };
        };
      }),
    [DRAFT_DATABASE, DRAFT_STORE, DRAFT_KEY] as const,
  );
}

/** Mengosongkan draf dan cermin profil di antara kasus uji. */
export async function clearLocalState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.localStorage.clear();

    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("katavis");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

// --- Pembantu navigasi ---

/**
 * Membuka halaman dan menunggu drafnya benar-benar selesai dimuat.
 *
 * Selama draf dimuat, `useCreateFlow` mengembalikan `null` dan halaman
 * menampilkan "Memuat pekerjaan Anda...". Memeriksa apa pun sebelum itu
 * memeriksa layar yang salah.
 */
export async function openStep(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Aksi utama langkah, dicari lewat nama tombolnya (S2-02: tepat satu). */
export function primaryAction(page: Page, name: string | RegExp) {
  return page.getByRole("button", { name });
}

// --- Nilai yang dipakai berulang ---

/** Nama dan cerita produk uji — kriya nyata, bukan teks contoh (TEST-PLAN bagian 12). */
export const PRODUCT_NAME = "Tas Kulit Nusantara";
export const PRODUCT_STORY =
  "Tas ini dibuat dari kulit sapi samak nabati, dijahit tangan selama tiga hari.";
export const PRODUCT_SPECS = ["Kulit sapi nabati", "Dijahit tangan", "30 x 20 cm"];
export const TRANSCRIPT_TEXT =
  "Saya membuat tas ini dari kulit sapi samak nabati. Pengerjaannya tiga hari, dijahit tangan.";

export const ARTISAN_NAME = "Irsyad";
