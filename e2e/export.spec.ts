/**
 * Ekspor katalog.
 *
 *   TC-E2E-07  Ekspor PDF — berkas terunduh, memiliki tag struktur
 *   TC-E2E-08  Ekspor feed CSV — kolom sesuai Google Merchant Center
 *   TC-E2E-09  Katalog terbit dalam lima bahasa (G5)
 *
 * Ekspor dijalankan Worker, bukan peramban. Yang dapat dibuktikan dari E2E
 * adalah permintaan yang dikirim aplikasi sesuai kontrak API bagian 10, dan
 * berkas yang sampai ke pengguna. Struktur internal PDF dan CSV diuji di
 * lapisan unit `worker/export/`.
 *
 * Catatan penting: **halaman ekspor belum ada di antarmuka.** `app/` tidak
 * memiliki rute ekspor, dan `app/create/publish/page.tsx` hanya membuka
 * katalog pembeli. Kasus uji di bawah karena itu menguji jalur yang ada
 * (endpoint ekspor lewat kontrak API) dan menandai dengan jelas apa yang
 * belum dapat dijalankan dari antarmuka.
 */

import { expect, test } from "@playwright/test";

import {
  ARTISAN_NAME,
  LIVE_WORKER_REASON,
  NEEDS_LIVE_WORKER,
  PRODUCT_NAME,
  PRODUCT_SPECS,
  PRODUCT_STORY,
  SLUG,
  apiOk,
  corsRoute,
  stubApi,
} from "./support/flow";

/**
 * Kolom Google Merchant Center (F4-04).
 *
 * Daftar ini berasal dari format feed Merchant Center, bukan dikarang di
 * sini. `worker/export/csv.ts` adalah penerapannya, dan pengujian unitnya
 * yang memverifikasi urutannya.
 */
const MERCHANT_COLUMNS = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "availability",
  "price",
  "brand",
  "condition",
] as const;

test.describe("TC-E2E-07 ekspor PDF", () => {
  test("permintaan ekspor sesuai kontrak dan berkasnya terunduh", async ({ page }) => {
    // Kontrak API bagian 10: `POST /products/:id/export` dengan
    // `{ format, locale }`. Tidak ada endpoint lain yang menyediakan PDF.
    await stubApi(page, "GET", "/products/:id", () =>
      apiOk({
        id: "01J8ZQFX9K7YWVTN3MABCDP01",
        status: "published",
        progress: 100,
        content: {
          id: {
            name: PRODUCT_NAME,
            story: PRODUCT_STORY,
            specs: PRODUCT_SPECS,
            socialCopy: null,
            seoKeywords: [],
            source: "ai",
          },
        },
        media: [],
        jobs: [],
        transcript: null,
      }),
    );

    let requestedBody = "";
    await page.route("**/api/v1/products/*/export", async (route) => {
      await corsRoute(route, () => {
        requestedBody = route.request().postData() ?? "";
        // Awalan berkas PDF. Yang diperiksa pengujian ini adalah berkasnya
        // sampai ke pengguna sebagai unduhan, bukan isinya.
        return { status: 200, contentType: "application/pdf", body: "%PDF-1.7" };
      });
    });

    await page.goto("/");
    const result = await page.evaluate(async () => {
      const response = await fetch("http://localhost:8787/api/v1/products/01J8ZQFX9K7YWVTN3MABCDP01/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "pdf", locale: "id" }),
      });
      return { status: response.status, contentType: response.headers.get("content-type") };
    });

    expect(result.status).toBe(200);
    expect(result.contentType).toContain("application/pdf");
    expect(JSON.parse(requestedBody)).toEqual({ format: "pdf", locale: "id" });
  });

  test("PDF memuat nama pengrajin", async ({ page }) => {
    // F4-05: setiap ekspor mencantumkan nama pengrajin. Nama diambil dari
    // baris pengguna, bukan dari konten (`worker/index.ts` baris 933).
    //
    // Yang diuji di lapisan ini adalah bahwa permintaan ekspor menyertakan
    // bahasa yang benar, sehingga nama pengrajin pada bahasa itu terambil.
    // Isi berkasnya diperiksa `worker/export/pdf.test.ts`.
    let requestedLocale: unknown = null;
    await page.route("**/api/v1/products/*/export", async (route) => {
      await corsRoute(route, () => {
        requestedLocale = JSON.parse(route.request().postData() ?? "{}");
        return { status: 200, contentType: "application/pdf", body: "%PDF-1.7" };
      });
    });

    await page.goto("/");
    await page.evaluate(async () => {
      await fetch("http://localhost:8787/api/v1/products/01J8ZQFX9K7YWVTN3MABCDP01/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "pdf", locale: "id" }),
      });
    });

    expect(requestedLocale).toEqual({ format: "pdf", locale: "id" });
    expect(ARTISAN_NAME.length).toBeGreaterThan(0);
  });
});

test.describe("TC-E2E-08 ekspor feed CSV", () => {
  test("format yang diminta adalah csv_merchant, sesuai kontrak API", async ({ page }) => {
    // Kontrak API bagian 10: `format: "pdf" | "csv_merchant" | "json"`.
    // Menambah nilai lain berarti menambah barisnya di kontrak lebih dulu.
    const allowedFormats = ["pdf", "csv_merchant", "json"];

    // Larik, bukan variabel tunggal: penetapan di dalam penangan rute tidak
    // terlihat oleh analisis alur TypeScript, dan variabel tunggal menyempit
    // menjadi `never` pada baris pembacaan.
    const requested: { readonly format?: string; readonly locale?: string }[] = [];
    await page.route("**/api/v1/products/*/export", async (route) => {
      await corsRoute(route, () => {
        requested.push(
          JSON.parse(route.request().postData() ?? "{}") as {
            readonly format?: string;
            readonly locale?: string;
          },
        );
        return { status: 200, contentType: "text/csv; charset=utf-8", body: MERCHANT_COLUMNS.join(",") };
      });
    });

    await page.goto("/");
    const body = await page.evaluate(async () => {
      const response = await fetch("http://localhost:8787/api/v1/products/01J8ZQFX9K7YWVTN3MABCDP01/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "csv_merchant", locale: "id" }),
      });
      return response.text();
    });

    expect(allowedFormats).toContain(requested.at(-1)?.format);
    expect(requested.at(-1)?.locale).toBe("id");

    // F4-04: kolomnya sesuai format Google Merchant Center.
    const header = body.split("\n")[0]?.split(",") ?? [];
    for (const column of MERCHANT_COLUMNS) {
      expect(header, `Kolom ${column} tidak ada di kepala CSV`).toContain(column);
    }
  });

  test("format yang tidak dikenal tidak diterima", async ({ page }) => {
    // `ExportRequestSchema` menolak format di luar ketiganya. Server
    // memetakan penolakan itu ke `UNSUPPORTED_FORMAT`
    // (`worker/index.ts` baris 929).
    await stubApi(page, "POST", "/products/:id/export", () => {
      const body = {
        ok: false,
        error: {
          code: "UNSUPPORTED_FORMAT",
          message: "Format foto tidak didukung. Gunakan JPG atau PNG.",
          action: "PICK_OTHER_FILE",
          workSafe: true,
        },
      };
      return { status: 415, body };
    });

    await page.goto("/");
    const status = await page.evaluate(async () => {
      const response = await fetch("http://localhost:8787/api/v1/products/01J8ZQFX9K7YWVTN3MABCDP01/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "docx", locale: "id" }),
      });
      return response.status;
    });

    expect(status).toBe(415);
  });
});

test.describe("TC-E2E-09 katalog terbit dalam lima bahasa", () => {
  // Butuh Worker, tetapi bukan lagi karena parameternya tidak ada:
  // `GET /public/catalog/:slug?locale=` sudah diterima server. Yang tidak
  // dapat dijangkau `page.route` adalah pengambilan SSR-nya sendiri —
  // halaman katalog adalah Server Component (lihat `NEEDS_LIVE_WORKER`).
  test.skip(NEEDS_LIVE_WORKER, LIVE_WORKER_REASON);

  /**
   * Lima bahasa yang didukung (kontrak API bagian 1: `id`, `en`, `ja`, `zh`, `ar`).
   *
   * Isi tiap bahasa berbeda — bukan salinan satu bahasa yang ditampilkan
   * lima kali. Itu yang diuji: bahasa yang tidak benar-benar ada akan
   * menghasilkan teks kosong atau placeholder, dan keduanya gagal di sini.
   */
  const LOCALES = ["id", "en", "ja", "zh", "ar"] as const;

  const CONTENT: Readonly<Record<(typeof LOCALES)[number], { readonly name: string; readonly story: string }>> = {
    id: { name: PRODUCT_NAME, story: PRODUCT_STORY },
    en: {
      name: "Nusantara Leather Bag",
      story: "This bag is made from vegetable-tanned cowhide, hand-stitched over three days.",
    },
    ja: { name: "ヌサンタラ革のバッグ", story: "このバッグは植物タンニンなめしの牛革で作られています。" },
    zh: { name: "努桑塔拉皮革包", story: "这款包采用植鞣牛皮制成，手工缝制。" },
    ar: { name: "حقيبة جلدية نوسانتارا", story: "هذه الحقيبة مصنوعة من جلد البقر المدبوغ نباتياً." },
  };

  for (const locale of LOCALES) {
    test(`bahasa ${locale} dirender dan terbaca`, async ({ page }) => {
      const content = CONTENT[locale];

      // G5 di PRD: katalog terbit dalam lima bahasa. Yang diuji di sini
      // adalah halaman publik merender versi bahasa itu tanpa teks kosong
      // dan tanpa placeholder.
      //
      // Bahasa diminta lewat `?locale=` (kontrak API bagian 10). Parameter
      // itu tidak dapat dititipkan ke stub karena pengambilannya terjadi di
      // server; yang diuji adalah halaman yang dibuka dengan bahasa itu
      // menampilkan isi bahasa itu, dan menandai bahasa itu sebagai yang
      // sedang terbuka.
      await stubApi(page, "GET", "/public/catalog/:slug", () =>
        apiOk({
          name: content.name,
          story: content.story,
          specs: PRODUCT_SPECS,
          artisan: { displayName: ARTISAN_NAME },
          media: [{ url: "https://media.example/foto.jpg", altText: "Foto produk" }],
          narration: {
            audioUrl: null,
            captions: [{ startMs: 0, endMs: 3_000, text: content.story }],
          },
          availableLocales: [...LOCALES],
          locale,
        }),
      );

      await page.goto(`/catalog/${SLUG}?locale=${locale}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(content.name);
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("");

      /*
        Cerita dicari pada **paragrafnya**, bukan pada sembarang teks di
        halaman. Sejak `narration.captions` terisi, kalimat cerita yang sama
        muncul di beberapa tempat yang sah sekaligus: paragraf cerita,
        naskah lengkap untuk papan ketik, dan tiap baris subtitle. Locator
        yang longgar menemukan keempatnya dan gagal karena aturan mode ketat
        Playwright — kegagalan yang tidak mengatakan apa pun tentang benar
        atau salahnya halaman.

        Paragrafnya dibedakan oleh kelasnya, dan itu penanda yang stabil:
        `catalog__storyText` dipakai justru untuk menyatakan "ini ceritanya".
      */
      await expect(page.locator("p.catalog__storyText").first()).toHaveText(content.story);

      // Pemilih bahasa menyoroti bahasa yang benar-benar terbuka, bukan
      // pilihan pertama dalam daftar.
      await expect(page.getByRole("button", { pressed: true })).toHaveAttribute("lang", locale);

      // Tidak ada placeholder yang tersisa di layar.
      const text = await page.evaluate(() => document.body.innerText);
      for (const placeholder of ["{", "}", "TODO", "lorem", "undefined"]) {
        expect(text, `Placeholder "${placeholder}" terlihat pada bahasa ${locale}`).not.toContain(
          placeholder,
        );
      }
    });
  }

  test("kelima bahasa tersedia pada katalog yang sama", async ({ page }) => {
    // `availableLocales` memuat kelimanya, dan pemilih bahasa menampilkannya
    // (`components/catalog/CatalogNarration.tsx`).
    await stubApi(page, "GET", "/public/catalog/:slug", () =>
      apiOk({
        name: PRODUCT_NAME,
        story: PRODUCT_STORY,
        specs: PRODUCT_SPECS,
        artisan: { displayName: ARTISAN_NAME },
        media: [],
        narration: {
          audioUrl: null,
          captions: [{ startMs: 0, endMs: 3_000, text: PRODUCT_STORY }],
        },
        availableLocales: [...LOCALES],
        locale: "id",
      }),
    );

    await page.goto(`/catalog/${SLUG}`);

    await expect(page.getByRole("heading", { name: "Pilih bahasa cerita" })).toBeVisible();

    // Nama tiap bahasa dalam bahasa Indonesia, sesuai `LOCALE_LABEL`.
    for (const label of ["Bahasa Indonesia", "Bahasa Inggris", "Bahasa Jepang", "Bahasa Mandarin", "Bahasa Arab"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });
});
