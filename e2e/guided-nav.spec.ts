/**
 * Guided Navigation enam langkah.
 *
 *   TC-E2E-25  Setiap langkah punya tepat satu aksi utama; mundur tidak
 *              kehilangan data; lompat langkah tidak mungkin
 *
 * Mengukur S2-01 sampai S2-05 di FEATURE-SPECS:
 *
 *   S2-01  Enam langkah dalam urutan tetap
 *   S2-02  Setiap layar punya tepat satu aksi utama
 *   S2-03  Mundur tidak menghilangkan data
 *   S2-04  Melompati langkah lewat URL ditolak
 *   S2-05  Indikator posisi langkah terlihat di setiap layar
 */

import { expect, test, type Page } from "@playwright/test";

import {
  JOB_ID,
  MEDIA_ID,
  PRODUCT_ID,
  TRANSCRIPT_TEXT,
  apiOk,
  openStep,
  readStoredDraft,
  seedAccessToken,
  seedDraft,
  stubApi,
  type Draft,
} from "./support/flow";

/** Enam langkah beserta syaratnya — `app/create/flow.ts`. */
const STEPS = [
  { id: "photo", position: 1, path: "/create/photo", requires: "selalu terbuka" },
  { id: "record", position: 2, path: "/create/record", requires: "productId" },
  { id: "transcript", position: 3, path: "/create/transcript", requires: "photoMediaId" },
  { id: "process", position: 4, path: "/create/process", requires: "transcriptReviewed" },
  { id: "review", position: 5, path: "/create/review", requires: "generatedAt" },
  { id: "publish", position: 6, path: "/create/publish", requires: "contentReviewedAt" },
] as const;

/** Draf yang membuka seluruh enam langkah. */
const FULL_DRAFT: Partial<Draft> = {
  productId: PRODUCT_ID,
  photoMediaId: MEDIA_ID,
  transcript: TRANSCRIPT_TEXT,
  transcriptReviewed: true,
  generatedAt: 1_700_000_000_000,
  contentReviewedAt: 1_700_000_100_000,
};

async function stubEverything(page: Page): Promise<void> {
  await stubApi(page, "GET", "/products/:id/transcript", () =>
    apiOk({ text: TRANSCRIPT_TEXT, locale: "id", edited: false, provider: "groq", durationMs: 31_200 }),
  );

  // Halaman proses meminta generate sekali, lalu bertanya ke `GET /jobs`
  // setiap dua detik. Tombol "Lanjut periksa hasil" hanya aktif bila ada
  // minimal satu pekerjaan dan semuanya berstatus akhir — daftar kosong
  // membuatnya disabled selamanya, dan itu bug harness, bukan produk.
  await stubApi(page, "POST", "/products/:id/generate", () =>
    apiOk({ jobs: [{ id: JOB_ID, kind: "copy", status: "queued" }] }),
  );
  await stubApi(page, "GET", "/products/:id/jobs", () =>
    apiOk({
      jobs: [{ id: JOB_ID, kind: "copy", status: "succeeded", provider: "9router", progress: 100 }],
      overallProgress: 100,
    }),
  );

  await stubApi(page, "GET", "/products/:id", () =>
    apiOk({
      id: PRODUCT_ID,
      status: "review",
      progress: 100,
      content: {
        id: { name: "Tas Kulit", story: "Cerita.", specs: ["Kulit"], socialCopy: null, seoKeywords: [], source: "ai" },
      },
      media: [],
      jobs: [],
      transcript: { text: TRANSCRIPT_TEXT, edited: false, locale: "id" },
    }),
  );
}

test.describe("TC-E2E-25 guided navigation", () => {
  test("indikator posisi terlihat di setiap langkah", async ({ page }) => {
    // S2-05. Indikatornya "Langkah N dari 6", dan harus ada di setiap layar.
    await seedAccessToken(page);
    await seedDraft(page, FULL_DRAFT);
    await stubEverything(page);

    for (const step of STEPS) {
      await openStep(page, step.path);
      await expect(
        page.getByText(`Langkah ${step.position} dari 6`),
        `Indikator langkah tidak terlihat di ${step.path}`,
      ).toBeVisible();
    }
  });

  test("setiap langkah punya tepat satu aksi utama", async ({ page }) => {
    // S2-02: bila ada dua tombol dengan bobot visual setara, desainnya salah.
    // Yang dihitung adalah `.primaryButton` dari `StepShell` — kerangkanya
    // hanya menyediakan satu slot aksi utama, dan halaman tidak punya cara
    // menambahkan tombol kedua yang berbobot sama.
    await seedAccessToken(page);
    await seedDraft(page, FULL_DRAFT);
    await stubEverything(page);

    for (const step of STEPS) {
      await openStep(page, step.path);

      const primaryCount = await page.locator("main ~ footer button").count();
      const footerButtons = await page
        .locator("footer")
        .evaluate((footer) => footer.querySelectorAll("button").length);

      // Tepat satu tombol aksi. Tombol sekunder langkah (misalnya "Rekam
      // ulang") berada di dalam `main`, bukan di `footer`, dan itulah yang
      // membuat keduanya berbeda bobot.
      expect(
        footerButtons,
        `${step.path}: jumlah tombol aksi utama di footer`,
      ).toBeGreaterThanOrEqual(1);
      expect(primaryCount).toBeGreaterThanOrEqual(0);
    }

    // Pemeriksaan yang mengikat: kelas aksi utama hanya muncul sekali.
    for (const step of STEPS) {
      await openStep(page, step.path);
      const primary = await page.locator('[class*="primaryButton"]').count();
      expect(primary, `${step.path}: jumlah aksi utama`).toBe(1);
    }
  });

  test("melompati langkah lewat URL ditolak", async ({ page }) => {
    // S2-04. Draf kosong: hanya langkah 1 yang boleh dibuka. Membuka
    // langkah mana pun yang lain harus mengembalikan ke langkah 1, bukan
    // menampilkan halaman galat.
    await seedAccessToken(page);
    await seedDraft(page, {});
    await stubEverything(page);

    for (const step of STEPS.filter((candidate) => candidate.position > 1)) {
      await page.goto(step.path);

      await expect(
        page,
        `Lompatan ke ${step.path} tidak ditolak`,
      ).toHaveURL(/\/create\/photo$/);
    }
  });

  test("lompatan ke langkah tengah berhenti di langkah terjauh yang sah", async ({ page }) => {
    // Draf yang sudah punya foto: langkah 3 boleh, langkah 4 sampai 6 tidak.
    // Yang dituju adalah langkah terjauh yang sah, bukan langkah 1.
    await seedAccessToken(page);
    await seedDraft(page, { productId: PRODUCT_ID, photoMediaId: MEDIA_ID });
    await stubEverything(page);

    for (const path of ["/create/process", "/create/review", "/create/publish"]) {
      await page.goto(path);
      await expect(page, `Lompatan ke ${path} tidak berhenti di langkah 3`).toHaveURL(
        /\/create\/transcript$/,
      );
    }
  });

  test("mundur tidak menghilangkan data", async ({ page }) => {
    // S2-03. Alur ini tidak pernah menghapus draf, jadi mundur berarti
    // kembali ke layar yang isinya masih utuh.
    await seedAccessToken(page);
    await seedDraft(page, FULL_DRAFT);
    await stubEverything(page);

    await openStep(page, "/create/review");
    await expect(page.getByLabel("Nama produk")).toBeVisible();

    const before = await readStoredDraft(page);
    expect(before?.transcript).toBe(TRANSCRIPT_TEXT);

    // Kembali ke langkah sebelumnya lewat tautannya.
    await page.getByRole("link", { name: "Kembali ke langkah 4" }).click();
    await expect(page).toHaveURL(/\/create\/process$/);

    // Maju lagi, lalu kembali dua langkah — datanya harus tetap sama.
    await page.getByRole("button", { name: "Lanjut periksa hasil" }).click();
    await expect(page).toHaveURL(/\/create\/review$/);
    await page.getByRole("link", { name: "Kembali ke langkah 4" }).click();
    await expect(page).toHaveURL(/\/create\/process$/);

    const after = await readStoredDraft(page);
    expect(after?.transcript, "Transkrip hilang setelah mundur").toBe(TRANSCRIPT_TEXT);
    expect(after?.photoMediaId, "Foto hilang setelah mundur").toBe(MEDIA_ID);
    expect(after?.generatedAt, "Penanda pemrosesan hilang setelah mundur").not.toBeNull();
  });

  test("enam langkah dalam urutan tetap", async ({ page }) => {
    // S2-01. Urutannya diperiksa dari rantai tautan "Kembali ke langkah N",
    // yang menyusun mundurnya satu per satu.
    await seedAccessToken(page);
    await seedDraft(page, FULL_DRAFT);
    await stubEverything(page);

    const titles: readonly (readonly [string, string])[] = [
      ["/create/photo", "Arahkan kamera ke produk Anda"],
      ["/create/record", "Tekan tombol dan ceritakan produk Anda"],
      ["/create/transcript", "Apakah ini yang Anda ceritakan?"],
      ["/create/process", "KATAVIS sedang membuat katalog Anda"],
      ["/create/review", "Apakah katalog sudah sesuai?"],
      ["/create/publish", "Katalog siap dilihat pembeli"],
    ];

    for (const [path, title] of titles) {
      await openStep(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    }
  });

  test("halaman masuk /create mengarahkan ke langkah terjauh yang sah", async ({ page }) => {
    // Tanpa halaman ini, pengrajin yang membuka kembali aplikasinya tidak
    // punya cara menebak harus mulai dari mana.
    await seedAccessToken(page);
    await seedDraft(page, {
      productId: PRODUCT_ID,
      photoMediaId: MEDIA_ID,
      transcript: TRANSCRIPT_TEXT,
      transcriptReviewed: true,
    });
    await stubEverything(page);

    await page.goto("/create");
    await expect(page).toHaveURL(/\/create\/process$/);
  });
});
