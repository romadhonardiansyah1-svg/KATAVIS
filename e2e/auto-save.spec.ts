/**
 * Auto Save dan alur persetujuan.
 *
 *   TC-E2E-23  Auto Save pada interval 5 detik
 *   TC-E2E-24  Alur persetujuan sebelum terbit
 *
 * TC-E2E-23 diverifikasi dari **penanda waktu draf yang tersimpan**, bukan
 * dari indikator antarmuka. Indikator "Tersimpan pukul ..." dapat menyala
 * tanpa apa pun benar-benar tertulis, dan pengujian yang membacanya akan
 * lulus pada penerapan yang tidak menyimpan apa-apa.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  AUTOSAVE_INTERVAL_MS,
  MEDIA_ID,
  PRODUCT_ID,
  SLUG,
  TRANSCRIPT_TEXT,
  apiErrorBody,
  apiOk,
  openStep,
  readStoredDraft,
  seedAccessToken,
  seedDraft,
  stubApi,
  type Draft,
} from "./support/flow";
import { errorBanner } from "./support/errors";

/** Draf pada langkah 3: nama produk dan cerita belum lengkap. */
const DRAFT_WITH_TRANSCRIPT: Partial<Draft> = {
  productId: PRODUCT_ID,
  photoMediaId: MEDIA_ID,
  transcript: TRANSCRIPT_TEXT,
  transcriptReviewed: true,
  generatedAt: 1_700_000_000_000,
};

async function stubTranscript(page: Page): Promise<void> {
  await stubApi(page, "GET", "/products/:id/transcript", () =>
    apiOk({ text: TRANSCRIPT_TEXT, locale: "id", edited: false, provider: "groq", durationMs: 31_200 }),
  );
  await stubApi(page, "PUT", "/products/:id/transcript", () =>
    apiOk({ text: TRANSCRIPT_TEXT, edited: true }),
  );
}

test.describe("TC-E2E-23 Auto Save", () => {
  test("menyimpan draf setelah 6 detik tanpa aksi lain", async ({ page }) => {
    // S5-01: pemicunya setiap lima detik bila ada perubahan. Enam detik
    // memberi ruang satu detik di atas intervalnya, sehingga penjadwalan
    // peramban yang tidak tepat tidak menjadi penyebab kegagalan.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_WITH_TRANSCRIPT);
    await stubTranscript(page);

    await openStep(page, "/create/transcript");

    // Mencatat draf yang tersimpan sebelum penyuntingan, supaya "tersimpan"
    // tidak dapat dikacaukan dengan "sudah ada sejak awal".
    const before = await readStoredDraft(page);
    expect(before?.updatedAt, "Draf awal tidak tersemai").toBeTruthy();

    const textarea = page.getByLabel("Transkrip cerita Anda");
    await expect(textarea).toBeVisible();
    await textarea.fill(`${TRANSCRIPT_TEXT} Ditambah satu kalimat baru.`);

    // Tidak ada aksi lain selama menunggu: bukan pindah langkah, bukan tekan
    // tombol. Yang menyimpan harus penjadwalnya sendiri.
    await page.waitForTimeout(AUTOSAVE_INTERVAL_MS + 1_000);

    const after = await readStoredDraft(page);
    expect(after, "Draf tidak terbaca sesudah menunggu").not.toBeNull();
    expect(after?.transcript, "Penyuntingan tidak tersimpan").toContain("Ditambah satu kalimat baru.");
    expect(
      after?.updatedAt ?? 0,
      "Penanda waktu tidak bergerak — draf tidak benar-benar ditulis ulang",
    ).toBeGreaterThan(before?.updatedAt ?? 0);
  });

  test("menyimpan draf saat berpindah langkah, tanpa menunggu interval", async ({ page }) => {
    // S5-01 menyatakan pemicunya ada dua: interval lima detik **dan** setiap
    // perpindahan langkah. Perpindahan yang menunggu interval akan
    // kehilangan suntingan lima detik terakhir.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_WITH_TRANSCRIPT);
    await stubTranscript(page);

    await openStep(page, "/create/transcript");

    const textarea = page.getByLabel("Transkrip cerita Anda");
    await textarea.fill("Teks yang diubah tepat sebelum berpindah.");

    // Berpindah segera, jauh sebelum interval lima detik habis.
    await page.getByRole("button", { name: "Sudah benar, lanjutkan" }).click();
    await expect(page).toHaveURL(/\/create\/process$/);

    const stored = await readStoredDraft(page);
    expect(stored?.transcript).toBe("Teks yang diubah tepat sebelum berpindah.");
    expect(stored?.transcriptReviewed, "Tindakan meninjau tidak tersimpan").toBe(true);
  });

  test("indikator penyimpanan menyebut waktu, bukan animasi berputar", async ({ page }) => {
    // S5: indikatornya "Tersimpan" dengan penanda waktu. Ini bagian yang
    // diperiksa terhadap tampilan, berbeda dari TC-E2E-23 di atas yang
    // memeriksa penyimpanannya sendiri.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_WITH_TRANSCRIPT);
    await stubTranscript(page);

    await openStep(page, "/create/transcript");

    const indicator = page.getByRole("status").filter({ hasText: /Tersimpan pukul/ });
    await expect(indicator).toBeVisible({ timeout: AUTOSAVE_INTERVAL_MS + 3_000 });
    await expect(indicator).toHaveText(/Tersimpan pukul \d{2}\.\d{2}/);
  });
});

test.describe("TC-E2E-24 persetujuan sebelum terbit", () => {
  const DRAFT_READY: Partial<Draft> = {
    productId: PRODUCT_ID,
    photoMediaId: MEDIA_ID,
    transcript: TRANSCRIPT_TEXT,
    transcriptReviewed: true,
    generatedAt: 1_700_000_000_000,
    contentReviewedAt: 1_700_000_100_000,
  };

  test("terbit tanpa mencentang persetujuan tidak mungkin", async ({ page }) => {
    // CON-04: kotak centang mati secara bawaan. Persetujuan yang dicentang
    // otomatis bukan persetujuan.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_READY);
    await stubApi(page, "POST", "/products/:id/publish", () =>
      apiOk({ id: PRODUCT_ID, status: "published", slug: SLUG }),
    );

    await openStep(page, "/create/publish");

    const consent = page.getByLabel("Saya setuju katalog ini dilihat pembeli");
    await expect(consent).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Terbitkan katalog" })).toBeDisabled();

    // Menyalakannya membuka jalannya; mematikannya kembali menutupnya.
    await consent.check();
    await expect(page.getByRole("button", { name: "Terbitkan katalog" })).toBeEnabled();
    await consent.uncheck();
    await expect(page.getByRole("button", { name: "Terbitkan katalog" })).toBeDisabled();
  });

  test("teks persetujuan terbaca screen reader", async ({ page }) => {
    // CON-03. Dua hal yang diperiksa: teksnya terkait dengan kotak centangnya
    // lewat label, dan kalimatnya menjelaskan akibatnya — bukan sekadar
    // "Saya setuju".
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_READY);

    await openStep(page, "/create/publish");

    const consent = page.getByLabel("Saya setuju katalog ini dilihat pembeli");
    await expect(consent).toBeVisible();

    // Kotak centangnya punya peran yang benar, bukan `div` ber-`role`.
    await expect(consent).toHaveAttribute("type", "checkbox");

    // Akibat persetujuan dinyatakan, dan keadaannya bila belum diberikan.
    await expect(
      page.getByText("Selama kotak ini belum dicentang, katalog Anda tetap tersimpan sebagai draf"),
    ).toBeVisible();
  });

  test("server menolak penerbitan tanpa persetujuan", async ({ page }) => {
    // CON-02 menguji hal yang sama di server (TC-I-15). Yang dibuktikan di
    // sini adalah antarmuka menampilkan penolakan itu apa adanya, bukan
    // menelannya dan berpura-pura berhasil.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_READY);
    await stubApi(page, "POST", "/consent", () => apiOk({ kind: "publication", granted: true }));

    const denied = apiErrorBody(
      "CONSENT_REQUIRED",
      "Perlu persetujuan Anda sebelum melanjutkan.",
      "GIVE_CONSENT",
      403,
    );
    await stubApi(page, "POST", "/products/:id/publish", () => denied);

    await openStep(page, "/create/publish");
    await page.getByLabel("Saya setuju katalog ini dilihat pembeli").check();
    await page.getByRole("button", { name: "Terbitkan katalog" }).click();

    await expect(errorBanner(page)).toContainText("Perlu persetujuan Anda sebelum melanjutkan.");
    await expect(page).toHaveURL(/\/create\/publish$/);
  });
});
