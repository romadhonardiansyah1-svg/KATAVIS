/**
 * Pemeriksaan anti-slop pada pesan galat.
 *
 *   TC-E2E-20  Tidak ada "Error", "Failed", "500", "null", "undefined" yang terlihat pengguna
 *   TC-E2E-21  Setiap pesan galat memuat langkah berikutnya
 *   TC-E2E-22  Setiap pesan galat menyatakan apakah pekerjaan pengguna aman
 *
 * Ketiganya menegakkan `Fitur pendukung.pdf` halaman 6-7 secara otomatis,
 * bukan lewat tinjauan manual yang bisa terlewat.
 *
 * Kode, pesan, dan `action` diambil dari `e2e/support/catalog.ts`, yang
 * merupakan salinan `lib/errors.ts` — cerminan kontrak API bagian 12. Tabel
 * itu **seluruh barisnya** `workSafe: true`, dan TC-E2E-22 memeriksa bahwa
 * janji itu benar-benar sampai ke layar.
 *
 * ==== Cara memicunya ====
 *
 * Setiap kode galat dipetakan ke endpoint yang benar-benar memicunya, dan ke
 * layar yang benar-benar memanggil endpoint itu. Galat yang kode-nya ada di
 * katalog tetapi belum punya layar pemicu **tidak** ditandai `skip` diam-diam:
 * ia dicatat di daftar `NO_TRIGGER` beserta alasannya, dan jumlahnya
 * diperiksa — sehingga kode galat baru yang ditambahkan tanpa layar pemicu
 * akan terlihat, bukan tersembunyi.
 */

import { expect, test, type Page } from "@playwright/test";

import { ERROR_CASES } from "./support/catalog";
import {
  MEDIA_ID,
  PRODUCT_ID,
  TRANSCRIPT_TEXT,
  apiOk,
  openStep,
  seedAccessToken,
  seedDraft,
  stubApi,
} from "./support/flow";
import { errorBanner, expectNoTechnicalTerms, statesWorkIsSafe, tellsNextStep } from "./support/errors";

/**
 * Kode galat yang belum punya layar pemicu di antarmuka.
 *
 * Alasannya dicatat satu per satu. Ini daftar tertutup: menambah kode galat
 * baru tanpa layar pemicu menuntut menambahkannya di sini, dan itu terlihat
 * saat peninjauan.
 */
const NO_TRIGGER: Readonly<Record<string, string>> = {
  UNAUTHENTICATED:
    "Layar masuk belum ada (lib/session.ts baris 4). Galat ini muncul di alur sungguhan saat token kedaluwarsa, dan tidak dapat dipicu dari antarmuka sekarang.",
  ACCOUNT_LOCKED: "Layar OTP belum ada; penguncian setelah lima percobaan salah.",
  RATE_LIMITED:
    "Batas laju berlaku di endpoint OTP dan ASR. Belum ada layar yang menampilkan galat ini kepada pengrajin.",
  NOT_FOUND:
    "Dipetakan ke halaman 404 Next.js, bukan ke banner StepShell — pesannya milik peramban, bukan milik katalog galat.",
  INVITE_EXPIRED: "Layar 'Pendamping saya' belum ada (lihat caregiver.spec.ts).",
  INVITE_ALREADY_USED: "Layar 'Pendamping saya' belum ada (lihat caregiver.spec.ts).",
  NETWORK_OFFLINE:
    "Dipicu dengan memutus jaringan sungguhan, bukan dengan jawaban sadapan. Diuji di fallback.spec.ts (TC-E2E-14).",
};

/**
 * Membuka layar tempat galat muncul, dan memicunya.
 *
 * `trigger` melakukan aksi yang memicu permintaan; `openScreen` hanya
 * menyiapkan halamannya. Dipisah karena sebagian layar memanggil endpointnya
 * sendiri saat dipasang (layar transkrip), dan sebagian menunggu tekanan
 * tombol (layar proses dan terbit).
 */
interface Trigger {
  readonly path: string;
  readonly method: string;
  readonly endpoint: string;
  readonly openScreen: (page: Page) => Promise<void>;
  readonly trigger: (page: Page) => Promise<void>;
}

/** Draf yang membuka langkah 4 — tempat pemrosesan diminta. */
const DRAFT_AT_PROCESS = {
  productId: PRODUCT_ID,
  photoMediaId: MEDIA_ID,
  transcript: TRANSCRIPT_TEXT,
  transcriptReviewed: true,
} as const;

/** Draf yang membuka langkah 6 — tempat penerbitan diminta. */
const DRAFT_AT_PUBLISH = {
  ...DRAFT_AT_PROCESS,
  generatedAt: 1_700_000_000_000,
  contentReviewedAt: 1_700_000_100_000,
} as const;

function triggerFor(code: string): Trigger | null {
  // --- Layar transkrip (langkah 3) ---
  // Endpointnya dipanggil saat halaman dipasang, jadi memuat ulang dengan
  // jawaban galat sudah cukup untuk memunculkannya.
  if (
    ["ASR_NO_SPEECH", "ASR_TOO_SHORT", "ASR_TOO_LONG", "TRANSCRIPT_NOT_REVIEWED"].includes(code)
  ) {
    return {
      path: "/create/transcript",
      method: "GET",
      endpoint: "/products/:id/transcript",
      openScreen: async (page) => {
        await seedAccessToken(page);
        await seedDraft(page, { productId: PRODUCT_ID, photoMediaId: MEDIA_ID });
        await openStep(page, "/create/transcript");
      },
      trigger: async () => undefined,
    };
  }

  // --- Layar proses (langkah 4) ---
  // Ketiga galat pemrosesan muncul dari jawaban `POST /generate`.
  if (["IMAGE_GENERATE_FAILED", "COPY_GENERATE_FAILED", "QUOTA_EXCEEDED", "MAX_RETRIES_EXCEEDED"].includes(code)) {
    return {
      path: "/create/process",
      method: "POST",
      endpoint: "/products/:id/generate",
      openScreen: async (page) => {
        await seedAccessToken(page);
        await seedDraft(page, DRAFT_AT_PROCESS);
        await stubApi(page, "GET", "/products/:id/jobs", () =>
          apiOk({ jobs: [], overallProgress: 0 }),
        );
        await openStep(page, "/create/process");
      },
      trigger: async () => undefined,
    };
  }

  // --- Layar terbit (langkah 6) ---
  if (["CONSENT_REQUIRED", "CONTENT_INCOMPLETE", "PHOTO_REQUIRED"].includes(code)) {
    return {
      path: "/create/publish",
      method: "POST",
      endpoint: "/products/:id/publish",
      openScreen: async (page) => {
        await seedAccessToken(page);
        await seedDraft(page, DRAFT_AT_PUBLISH);
        await stubApi(page, "GET", "/products/:id", () =>
          apiOk({ content: {}, media: [] }),
        );
        // Persetujuan diberikan lebih dulu, sehingga yang gagal adalah
        // penerbitannya — bukan penjagaan kotak centangnya.
        await stubApi(page, "POST", "/consent", () => apiOk({ kind: "publication", granted: true }));
        await openStep(page, "/create/publish");
        await page.getByLabel("Saya setuju katalog ini dilihat pembeli").check();
      },
      trigger: async (page) => {
        await page.getByRole("button", { name: "Terbitkan katalog" }).click();
      },
    };
  }

  // --- Layar foto (langkah 1) ---
  if (["FILE_TOO_LARGE", "UNSUPPORTED_FORMAT", "CONTENT_MISMATCH"].includes(code)) {
    return {
      path: "/create/photo",
      method: "POST",
      endpoint: "/products/:id/media/upload-url",
      openScreen: async (page) => {
        await seedAccessToken(page);
        await seedDraft(page, { productId: PRODUCT_ID });
        await openStep(page, "/create/photo");
      },
      trigger: async (page) => {
        await page.getByLabel("Pilih foto produk").setInputFiles({
          name: "produk.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
        });
      },
    };
  }

  // --- Galat izin dan gangguan umum ---
  // FORBIDDEN muncul pada percobaan menyunting; INTERNAL_ERROR pada percobaan
  // memuat produk. Keduanya dipicu dari layar periksa hasil.
  if (["FORBIDDEN", "INTERNAL_ERROR"].includes(code)) {
    return {
      path: "/create/review",
      method: "GET",
      endpoint: "/products/:id",
      openScreen: async (page) => {
        await seedAccessToken(page);
        await seedDraft(page, { ...DRAFT_AT_PROCESS, generatedAt: 1_700_000_000_000 });
        await openStep(page, "/create/review");
      },
      trigger: async () => undefined,
    };
  }

  return null;
}

function errorEnvelope(code: string) {
  const errorCase = ERROR_CASES.find((candidate) => candidate.code === code);
  if (errorCase === undefined) throw new Error(`Kode tidak ada di katalog: ${code}`);

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

const CODES_WITH_TRIGGER = ERROR_CASES.filter((errorCase) => triggerFor(errorCase.code) !== null);

test.describe("TC-E2E-20 pesan galat tanpa istilah teknis", () => {
  for (const errorCase of CODES_WITH_TRIGGER) {
    test(`${errorCase.code} tidak menampilkan istilah teknis`, async ({ page }) => {
      const trigger = triggerFor(errorCase.code);
      if (trigger === null) return;

      await stubApi(page, trigger.method, trigger.endpoint, () => errorEnvelope(errorCase.code));
      await trigger.openScreen(page);
      await trigger.trigger(page);

      const banner = errorBanner(page);
      await expect(banner, `Pesan galat ${errorCase.code} tidak muncul`).toBeVisible();

      // Diperiksa pada seluruh layar, bukan hanya pada bannernya: istilah
      // teknis dapat bocor lewat daftar tahap atau baris status.
      await expectNoTechnicalTerms(page, errorCase.code);
    });
  }
});

test.describe("TC-E2E-21 pesan galat memuat langkah berikutnya", () => {
  for (const errorCase of CODES_WITH_TRIGGER) {
    test(`${errorCase.code} menyebut apa yang harus dilakukan`, async ({ page }) => {
      const trigger = triggerFor(errorCase.code);
      if (trigger === null) return;

      await stubApi(page, trigger.method, trigger.endpoint, () => errorEnvelope(errorCase.code));
      await trigger.openScreen(page);
      await trigger.trigger(page);

      const banner = errorBanner(page);
      await expect(banner).toBeVisible();

      const shown = await banner.innerText();
      expect(
        tellsNextStep(shown),
        `${errorCase.code}: pesan tidak memuat langkah berikutnya — "${shown}"`,
      ).toBe(true);
    });
  }
});

test.describe("TC-E2E-22 pesan galat menyatakan pekerjaan aman", () => {
  for (const errorCase of CODES_WITH_TRIGGER) {
    test(`${errorCase.code} menyatakan pekerjaan pengguna aman`, async ({ page }) => {
      const trigger = triggerFor(errorCase.code);
      if (trigger === null) return;

      await stubApi(page, trigger.method, trigger.endpoint, () => errorEnvelope(errorCase.code));
      await trigger.openScreen(page);
      await trigger.trigger(page);

      const banner = errorBanner(page);
      await expect(banner).toBeVisible();

      const shown = await banner.innerText();
      expect(
        statesWorkIsSafe(shown),
        `${errorCase.code}: pesan tidak menyatakan pekerjaan aman — "${shown}"`,
      ).toBe(true);
    });
  }
});

test.describe("TC-E2E-20 cakupan katalog galat", () => {
  test("setiap kode galat punya layar pemicu atau alasan yang tercatat", async () => {
    // Menjaga agar kasus uji tidak menghilang diam-diam: kode galat yang
    // ditambahkan di `lib/errors.ts` tanpa layar pemicu muncul di sini
    // sebagai selisih, bukan sebagai kasus uji yang tidak pernah berjalan.
    const withoutTrigger = ERROR_CASES.map((errorCase) => errorCase.code).filter(
      (code) => triggerFor(code) === null,
    );

    const unexplained = withoutTrigger.filter((code) => !(code in NO_TRIGGER));

    expect(
      unexplained,
      `Kode galat berikut tidak punya layar pemicu dan tidak dijelaskan di NO_TRIGGER: ${unexplained.join(", ")}`,
    ).toEqual([]);

    // Dan sebaliknya: penjelasan untuk kode yang sudah punya pemicu adalah
    // sisa yang membingungkan.
    const stale = Object.keys(NO_TRIGGER).filter((code) => triggerFor(code) !== null);
    expect(stale, `Penjelasan NO_TRIGGER sudah tidak berlaku: ${stale.join(", ")}`).toEqual([]);
  });

  test("seluruh pesan katalog memenuhi ketiga syarat", async () => {
    // Pemeriksaan katalognya sendiri, tanpa peramban. Ketiga syarat S5-03,
    // S5-04, dan S5-05 berlaku untuk **setiap** baris, bukan hanya untuk
    // baris yang kebetulan punya layar pemicu.
    for (const errorCase of ERROR_CASES) {
      expect(errorCase.message.length, `${errorCase.code} tanpa pesan`).toBeGreaterThan(0);
      expect(errorCase.action.length, `${errorCase.code} tanpa action`).toBeGreaterThan(0);
      expect(errorCase.status, `${errorCase.code} tanpa status HTTP`).toBeGreaterThanOrEqual(400);

      expect(
        statesWorkIsSafe(errorCase.message),
        `${errorCase.code}: pesan tidak menyatakan pekerjaan aman — "${errorCase.message}"`,
      ).toBe(true);

      expect(
        tellsNextStep(errorCase.message),
        `${errorCase.code}: pesan tidak memuat langkah berikutnya — "${errorCase.message}"`,
      ).toBe(true);
    }
  });
});
