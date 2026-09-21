/**
 * Pengambilan katalog publik.
 *
 * Satu panggilan ke `GET /public/catalog/:slug`. Tidak ada endpoint lain
 * yang disentuh dari sini, dan tidak ada bentuk yang diarang: seluruh
 * muatannya melewati `PublicCatalogSchema` sebelum disentuh komponen.
 *
 * `cache: "no-store"` dipakai dengan sadar. Halaman publik menampilkan
 * ulasan pengrajin, dan `fetch` pada runtime Next.js tanpa pilihan itu
 * dapat menyajikan salinan lama selama satu jam — cacat yang tidak terlihat
 * saat pengembangan tetapi terlihat saat dinilai.
 */

import { ERROR_CATALOG, type ErrorCode } from "@/lib/errors";

import { PublicCatalogSchema, type PublicCatalog } from "./timeline";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
const API_PREFIX = "/api/v1";

export const CATALOG_REVALIDATE_SECONDS = 60;

export interface CatalogFailure {
  readonly code: ErrorCode;
  readonly message: string;
  readonly action: string;
  readonly workSafe: boolean;
}

export type CatalogResult =
  | { readonly ok: true; readonly data: PublicCatalog }
  | { readonly ok: false; readonly error: CatalogFailure };

function failureOf(code: ErrorCode): CatalogFailure {
  const entry = ERROR_CATALOG[code];
  // `workSafe` selalu true — invarian sistem, bukan bidang per kode.
  return { code, message: entry.message, action: entry.action, workSafe: true };
}

/** Mengambil katalog publik milik `slug`. Tanpa autentikasi. */
export async function fetchPublicCatalog(slug: string): Promise<CatalogResult> {
  const url = `${API_BASE_URL}${API_PREFIX}/public/catalog/${encodeURIComponent(slug)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, error: failureOf("NETWORK_OFFLINE") };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Badan respons bukan JSON. Tidak ada kode katalog untuk "server
    // menjawab sesuatu yang tidak dimengerti", jadi yang dipakai kode
    // umumnya — sama seperti klien alur enam langkah.
    return { ok: false, error: failureOf("INTERNAL_ERROR") };
  }

  if (typeof body !== "object" || body === null) {
    return { ok: false, error: failureOf("INTERNAL_ERROR") };
  }

  const envelope = body as { ok?: unknown; data?: unknown; error?: unknown };

  if (envelope.ok !== true) {
    const error = envelope.error as { code?: unknown; message?: unknown } | undefined;
    const code =
      typeof error?.code === "string" && error.code in ERROR_CATALOG
        ? (error.code as ErrorCode)
        : "INTERNAL_ERROR";

    const failure = failureOf(code);
    return {
      ok: false,
      error: {
        ...failure,
        message: typeof error?.message === "string" ? error.message : failure.message,
      },
    };
  }

  const parsed = PublicCatalogSchema.safeParse(envelope.data);
  if (!parsed.success) {
    // Server menjawab dengan bentuk yang tidak cocok dengan kontrak API.
    // Itu cacat perakitan, bukan kesalahan pembeli, dan menyajikannya
    // setengah jadi lebih buruk daripada mengatakannya.
    return { ok: false, error: failureOf("INTERNAL_ERROR") };
  }

  return { ok: true, data: parsed.data };
}
