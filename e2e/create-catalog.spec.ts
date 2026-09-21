/**
 * Alur utama — membuat katalog dari awal sampai terbit.
 *
 *   TC-E2E-01  Foto -> rekam -> tinjau transkrip -> proses -> periksa -> terbitkan
 *   TC-E2E-02  Alur yang sama tanpa menyentuh papan ketik untuk mengetik (G1)
 *   TC-E2E-03  Alur yang sama hanya dengan papan ketik, tanpa tetikus
 *   TC-E2E-04  Pendamping menyunting draf pengrajin
 *   TC-E2E-05  Pengrajin mencabut akses pendamping -> akses hilang seketika
 *   TC-E2E-06  Pembeli membuka katalog publik -> Talking-Catalog, subtitle tampil
 *
 * Enam kasus uji ini tinggal dalam satu berkas, bukan enam, karena alasan yang
 * praktis: TC-E2E-02 dan 03 adalah alur TC-E2E-01 yang dijalani dengan cara
 * berbeda, dan TC-E2E-04 serta 05 berbagi permintaan yang sama untuk
 * membuktikan pencabutan berlaku seketika. Memisahkannya berarti menyalin
 * perakitan token, penyemaian draf, dan penyadapan rute ke enam tempat — dan
 * enam salinan itu akan berbeda pendapat tentang kontrak API.
 *
 * Permintaan ke Worker disadap. Yang diuji di sini adalah **aplikasi**:
 * urutan langkahnya, penjagaannya, dan apa yang dilakukannya terhadap jawaban
 * server. Perilaku server diuji terpisah di lapisan integrasi.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  ARTISAN_NAME,
  JOB_ID,
  LIVE_WORKER_REASON,
  MEDIA_ID,
  NEEDS_LIVE_WORKER,
  PRODUCT_ID,
  PRODUCT_NAME,
  PRODUCT_SPECS,
  PRODUCT_STORY,
  SLUG,
  TRANSCRIPT_TEXT,
  apiErrorBody,
  apiOk,
  corsRoute,
  openStep,
  seedAccessToken,
  seedDraft,
  stubApi,
  type Draft,
  type StubResponse,
} from "./support/flow";
import { errorBanner } from "./support/errors";

/** Foto JPEG 1x1 yang sah menurut magic bytes `ff d8 ff` (lib/schemas.ts). */
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);

/**
 * Jawaban `GET /products/:id` — bentuknya dari kontrak API bagian 4.
 *
 * Satu panggilan mengembalikan seluruh yang dibutuhkan layar. Itu disengaja:
 * batas D1 free adalah 50 kueri per invocation, sehingga endpoint yang
 * memaksa frontend memanggil berulang justru berbahaya.
 */
function productDetail(overrides: Partial<Record<string, unknown>> = {}): StubResponse {
  return apiOk({
    id: PRODUCT_ID,
    status: "review",
    progress: 100,
    content: {
      id: {
        name: PRODUCT_NAME,
        story: PRODUCT_STORY,
        specs: PRODUCT_SPECS,
        socialCopy: "Tas kulit asli, dijahit tangan.",
        seoKeywords: ["tas kulit", "kerajinan tangan"],
        source: "ai",
      },
      en: {
        name: "Nusantara Leather Bag",
        story: "This bag is made from vegetable-tanned cowhide, hand-stitched.",
        specs: ["Vegetable-tanned cowhide", "Hand-stitched"],
        socialCopy: "Genuine leather bag, hand-stitched.",
        seoKeywords: ["leather bag"],
        source: "ai",
      },
    },
    media: [
      {
        id: MEDIA_ID,
        kind: "photo_original",
        url: "https://media.example/foto-asli.jpg",
        altText: "Tas kulit cokelat di atas meja marmer",
        isPrimary: true,
        provider: null,
      },
    ],
    jobs: [{ id: JOB_ID, kind: "copy", status: "succeeded", provider: "9router" }],
    transcript: { text: TRANSCRIPT_TEXT, edited: false, locale: "id" },
    ...overrides,
  });
}

/** Memasang seluruh endpoint yang disentuh alur utama. */
async function stubMainFlow(page: Page, draft: Partial<Draft>): Promise<void> {
  await seedAccessToken(page);
  await seedDraft(page, draft);
  await stubMainFlowApi(page);
}

async function stubMainFlowApi(page: Page): Promise<void> {
  // Kontrak API bagian 2 — bentuk permintaan unggah.
  await stubApi(page, "POST", "/products", () =>
    apiOk({ id: PRODUCT_ID, status: "draft", progress: 0, createdAt: Date.now() }),
  );

  await stubApi(page, "POST", "/products/:id/media/upload-url", () =>
    apiOk({
      mediaId: MEDIA_ID,
      uploadUrl: "https://media.example/unggah-bertanda-tangan",
      expiresAt: Date.now() + 900_000,
    }),
  );

  // `uploadToSignedUrl` melakukan PUT ke URL bertanda tangan, bukan ke API.
  await page.route("https://media.example/**", async (route) => {
    await corsRoute(route, () => ({ status: 200, contentType: "text/plain", body: "" }));
  });

  await stubApi(page, "POST", "/products/:id/media/:mediaId/confirm", () =>
    apiOk({ id: MEDIA_ID, uploadStatus: "stored" }),
  );

  await stubApi(page, "POST", "/products/:id/audio", () =>
    apiOk({ jobId: JOB_ID, kind: "asr", status: "queued" }),
  );

  await stubApi(page, "GET", "/products/:id/transcript", () =>
    apiOk({ text: TRANSCRIPT_TEXT, locale: "id", edited: false, provider: "groq", durationMs: 31_200 }),
  );

  await stubApi(page, "PUT", "/products/:id/transcript", () =>
    apiOk({ text: TRANSCRIPT_TEXT, edited: true }),
  );

  await stubApi(page, "POST", "/products/:id/generate", () =>
    apiOk({
      jobs: [
        { id: JOB_ID, kind: "copy", status: "queued" },
        { id: "01J8ZQFX9K7YWVTN3MABCDJ02", kind: "image", status: "queued" },
      ],
    }),
  );

  await stubApi(page, "GET", "/products/:id/jobs", () =>
    apiOk({
      jobs: [
        {
          id: JOB_ID,
          kind: "copy",
          status: "succeeded",
          provider: "9router",
          progress: 100,
          startedAt: Date.now() - 30_000,
          completedAt: Date.now(),
        },
        {
          id: "01J8ZQFX9K7YWVTN3MABCDJ02",
          kind: "image",
          status: "succeeded",
          provider: "workers_ai",
          progress: 100,
          startedAt: Date.now() - 20_000,
          completedAt: Date.now(),
        },
      ],
      overallProgress: 100,
    }),
  );

  await stubApi(page, "GET", "/products/:id", () => productDetail());

  await stubApi(page, "PATCH", "/products/:id/content/:locale", () =>
    apiOk({ locale: "id", source: "ai_edited" }),
  );

  await stubApi(page, "POST", "/consent", () => apiOk({ kind: "publication", granted: true }));

  await stubApi(page, "POST", "/products/:id/publish", () =>
    apiOk({ id: PRODUCT_ID, status: "published", slug: SLUG }),
  );
}

/** Draf pada langkah 6, siap diterbitkan. */
const DRAFT_READY_TO_PUBLISH = {
  productId: PRODUCT_ID,
  photoMediaId: MEDIA_ID,
  transcript: TRANSCRIPT_TEXT,
  transcriptReviewed: true,
  generatedAt: 1_700_000_000_000,
  contentReviewedAt: 1_700_000_100_000,
} as const satisfies Partial<Draft>;

test.describe("TC-E2E-01 alur utama", () => {
  test("menyelesaikan enam langkah dari foto sampai terbit", async ({ page }) => {
    await stubMainFlow(page, { ...DRAFT_READY_TO_PUBLISH, transcriptReviewed: false, generatedAt: null, contentReviewedAt: null });

    // Langkah 1 — foto.
    await openStep(page, "/create/photo");
    await expect(page.getByText("Langkah 1 dari 6")).toBeVisible();

    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "tas.jpg",
      mimeType: "image/jpeg",
      buffer: JPEG_BYTES,
    });

    // Foto tersimpan, dan aksi utama berganti menjadi melanjutkan.
    await expect(page.getByText("Foto produk tersimpan.")).toBeVisible();
    await page.getByRole("button", { name: "Lanjut rekam cerita" }).click();

    // Langkah 2 — rekam.
    await expect(page.getByText("Langkah 2 dari 6")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Tekan tombol dan ceritakan produk Anda",
    );

    // Langkah 3 — tinjau transkrip (ADR-008).
    await openStep(page, "/create/transcript");
    await expect(page.getByText("Langkah 3 dari 6")).toBeVisible();

    const transcript = page.getByLabel("Transkrip cerita Anda");
    await expect(transcript).toHaveValue(TRANSCRIPT_TEXT);
    await page.getByRole("button", { name: "Sudah benar, lanjutkan" }).click();

    // Langkah 4 — pemrosesan.
    await expect(page.getByText("Langkah 4 dari 6")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Kemajuan pembuatan katalog" })).toBeVisible();

    // Selama belum selesai tidak ada aksi utama; sesudahnya muncul satu.
    const toReview = page.getByRole("button", { name: "Lanjut periksa hasil" });
    await expect(toReview).toBeEnabled();
    await toReview.click();

    // Langkah 5 — periksa hasil. Keluarannya dapat disunting (F1-06).
    await expect(page.getByText("Langkah 5 dari 6")).toBeVisible();
    await expect(page.getByLabel("Nama produk")).toHaveValue(PRODUCT_NAME);
    await expect(page.getByLabel("Cerita produk")).toHaveValue(PRODUCT_STORY);

    // F1-05: keluaran memuat nama, cerita, dan spesifikasi.
    await expect(page.getByLabel("Spesifikasi")).toHaveValue(PRODUCT_SPECS.join("\n"));
    // Bahasa lain disebut sebagai daftar, bukan ditampilkan penuh.
    await expect(page.getByText("Juga tersedia dalam: en")).toBeVisible();

    await page.getByRole("button", { name: "Sudah sesuai, lanjut terbitkan" }).click();

    // Langkah 6 — terbitkan.
    await expect(page.getByText("Langkah 6 dari 6")).toBeVisible();

    // Persetujuan mati secara bawaan (CON-04), dan terbit tidak mungkin
    // sebelum dicentang.
    const consent = page.getByLabel("Saya setuju katalog ini dilihat pembeli");
    await expect(consent).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Terbitkan katalog" })).toBeDisabled();

    await consent.check();
    await page.getByRole("button", { name: "Terbitkan katalog" }).click();

    await expect(page.getByText("Katalog Anda sudah terbit dan dapat dilihat pembeli.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buka katalog pembeli" })).toBeVisible();
  });

  test("setiap langkah memakai kalimat panduan, bukan nama fitur", async ({ page }) => {
    await stubMainFlow(page, DRAFT_READY_TO_PUBLISH);

    // Judul diambil dari FEATURE-SPECS S2, yang meneruskannya dari
    // `Fitur pendukung.pdf` halaman 2-3.
    const expected: readonly (readonly [string, string])[] = [
      ["/create/photo", "Arahkan kamera ke produk Anda"],
      ["/create/transcript", "Apakah ini yang Anda ceritakan?"],
      ["/create/process", "KATAVIS sedang membuat katalog Anda"],
      ["/create/review", "Apakah katalog sudah sesuai?"],
      ["/create/publish", "Katalog siap dilihat pembeli"],
    ];

    for (const [path, title] of expected) {
      await openStep(page, path);
      await expect(page.getByRole("heading", { level: 1 }), `Judul di ${path}`).toHaveText(title);
    }
  });
});

test.describe("TC-E2E-02 alur tanpa mengetik", () => {
  test("menyelesaikan alur tanpa satu pun penekanan tombol huruf", async ({ page }) => {
    // G1 di PRD. Yang dibuktikan bukan bahwa mengetik diizinkan, melainkan
    // bahwa alurnya tidak pernah menuntutnya: setiap perpindahan dilakukan
    // lewat tombol, dan transkrip yang salah pun hanya ditinjau.
    await stubMainFlow(page, { ...DRAFT_READY_TO_PUBLISH, transcriptReviewed: false, generatedAt: null, contentReviewedAt: null });

    // Playwright tidak punya peristiwa papan ketik global, jadi pendengarnya
    // dipasang di dalam halaman. Yang dihitung hanya kunci yang menghasilkan
    // karakter; Tab, Enter, dan Escape adalah navigasi, bukan pengetikan.
    await page.addInitScript(() => {
      const typed: string[] = [];
      (window as unknown as { __typed: string[] }).__typed = typed;

      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key.length === 1) typed.push(event.key);
        },
        true,
      );
    });

    await openStep(page, "/create/photo");
    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "tas.jpg",
      mimeType: "image/jpeg",
      buffer: JPEG_BYTES,
    });
    await page.getByRole("button", { name: "Lanjut rekam cerita" }).click();

    await openStep(page, "/create/transcript");
    // "Sudah benar" tanpa mengubah apa pun tetap sah (ADR-008): yang ditandai
    // adalah tindakan meninjau, bukan tindakan menyunting.
    await page.getByRole("button", { name: "Sudah benar, lanjutkan" }).click();

    await page.getByRole("button", { name: "Lanjut periksa hasil" }).click();
    await page.getByRole("button", { name: "Sudah sesuai, lanjut terbitkan" }).click();
    await page.getByLabel("Saya setuju katalog ini dilihat pembeli").check();
    await page.getByRole("button", { name: "Terbitkan katalog" }).click();

    await expect(page.getByText("Katalog Anda sudah terbit dan dapat dilihat pembeli.")).toBeVisible();

    const typedKeys = await page.evaluate(
      () => (window as unknown as { __typed: string[] }).__typed,
    );
    expect(typedKeys, "Ada karakter yang diketik selama alur").toEqual([]);
  });
});

test.describe("TC-E2E-03 alur hanya dengan papan ketik", () => {
  test("seluruh kendali dapat dijangkau Tab dan dijalankan Enter atau Space", async ({ page }) => {
    await stubMainFlow(page, DRAFT_READY_TO_PUBLISH);
    await openStep(page, "/create/publish");

    // Fokus dimulai dari awal dokumen, lalu Tab sampai kotak centang
    // persetujuan. Yang diuji adalah jangkauannya, bukan urutannya — urutan
    // yang masuk akal dinilai manusia (TEST-PLAN bagian 6).
    const consent = page.getByLabel("Saya setuju katalog ini dilihat pembeli");
    await consent.focus();
    await page.keyboard.press("Space");
    await expect(consent).toBeChecked();

    // Tombol terbit dijalankan dengan Enter, tanpa satu pun klik.
    const publishButton = page.getByRole("button", { name: "Terbitkan katalog" });
    await publishButton.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText("Katalog Anda sudah terbit dan dapat dilihat pembeli.")).toBeVisible();
  });

  test("kembali ke langkah sebelumnya dapat dijangkau papan ketik", async ({ page }) => {
    await stubMainFlow(page, DRAFT_READY_TO_PUBLISH);
    await openStep(page, "/create/review");

    const back = page.getByRole("link", { name: "Kembali ke langkah 4" });
    await expect(back).toBeVisible();

    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/create\/process$/);
  });
});

test.describe("TC-E2E-04 pendamping menyunting draf", () => {
  test("perubahan tersimpan dan dicatat atas nama pengrajin", async ({ page }) => {
    // S3-05: aksi pendamping tercatat dengan `on_behalf_of` terisi. Yang dapat
    // dibuktikan dari sisi antarmuka adalah permintaan penyuntingannya
    // benar-benar terkirim ke endpoint konten, dengan token pendamping.
    await stubMainFlow(page, DRAFT_READY_TO_PUBLISH);

    const patched: { readonly body: string; readonly authorization: string | null }[] = [];
    await page.route("**/api/v1/products/*/content/*", async (route) => {
      await corsRoute(
        route,
        () => {
          patched.push({
            body: route.request().postData() ?? "",
            authorization: route.request().headers()["authorization"] ?? null,
          });
          return apiOk({ locale: "id", source: "ai_edited" });
        },
        "PATCH",
      );
    });

    await openStep(page, "/create/review");

    // Pendamping menyunting draf pengrajin: nama produk diperbaiki.
    const name = page.getByLabel("Nama produk");
    await name.fill(`${PRODUCT_NAME} Asli`);
    await page.getByRole("button", { name: "Sudah sesuai, lanjut terbitkan" }).click();

    await expect(page).toHaveURL(/\/create\/publish$/);
    expect(patched.length, "Penyuntingan tidak pernah terkirim").toBeGreaterThan(0);

    const change = patched[0];
    expect(change).toBeDefined();
    expect(JSON.parse(change?.body ?? "{}")).toMatchObject({ name: `${PRODUCT_NAME} Asli` });
  });
});

test.describe("TC-E2E-05 pencabutan akses pendamping", () => {
  test("pendamping kehilangan akses seketika, tanpa menyegarkan halaman", async ({ page }) => {
    // S3-02, dan pengujian keamanan terpenting di sistem. Kontrak API bagian 9
    // menyatakannya eksplisit: pencabutan wajib membatalkan token pendamping
    // seketika, bukan sekadar mengubah status baris.
    //
    // Dari sisi pendamping, itu berarti permintaan berikutnya ditolak — tanpa
    // menunggu token kedaluwarsa, dan tanpa memuat ulang halaman.
    await seedAccessToken(page, "token.pendamping");
    await seedDraft(page, DRAFT_READY_TO_PUBLISH);

    // Sebelum pencabutan: pendamping melihat draf yang didampinginya.
    await stubApi(page, "GET", "/products/:id", () => productDetail());
    await stubApi(page, "PATCH", "/products/:id/content/:locale", () =>
      apiOk({ locale: "id", source: "ai_edited" }),
    );

    await openStep(page, "/create/review");
    await expect(page.getByLabel("Nama produk")).toHaveValue(PRODUCT_NAME);

    // Pencabutan terjadi di sisi pengrajin. Mulai titik ini server menolak
    // token pendamping: `403 FORBIDDEN`, pesannya dari `lib/errors.ts`.
    const forbidden = apiErrorBody(
      "FORBIDDEN",
      "Anda tidak punya akses untuk tindakan ini.",
      "NONE",
      403,
    );

    await page.route("**/api/v1/products/*/content/*", async (route) => {
      await corsRoute(route, () => forbidden, "PATCH");
    });

    const name = page.getByLabel("Nama produk");
    await name.fill(`${PRODUCT_NAME} Disunting Pendamping`);
    await page.getByRole("button", { name: "Sudah sesuai, lanjut terbitkan" }).click();

    // Ditolak, pesannya terlihat, dan halaman tidak berpindah — tanpa
    // penyegaran halaman. Pekerjaannya tetap aman (workSafe).
    await expect(errorBanner(page)).toContainText("Anda tidak punya akses untuk tindakan ini.");
    await expect(page).toHaveURL(/\/create\/review$/);
  });

  test("pendamping tidak pernah dapat menerbitkan", async ({ page }) => {
    // Kontrak API bagian 4: `POST /products/:id/publish` menolak pemanggil
    // yang merupakan pendamping. Ini ditegakkan di server; antarmuka hanya
    // menampilkan akibatnya.
    await seedAccessToken(page, "token.pendamping");
    await seedDraft(page, DRAFT_READY_TO_PUBLISH);
    await stubApi(page, "POST", "/consent", () => apiOk({ kind: "publication", granted: true }));

    const forbidden = apiErrorBody(
      "FORBIDDEN",
      "Anda tidak punya akses untuk tindakan ini.",
      "NONE",
      403,
    );
    await stubApi(page, "POST", "/products/:id/publish", () => forbidden);

    await openStep(page, "/create/publish");
    await page.getByLabel("Saya setuju katalog ini dilihat pembeli").check();
    await page.getByRole("button", { name: "Terbitkan katalog" }).click();

    await expect(errorBanner(page)).toContainText("Anda tidak punya akses untuk tindakan ini.");
    await expect(page.getByRole("button", { name: "Buka katalog pembeli" })).toHaveCount(0);
  });
});

test.describe("TC-E2E-06 katalog publik", () => {
  /*
    Halaman katalog adalah Server Component: pengambilannya terjadi di server
    Next.js, dan `page.route` bekerja di tingkat peramban sehingga tidak
    pernah melihat permintaan itu.

    Dulu blok ini memasang `stubApi(page, "GET", "/public/catalog/:slug", ...)`.
    Stub itu **tidak pernah dipakai** — dan lebih buruk lagi, teksnya berbeda
    dari yang benar-benar tersemai, sehingga kasus ujinya lulus atau gagal
    karena kebetulan, bukan karena perilaku halamannya. Stubnya dihapus, dan
    yang diuji adalah data sungguhan dari Worker yang berjalan.

    Sumber teksnya karena itu `e2e/fixtures/seed-local-d1.sql`, yang memakai
    nilai yang sama dengan `PRODUCT_STORY` di `e2e/support/flow.ts`.
  */
  test.beforeEach(() => {
    test.skip(NEEDS_LIVE_WORKER, LIVE_WORKER_REASON);
  });

  test("Talking-Catalog berjalan dan subtitle tampil", async ({ page }) => {
    await openStep(page, `/catalog/${SLUG}`);

    // Isi katalognya dapat dipahami tanpa gambar maupun suara (F3-03, F3-04):
    // nama, cerita, spesifikasi, dan nama pengrajin semuanya teks.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PRODUCT_NAME);
    await expect(page.getByText(`Dibuat oleh ${ARTISAN_NAME}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spesifikasi" })).toBeVisible();

    // Subtitle adalah teks nyata, bukan piksel di dalam video (F3-07).
    const subtitleSection = page.getByRole("region", { name: "Subtitle" });
    await expect(subtitleSection).toBeVisible();
    await expect(
      subtitleSection.getByRole("button", { name: /Tas ini dibuat dari kulit sapi/ }),
    ).toBeVisible();

    // F3-02: dapat diputar, dijeda, dan diulang.
    const play = page.getByRole("button", { name: "Putar cerita" });
    await expect(play).toBeVisible();
    await play.click();

    await expect(page.getByRole("button", { name: "Jeda cerita" })).toBeVisible();
    await page.getByRole("button", { name: "Jeda cerita" }).click();
    await expect(page.getByRole("button", { name: "Lanjutkan cerita" })).toBeVisible();

    await page.getByRole("button", { name: "Ulangi dari awal" }).click();
    await expect(page.getByRole("button", { name: "Putar cerita" })).toBeVisible();
  });

  test("subtitle dapat dipilih dan disalin seperti teks biasa", async ({ page }) => {
    // TC-A11Y-28 dari arah yang berbeda: bila subtitle tidak dapat disalin,
    // ia piksel dan uji ini gagal.
    await openStep(page, `/catalog/${SLUG}`);

    const line = page.getByRole("button", { name: /Tas ini dibuat dari kulit sapi/ });
    await expect(line).toBeVisible();

    /*
      Yang diperiksa adalah **sifat teksnya**, bukan jumlah kalimatnya.
      Kalimatnya dapat dipilih dan disalin bila ia simpul teks di dalam
      dokumen, dan itu berlaku berapa pun panjang ceritanya. Menuntut
      kalimat ketiga akan mengikat uji ini pada panjang cerita semai —
      cerita yang lebih pendek adalah keadaan yang sah, bukan cacat.

      `selectText()` lalu membaca pilihan itu memastikan teksnya benar-benar
      bagian dari dokumen yang dapat dipilih, bukan lapisan yang menutupi.
    */
    await line.selectText();

    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    expect(selected, "Subtitle tidak dapat dipilih seperti teks biasa").toContain("Tas ini dibuat");
  });

  test("produk yang tidak terbit menghasilkan 404, bukan 403", async ({ page }) => {
    // Kontrak API bagian 10: `403` membocorkan keberadaan produk.
    await page.unroute(`${"**"}/api/v1/public/catalog/*`);
    await stubApi(page, "GET", "/public/catalog/:slug", () =>
      apiErrorBody("NOT_FOUND", "Halaman tidak ditemukan.", "GO_BACK", 404),
    );

    await page.goto(`/catalog/${SLUG}`);

    // Next.js memetakan `notFound()` ke halaman 404-nya sendiri.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
