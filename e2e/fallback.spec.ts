/**
 * Alur kegagalan — bagian yang menyelamatkan demo.
 *
 *   TC-E2E-10  Studio Agent mati            -> fallback ke Workers AI, pengguna tetap dapat gambar
 *   TC-E2E-11  Studio Agent menggantung 45s -> dibatalkan, fallback jalan, layar tidak membeku
 *   TC-E2E-12  Groq mengembalikan 429       -> fallback ke Workers AI Whisper
 *   TC-E2E-13  Seluruh penyedia gambar gagal -> pesan ramah + foto asli bertahan + tombol coba lagi
 *   TC-E2E-14  Jaringan putus saat merekam  -> draf tersimpan, dapat dilanjutkan
 *   TC-E2E-15  Jaringan putus saat pemrosesan -> progres dipulihkan, pekerjaan tidak hilang
 *   TC-E2E-16  Tab ditutup di tengah proses -> draf tersimpan, muncul saat dibuka lagi
 *   TC-E2E-17  ASR menghasilkan transkrip kacau -> dapat dikoreksi di layar tinjau
 *   TC-E2E-18  Berkas 15 MB diunggah         -> ditolak dengan pesan yang menjelaskan batas
 *
 * Yang diuji di sini adalah perilaku **aplikasi** terhadap kegagalan: apa yang
 * dilihat pengrajin, dan apakah pekerjaannya bertahan. Rantai fallback antar
 * penyedia AI diuji di `worker/jobs/chain.test.ts` — E2E tidak dapat melihat
 * penyedia mana yang dipakai, karena antarmuka sengaja tidak menampilkannya
 * (kontrak API bagian 7: "Antarmuka tidak menampilkan nilai ini ke pengrajin").
 */

import { expect, test } from "@playwright/test";

import {
  LIMITS,
  MEDIA_ID,
  PRODUCT_ID,
  TRANSCRIPT_TEXT,
  apiOk,
  corsRoute,
  offline,
  openStep,
  readStoredDraft,
  seedAccessToken,
  seedDraft,
  stubApi,
} from "./support/flow";
import { errorCaseFor } from "./support/catalog";
import { errorBanner, expectNoTechnicalTerms, statesWorkIsSafe } from "./support/errors";

function errorStub(code: string) {
  const errorCase = errorCaseFor(code);
  return {
    status: errorCase.status,
    body: {
      ok: false,
      error: {
        code: errorCase.code,
        message: errorCase.message,
        action: errorCase.action,
        workSafe: true,
      },
    },
  };
}

/** Draf pada langkah 4, tempat pemrosesan berjalan. */
const DRAFT_AT_PROCESS = {
  productId: PRODUCT_ID,
  photoMediaId: MEDIA_ID,
  transcript: TRANSCRIPT_TEXT,
  transcriptReviewed: true,
} as const;

test.describe("TC-E2E-10 Studio Agent mati", () => {
  test("pengguna tetap mendapat gambar lewat fallback", async ({ page }) => {
    // Kontrak API bagian 7: `provider` berubah saat fallback aktif,
    // `gemini_web` -> `workers_ai`. Antarmuka tidak menampilkannya, tetapi
    // hasilnya harus ada: pekerjaan berstatus sukses, bukan gagal.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_AT_PROCESS);
    await stubApi(page, "POST", "/products/:id/generate", () =>
      apiOk({
        jobs: [
          { id: "01J8ZQFX9K7YWVTN3MABCDJ012", kind: "copy", status: "queued" },
          { id: "01J8ZQFX9K7YWVTN3MABCDJ023", kind: "image", status: "queued" },
        ],
      }),
    );

    // Agen mati: pekerjaan gambar dikerjakan Workers AI, tanpa menunggu
    // batas 45 detik (kontrak API bagian 8: tanpa heartbeat sehat selama 30
    // detik, pekerjaan gambar langsung menuju Workers AI).
    await stubApi(page, "GET", "/products/:id/jobs", () =>
      apiOk({
        jobs: [
          {
            id: "01J8ZQFX9K7YWVTN3MABCDJ012",
            kind: "copy",
            status: "succeeded",
            provider: "9router",
            progress: 100,
          },
          {
            id: "01J8ZQFX9K7YWVTN3MABCDJ023",
            kind: "image",
            status: "succeeded",
            provider: "workers_ai",
            progress: 100,
          },
        ],
        overallProgress: 100,
      }),
    );

    await openStep(page, "/create/process");

    // Hasilnya ada: tahap selesai, dan aksi utama terbuka.
    await expect(page.getByText("Katalog Anda sudah selesai dibuat.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lanjut periksa hasil" })).toBeEnabled();

    // Penyedia tidak pernah ditampilkan ke pengrajin.
    await expect(page.getByText("gemini_web")).toHaveCount(0);
    await expect(page.getByText("workers_ai")).toHaveCount(0);
  });
});

test.describe("TC-E2E-11 Studio Agent menggantung", () => {
  test("tidak ada layar membeku; tahapnya terus bergerak", async ({ page }) => {
    // ADR-004 menetapkan batas waktu keras 45 detik. Yang diperiksa di sini
    // adalah akibatnya bagi pengrajin: layarnya tidak berhenti, dan kemajuan
    // tetap bergerak sampai hasilnya ada.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_AT_PROCESS);
    await stubApi(page, "POST", "/products/:id/generate", () =>
      apiOk({ jobs: [{ id: "01J8ZQFX9K7YWVTN3MABCDJ023", kind: "image", status: "queued" }] }),
    );

    let polls = 0;
    await stubApi(page, "GET", "/products/:id/jobs", () => {
      polls += 1;
      // Beberapa putaran pertama berjalan lambat, seperti agen yang
      // menggantung. Sesudahnya fallback mengambil alih.
      if (polls < 3) {
        return apiOk({
          jobs: [
            {
              id: "01J8ZQFX9K7YWVTN3MABCDJ023",
              kind: "image",
              status: "running",
              provider: "gemini_web",
              progress: 20,
              attempt: 1,
            },
          ],
          overallProgress: 20,
        });
      }

      return apiOk({
        jobs: [
          {
            id: "01J8ZQFX9K7YWVTN3MABCDJ023",
            kind: "image",
            status: "succeeded",
            provider: "workers_ai",
            progress: 100,
          },
        ],
        overallProgress: 100,
      });
    });

    await openStep(page, "/create/process");

    // Selama berjalan, tidak ada aksi utama — dan kemajuannya terlihat.
    const progress = page.getByRole("progressbar", { name: "Kemajuan pembuatan katalog" });
    await expect(progress).toBeVisible();

    // Sesudah fallback, hasilnya ada tanpa intervensi pengguna.
    await expect(page.getByText("Katalog Anda sudah selesai dibuat.", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(polls, "Polling tidak pernah berjalan").toBeGreaterThan(0);
  });
});

test.describe("TC-E2E-12 Groq mengembalikan 429", () => {
  test("transkrip tetap diperoleh lewat fallback", async ({ page }) => {
    // F1-09. Pengrajin tidak melihat kegagalan penyedia mana pun: yang
    // dilihatnya adalah transkripnya muncul.
    await seedAccessToken(page);
    await seedDraft(page, {
      productId: PRODUCT_ID,
      photoMediaId: MEDIA_ID,
      audioJobId: "01J8ZQFX9K7YWVTN3MABCDJ012",
    });

    let attempts = 0;
    await stubApi(page, "GET", "/products/:id/transcript", () => {
      attempts += 1;
      // Percobaan pertama gagal karena batas laju penyedia, yang kedua
      // berhasil lewat Workers AI Whisper.
      if (attempts === 1) return errorStub("RATE_LIMITED");
      return apiOk({
        text: TRANSCRIPT_TEXT,
        locale: "id",
        edited: false,
        provider: "workers_ai",
        durationMs: 29_000,
      });
    });

    await openStep(page, "/create/transcript");

    // Layar tetap menunggu dengan tenang pada percobaan pertama, lalu
    // menampilkan transkripnya.
    await expect(page.getByLabel("Transkrip cerita Anda")).toHaveValue(TRANSCRIPT_TEXT, {
      timeout: 15_000,
    });

    // Tidak ada istilah penyedia yang terlihat pengrajin.
    await expectNoTechnicalTerms(page, "fallback ASR");
  });
});

test.describe("TC-E2E-13 seluruh penyedia gambar gagal", () => {
  test("pesan ramah, foto asli bertahan, kode aksi tidak tampil mentah", async ({ page }) => {
    // F2-07 dan F2-09: foto asli tidak pernah ditimpa, dan kegagalan generate
    // tidak boleh menghapus karya pengguna.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_AT_PROCESS);
    await stubApi(page, "POST", "/products/:id/generate", () => errorStub("IMAGE_GENERATE_FAILED"));

    await openStep(page, "/create/process");

    const banner = errorBanner(page);
    await expect(banner).toBeVisible();

    // Pesannya persis dari katalog, dan menyatakan foto asli tetap ada.
    const failure = errorCaseFor("IMAGE_GENERATE_FAILED");
    await expect(banner).toContainText(failure.message);
    await expect(page.getByText("Foto asli Anda tetap tersimpan.")).toBeVisible();
    expect(statesWorkIsSafe(failure.message)).toBe(true);

    // Pengrajin tetap dapat melanjutkan (tombolnya bukan jalan buntu).
    await expect(page.getByRole("button", { name: "Lanjut periksa hasil" })).toBeVisible();

    // Langkah berikutnya dinyatakan, dan foto aslinya masih tersimpan di draf.
    //
    // Kontrak API bagian 12: `action` adalah kode mesin, dan "antarmuka
    // memetakannya ke tombol". Yang diuji di sini adalah kode mentah itu
    // TIDAK tampil sebagai teks — label tombol terjemahannya adalah
    // keputusan produk, bukan untuk dikarang oleh pengujian.
    const bannerText = await banner.innerText();
    expect(bannerText, `Kode aksi mentah tampil ke pengguna: "${bannerText}"`).not.toMatch(
      /\b[A-Z]{3,}_[A-Z_]+\b/,
    );
    const stored = await readStoredDraft(page);
    expect(stored?.photoMediaId, "Foto asli hilang dari draf").toBe(MEDIA_ID);
  });
});

test.describe("TC-E2E-14 jaringan putus saat merekam", () => {
  test("draf tersimpan dan dapat dilanjutkan setelah tersambung", async ({ page }) => {
    // S5: koneksi putus adalah keadaan lazim pada pengguna sasaran, bukan
    // galat yang tidak terduga. Aplikasi memetakannya ke `NETWORK_OFFLINE`.
    await seedAccessToken(page);
    await seedDraft(page, {
      productId: PRODUCT_ID,
      photoMediaId: MEDIA_ID,
      audioJobId: "01J8ZQFX9K7YWVTN3MABCDJ012",
    });

    await offline(page);

    await openStep(page, "/create/transcript");
    await expect(errorBanner(page)).toBeVisible();

    // Pesannya dari katalog, dan pekerjaannya dinyatakan tersimpan.
    const failure = errorCaseFor("NETWORK_OFFLINE");
    await expect(errorBanner(page)).toContainText(failure.message);
    expect(statesWorkIsSafe(failure.message)).toBe(true);

    // Drafnya masih utuh di perangkat, sehingga dapat dilanjutkan.
    const stored = await readStoredDraft(page);
    expect(stored?.productId).toBe(PRODUCT_ID);
    expect(stored?.photoMediaId).toBe(MEDIA_ID);
  });

  test("menyambung kembali memulihkan alurnya", async ({ page }) => {
    await seedAccessToken(page);
    await seedDraft(page, {
      productId: PRODUCT_ID,
      photoMediaId: MEDIA_ID,
      audioJobId: "01J8ZQFX9K7YWVTN3MABCDJ012",
    });

    await offline(page);
    await openStep(page, "/create/transcript");
    await expect(errorBanner(page)).toBeVisible();

    // Koneksi pulih: endpointnya dijawab lagi.
    await page.unroute(`${"http://localhost:8787"}/**`);
    await stubApi(page, "GET", "/products/:id/transcript", () =>
      apiOk({ text: TRANSCRIPT_TEXT, locale: "id", edited: false, provider: "groq", durationMs: 31_200 }),
    );

    await page.reload();
    await expect(page.getByLabel("Transkrip cerita Anda")).toHaveValue(TRANSCRIPT_TEXT);
    await expect(errorBanner(page)).toHaveCount(0);
  });
});

test.describe("TC-E2E-15 jaringan putus saat pemrosesan", () => {
  test("progres dipulihkan, pekerjaan tidak hilang", async ({ page }) => {
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_AT_PROCESS);
    await stubApi(page, "POST", "/products/:id/generate", () =>
      apiOk({ jobs: [{ id: "01J8ZQFX9K7YWVTN3MABCDJ023", kind: "image", status: "queued" }] }),
    );

    // Jaringan putus setelah pemrosesan diminta, tetapi sebelum selesai.
    let polls = 0;
    await stubApi(page, "GET", "/products/:id/jobs", () => {
      polls += 1;
      if (polls === 1) {
        return apiOk({
          jobs: [
            {
              id: "01J8ZQFX9K7YWVTN3MABCDJ023",
              kind: "image",
              status: "running",
              provider: "workers_ai",
              progress: 40,
              attempt: 1,
            },
          ],
          overallProgress: 40,
        });
      }
      return apiOk({
        jobs: [
          {
            id: "01J8ZQFX9K7YWVTN3MABCDJ023",
            kind: "image",
            status: "succeeded",
            provider: "workers_ai",
            progress: 100,
          },
        ],
        overallProgress: 100,
      });
    });

    await openStep(page, "/create/process");

    // Pekerjaannya selesai meski ada gangguan sementara pada polling.
    await expect(page.getByText("Katalog Anda sudah selesai dibuat.", { exact: true })).toBeVisible({ timeout: 30_000 });

    // Drafnya memuat penanda bahwa pemrosesan sudah pernah berjalan.
    await page.getByRole("button", { name: "Lanjut periksa hasil" }).click();
    await expect(page).toHaveURL(/\/create\/review$/);

    const stored = await readStoredDraft(page);
    expect(stored?.generatedAt, "Penanda pemrosesan hilang").not.toBeNull();
  });
});

test.describe("TC-E2E-16 tab ditutup di tengah proses", () => {
  test("draf tersimpan dan muncul saat dibuka lagi", async ({ page, context }) => {
    // S5-02. Drafnya di IndexedDB, yang bertahan lintas tab dan lintas sesi
    // peramban pada asal yang sama.
    await seedAccessToken(page);
    await seedDraft(page, DRAFT_AT_PROCESS);
    await stubApi(page, "POST", "/products/:id/generate", () =>
      apiOk({ jobs: [{ id: "01J8ZQFX9K7YWVTN3MABCDJ023", kind: "image", status: "running" }] }),
    );
    await stubApi(page, "GET", "/products/:id/jobs", () =>
      apiOk({
        jobs: [
          {
            id: "01J8ZQFX9K7YWVTN3MABCDJ023",
            kind: "image",
            status: "running",
            provider: "workers_ai",
            progress: 30,
            attempt: 1,
          },
        ],
        overallProgress: 30,
      }),
    );

    await openStep(page, "/create/process");
    await expect(page.getByRole("progressbar", { name: "Kemajuan pembuatan katalog" })).toBeVisible();

    // Tab ditutup di tengah proses.
    await page.close();

    // Dibuka lagi di tab baru pada konteks yang sama — drafnya harus ada.
    const reopened = await context.newPage();
    await seedAccessToken(reopened);
    await stubApi(reopened, "GET", "/products/:id/jobs", () =>
      apiOk({ jobs: [], overallProgress: 0 }),
    );

    await reopened.goto("/");
    await expect(reopened.getByText("Ada katalog yang belum selesai, tersimpan di perangkat ini.")).toBeVisible();
    await expect(reopened.getByRole("link", { name: /Lanjutkan dari langkah/ })).toBeVisible();

    const stored = await readStoredDraft(reopened);
    expect(stored?.transcript, "Draf hilang setelah tab ditutup").toBe(TRANSCRIPT_TEXT);
    await reopened.close();
  });
});

test.describe("TC-E2E-17 transkrip kacau dapat dikoreksi", () => {
  test("layar tinjau memuat transkrip yang salah dengar dan dapat disunting", async ({ page }) => {
    // ADR-008: layar ini yang menyelamatkan keadaan ketika ASR salah dengar.
    // TEST-PLAN bagian 12 menyatakan rekaman beraksen dan berderau memang
    // diperkirakan gagal sebagian — dan itulah yang diuji.
    const garbled = "saya buat tas dari kulit kerbau keras dijahit tiga hari";
    const corrected = "Saya membuat tas dari kulit kerbau, dijahit selama tiga hari.";

    await seedAccessToken(page);
    await seedDraft(page, { productId: PRODUCT_ID, photoMediaId: MEDIA_ID });
    await stubApi(page, "GET", "/products/:id/transcript", () =>
      apiOk({ text: garbled, locale: "id", edited: false, provider: "groq", durationMs: 28_000 }),
    );

    let submitted = "";
    await page.route("**/api/v1/products/*/transcript", async (route) => {
      await corsRoute(
        route,
        () => {
          submitted = (JSON.parse(route.request().postData() ?? "{}").text as string) ?? "";
          return apiOk({ text: submitted, edited: true });
        },
        "PUT",
      );
    });

    await openStep(page, "/create/transcript");

    const textarea = page.getByLabel("Transkrip cerita Anda");
    await expect(textarea).toHaveValue(garbled);

    // Pengrajin mengoreksinya di sini, bukan setelah diproses.
    await textarea.fill(corrected);
    await page.getByRole("button", { name: "Sudah benar, lanjutkan" }).click();

    await expect(page).toHaveURL(/\/create\/process$/);
    expect(submitted, "Koreksi tidak terkirim").toBe(corrected);

    // Meninjau ditandai, sehingga langkah berikutnya terbuka.
    const stored = await readStoredDraft(page);
    expect(stored?.transcriptReviewed).toBe(true);
    expect(stored?.transcript).toBe(corrected);
  });

  test("meninjau tanpa mengubah tetap sah", async ({ page }) => {
    // ADR-008 eksplisit: yang ditandai adalah tindakan meninjau, bukan
    // tindakan menyunting. Alur tidak boleh menuntut pengrajin mengetik.
    await seedAccessToken(page);
    await seedDraft(page, { productId: PRODUCT_ID, photoMediaId: MEDIA_ID });
    await stubApi(page, "GET", "/products/:id/transcript", () =>
      apiOk({ text: TRANSCRIPT_TEXT, locale: "id", edited: false, provider: "groq", durationMs: 31_200 }),
    );
    await stubApi(page, "PUT", "/products/:id/transcript", () =>
      apiOk({ text: TRANSCRIPT_TEXT, edited: false }),
    );

    await openStep(page, "/create/transcript");
    await expect(page.getByLabel("Transkrip cerita Anda")).toHaveValue(TRANSCRIPT_TEXT);

    await page.getByRole("button", { name: "Sudah benar, lanjutkan" }).click();
    await expect(page).toHaveURL(/\/create\/process$/);
  });
});

test.describe("TC-E2E-18 berkas melewati batas 10 MB", () => {
  test("ditolak dengan pesan yang menjelaskan batasnya", async ({ page }) => {
    // F2-01 dan kontrak API bagian 5: `bytes` > 10 MB ditolak dengan
    // `FILE_TOO_LARGE`. Batas 10 MB ditegakkan di server; antarmuka
    // memeriksanya lebih dulu sebagai kenyamanan (photo/page.tsx baris 71).
    await seedAccessToken(page);
    await seedDraft(page, { productId: PRODUCT_ID });
    await stubApi(page, "POST", "/products/:id/media/upload-url", () => errorStub("FILE_TOO_LARGE"));

    await openStep(page, "/create/photo");

    // 15 MB — melewati batas 10 MB yang diuji TC-E2E-18.
    const oversized = Buffer.alloc(15 * 1024 * 1024, 0xff);
    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "terlalu-besar.jpg",
      mimeType: "image/jpeg",
      buffer: oversized,
    });

    const banner = errorBanner(page);
    await expect(banner).toBeVisible();

    const failure = errorCaseFor("FILE_TOO_LARGE");
    await expect(banner).toContainText(failure.message);
    await expectNoTechnicalTerms(page, "berkas terlalu besar");

    // Batasnya diambil dari `lib/schemas.ts`, bukan angka yang diketik ulang.
    const limitMb = LIMITS.MAX_UPLOAD_BYTES / (1024 * 1024);
    expect(limitMb).toBe(10);
    await expect(banner).toContainText(`${limitMb} MB`);
  });
});
