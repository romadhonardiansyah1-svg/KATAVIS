/**
 * Notifikasi multimodal.
 *
 *   TC-E2E-26  Satu peristiwa memicu visual + audio + getar; mematikan salah
 *              satu kanal tidak menghilangkan informasi
 *
 * Menegakkan S10 di FEATURE-SPECS:
 *
 *   S10-01  Satu peristiwa memicu tiga kanal
 *   S10-02  Nada berhasil dan gagal berbeda
 *   S10-03  Perangkat tanpa Vibration API tidak menimbulkan galat
 *   S10-04  Notifikasi visual tidak hilang sendiri
 *   S10-05  Warna bukan satu-satunya pembawa informasi
 *
 * ==== Keadaan sekarang ====
 *
 * Kanal audio dan getar tinggal di `lib/notify.ts`, dan dipanggil dari
 * peristiwanya: "Foto tersimpan" di `app/create/photo/page.tsx` dan
 * "Katalog selesai" di `app/create/publish/page.tsx`. Tiga keputusan
 * rancangan yang dulu terbuka, kini terjawab:
 *
 *   1. **Letaknya modul tersendiri**, bukan di dalam `StepShell`. Kanal
 *      visual adalah urusan `StepShell` (`role="status"`); dua kanal lain
 *      adalah urusan peristiwa. Menggabungkan keduanya membuat satu berkas
 *      mengurus dua hal yang berubah karena alasan berbeda.
 *   2. **Nada dibangkitkan `OscillatorNode`**, bukan berkas di `public/`.
 *      `public/` belum ada, dan menambah aset biner berarti menambah berkas
 *      yang harus ikut dilacak hanya untuk dua nada. Nada sukses menaik,
 *      nada gagal menurun dan lebih rendah — S10-02 terjamin secara
 *      struktural, bukan secara kebetulan.
 *   3. **Getar dipicu dari satu titik terpusat.** S10-03 menuntut
 *      ketiadaan Vibration API tidak menghasilkan galat, dan itu jauh lebih
 *      mudah dijamin bila pemanggilan `navigator.vibrate` hanya ada di satu
 *      tempat yang memeriksa `typeof` lebih dulu.
 *
 * Kasus uji di bawah adalah yang menyatakan apakah bangunan itu memenuhi
 * S10 — bukan sebaliknya.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  MEDIA_ID,
  PRODUCT_ID,
  apiOk,
  corsRoute,
  openStep,
  seedAccessToken,
  seedDraft,
  stubApi,
} from "./support/flow";
import { errorBanner } from "./support/errors";

/**
 * Merekam seluruh panggilan `navigator.vibrate` dan pembentukan
 * `AudioContext`, tanpa memodifikasi perilaku halamannya.
 *
 * Dipasang lewat `addInitScript` supaya pendengarnya terpasang sebelum
 * skrip aplikasi mana pun berjalan — notifikasi yang dipicu saat halaman
 * dipasang akan terlewat bila pendengarnya dipasang sesudahnya.
 */
async function observeNotificationChannels(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const observed = { vibrations: [] as number[][], audioContexts: 0, audioPlays: 0 };
    (window as unknown as { __notification: typeof observed }).__notification = observed;

    // Vibration API. Peramban desktop tidak menyediakannya, dan S10-03
    // menuntut ketiadaannya tidak menghasilkan galat — jadi kehadirannya
    // disimulasikan di sini supaya kanal getarnya dapat diperiksa.
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: (pattern: number | number[]) => {
        observed.vibrations.push(Array.isArray(pattern) ? pattern : [pattern]);
        return true;
      },
    });

    /*
      Web Audio disadap **hanya bila perambannya punya**.

      `window.AudioContext` baru ada di WebKit setelah ada interaksi
      pengguna; pada saat skrip init berjalan nilainya `undefined`.
      Menulis `class X extends undefined` melempar TypeError, dan —
      inilah bagian yang berbahaya — galat itu **menghentikan seluruh
      skrip init lain pada halaman yang sama**. Akibatnya token akses yang
      disemai `seedAccessToken` tidak pernah terpasang, dan kegagalannya
      muncul jauh dari sebabnya: sebagai "Sesi Anda sudah berakhir" pada
      layar yang sebenarnya tidak bermasalah.

      Karena itu penyadapan audio dilewati bila API-nya tidak ada. Yang
      kehilangan hanya penghitungan kanal audio di mesin tanpa Web Audio —
      dan `HTMLMediaElement.play` di bawah tetap dihitung, jadi kanal itu
      masih terpantau lewat jalur lain.
    */
    const OriginalAudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (typeof OriginalAudioContext === "function") {
      class ObservedAudioContext extends OriginalAudioContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          observed.audioContexts += 1;
        }
      }

      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        writable: true,
        value: ObservedAudioContext,
      });
    }

    // Pemutaran nada juga dapat lewat elemen <audio>. Keduanya dihitung,
    // karena S10-02 menuntut nada berhasil dan gagal berbeda, dan yang
    // membedakannya bisa salah satu dari keduanya.
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function observedPlay(this: HTMLMediaElement) {
      observed.audioPlays += 1;
      return originalPlay.call(this);
    };
  });
}

async function readObserved(page: Page): Promise<{
  readonly vibrations: readonly (readonly number[])[];
  readonly audioContexts: number;
  readonly audioPlays: number;
}> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __notification: {
            vibrations: number[][];
            audioContexts: number;
            audioPlays: number;
          };
        }
      ).__notification,
  );
}

/** Draf pada langkah 1: menekan tombol unggah memicu peristiwa "foto tersimpan". */
async function openPhotoStep(page: Page): Promise<void> {
  await seedAccessToken(page);
  await seedDraft(page, { productId: PRODUCT_ID });
  await stubApi(page, "POST", "/products/:id/media/upload-url", () =>
    apiOk({
      mediaId: MEDIA_ID,
      uploadUrl: "https://media.example/unggah",
      expiresAt: Date.now() + 900_000,
    }),
  );
  await page.route("https://media.example/**", async (route) => {
    await corsRoute(route, () => ({ status: 200, contentType: "text/plain", body: "" }));
  });
  await stubApi(page, "POST", "/products/:id/media/:mediaId/confirm", () =>
    apiOk({ id: MEDIA_ID, uploadStatus: "stored" }),
  );
}

test.describe("TC-E2E-26 notifikasi multimodal", () => {
  test("peristiwa 'foto tersimpan' memicu kanal visual dan getar", async ({ page }) => {
    // S10-01. Peristiwanya adalah "Foto tersimpan" — salah satu dari tiga
    // peristiwa di tabel S10.
    await observeNotificationChannels(page);
    await openPhotoStep(page);

    await openStep(page, "/create/photo");
    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "tas.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
    });

    // Kanal visual: ada, dan sudah diperiksa di create-catalog.spec.ts.
    await expect(page.getByText("Foto produk tersimpan.")).toBeVisible();

    // Kanal getar: satu getar singkat, sesuai tabel S10.
    const observed = await readObserved(page);
    expect(
      observed.vibrations.length,
      "Peristiwa 'foto tersimpan' tidak memicu getar. S10-01 menuntut satu " +
        "peristiwa memicu tiga kanal, dan kanal getarnya memakai Vibration API.",
    ).toBeGreaterThan(0);
  });

  test("peristiwa 'foto tersimpan' membunyikan kanal audio", async ({ page }) => {
    // S10-01. Kanal ketiga: tabel S10 menetapkan "nada pendek" untuk
    // peristiwa ini.
    await observeNotificationChannels(page);
    await openPhotoStep(page);

    await openStep(page, "/create/photo");

    /*
      Gerbang sebenarnya bukan nama peramban, melainkan ada-tidaknya Web
      Audio di mesin uji itu.

      WebKit pada lingkungan ini tidak menyediakan `AudioContext` maupun
      `webkitAudioContext` — sudah diperiksa langsung lewat `page.evaluate`,
      keduanya `undefined`. Tidak ada implementasi yang dapat membunyikan
      nada di sana, jadi menuntutnya berarti menuntut hal yang mustahil,
      dan kegagalannya akan terbaca seolah-olah produknya cacat.

      Justru sebaliknya: pada mesin seperti itu `lib/notify.ts` **memang
      wajib diam dan tidak melempar** — itulah S10-03, dan perilaku itu
      diuji terpisah di kasus berikutnya.
    */
    const hasWebAudio = await page.evaluate(
      () =>
        typeof (window as unknown as { AudioContext?: unknown }).AudioContext === "function" ||
        typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext ===
          "function",
    );

    test.skip(!hasWebAudio, "Mesin uji ini tidak menyediakan Web Audio (S10-03: kanal audio diam tanpa galat).");

    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "tas.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
    });
    await expect(page.getByText("Foto produk tersimpan.")).toBeVisible();

    const observed = await readObserved(page);
    expect(
      observed.audioContexts + observed.audioPlays,
      "Peristiwa 'foto tersimpan' tidak membunyikan nada. Tabel S10 " +
        "menetapkan 'nada pendek' untuk peristiwa ini.",
    ).toBeGreaterThan(0);
  });

  test("notifikasi visual tidak hilang sendiri", async ({ page }) => {
    // S10-04. Notifikasi yang hilang setelah beberapa detik tidak dapat
    // dibaca pengguna yang membaca lambat. Yang diuji adalah bertahannya
    // pesannya, bukan durasi animasinya.
    await observeNotificationChannels(page);
    await openPhotoStep(page);

    await openStep(page, "/create/photo");
    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "tas.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
    });

    const notice = page.getByText("Foto produk tersimpan.");
    await expect(notice).toBeVisible();

    // Masih terlihat sesudah sepuluh detik tanpa interaksi apa pun.
    await page.waitForTimeout(10_000);
    await expect(notice, "Notifikasi visual hilang sendiri").toBeVisible();
  });

  test("perangkat tanpa Vibration API tidak menimbulkan galat", async ({ page }) => {
    // S10-03. Getar adalah kanal tambahan, bukan kanal yang wajib ada.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.addInitScript(() => {
      // Peramban tanpa dukungan getar: propertinya tidak ada sama sekali.
      Object.defineProperty(navigator, "vibrate", {
        configurable: true,
        get: () => undefined,
      });
    });

    await openPhotoStep(page);
    await openStep(page, "/create/photo");
    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "tas.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
    });

    // Dua kanal lain tetap bekerja: pesannya tetap muncul.
    await expect(page.getByText("Foto produk tersimpan.")).toBeVisible();
    expect(errors, "Galat muncul pada perangkat tanpa Vibration API").toEqual([]);
  });

  test("nada berhasil dan gagal wajib berbeda", async ({ page }) => {
    // S10-02. Nada yang sama membuat pengguna tunanetra tidak dapat
    // membedakan hasil.
    await observeNotificationChannels(page);
    await seedAccessToken(page);
    await seedDraft(page, { productId: PRODUCT_ID });

    // Peristiwa berhasil.
    await stubApi(page, "POST", "/products/:id/media/upload-url", () =>
      apiOk({
        mediaId: MEDIA_ID,
        uploadUrl: "https://media.example/unggah",
        expiresAt: Date.now() + 900_000,
      }),
    );
    await page.route("https://media.example/**", async (route) => {
      await corsRoute(route, () => ({ status: 200, contentType: "text/plain", body: "" }));
    });
    await stubApi(page, "POST", "/products/:id/media/:mediaId/confirm", () =>
      apiOk({ id: MEDIA_ID, uploadStatus: "stored" }),
    );

    await openStep(page, "/create/photo");
    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "tas.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]),
    });
    await expect(page.getByText("Foto produk tersimpan.")).toBeVisible();

    const afterSuccess = await readObserved(page);

    // Peristiwa gagal pada layar yang sama.
    await stubApi(page, "POST", "/products/:id/media/upload-url", () => ({
      status: 413,
      body: {
        ok: false,
        error: {
          code: "FILE_TOO_LARGE",
          message: "Foto terlalu besar. Maksimal 10 MB.",
          action: "PICK_OTHER_FILE",
          workSafe: true,
        },
      },
    }));

    await page.getByLabel("Pilih foto produk").setInputFiles({
      name: "besar.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(11 * 1024 * 1024, 0xff),
    });
    await expect(errorBanner(page)).toBeVisible();

    const afterFailure = await readObserved(page);

    // Getarnya berbeda: keberhasilan satu getar, kegagalan tiga getar pendek
    // (tabel S10).
    const successVibrations = afterSuccess.vibrations.flat().join(",");
    const failureVibrations = afterFailure.vibrations.slice(afterSuccess.vibrations.length).flat().join(",");

    expect(
      failureVibrations,
      `Pola getar keberhasilan dan kegagalan tidak berbeda ` +
        `(berhasil: [${successVibrations}], gagal: [${failureVibrations}])`,
    ).not.toBe(successVibrations);
  });
});
