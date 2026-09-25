/**
 * Uji aksesibilitas otomatis — TC-A11Y-01 sampai TC-A11Y-12.
 *
 * Dijalankan dengan: pnpm run test:e2e:a11y
 *
 * Batas jujurnya dinyatakan di TEST-PLAN bagian 6: axe-core menangkap
 * sekitar sepertiga masalah aksesibilitas. Ia tidak dapat menilai apakah
 * teks alternatif bermakna, apakah urutan fokus masuk akal, atau apakah
 * bahasanya cukup sederhana bagi pengguna kognitif. Klaim yang boleh
 * dinyatakan karena itu berbunyi "0 pelanggaran axe-core serius, ditambah
 * verifikasi manual dengan NVDA dan TalkBack" — bukan "sepenuhnya
 * aksesibel".
 *
 * Halaman alur membaca drafnya dari IndexedDB, bukan dari server. Karena
 * itu setiap rute disemai lebih dulu, sehingga yang diuji adalah tampilan
 * yang sesungguhnya, bukan layar "Memuat..." yang kebetulan kosong dan
 * karena itu tidak punya pelanggaran apa pun.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { TRANSCRIPT_TEXT, apiOk, seedAccessToken, stubApi } from "./support/flow";

interface DraftSeed {
  readonly productId?: string | null;
  readonly photoMediaId?: string | null;
  readonly transcript?: string;
  readonly transcriptReviewed?: boolean;
  readonly generatedAt?: number | null;
  readonly contentReviewedAt?: number | null;
}

const EMPTY_DRAFT = {
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

/** Rute dan syarat draf yang membuatnya benar-benar tampil. */
const ROUTES: readonly { readonly path: string; readonly seed: DraftSeed }[] = [
  { path: "/", seed: {} },
  { path: "/create/photo", seed: {} },
  { path: "/create/record", seed: { productId: "01J8ZQFX9K7YWVTN3MABCDP001" } },
  {
    path: "/create/transcript",
    seed: {
      productId: "01J8ZQFX9K7YWVTN3MABCDP001",
      photoMediaId: "01J8ZQFX9K7YWVTN3MABCDM001",
    },
  },
  {
    path: "/create/process",
    seed: {
      productId: "01J8ZQFX9K7YWVTN3MABCDP001",
      photoMediaId: "01J8ZQFX9K7YWVTN3MABCDM001",
      transcript: "Saya membuat tas dari kulit kerbau.",
      transcriptReviewed: true,
    },
  },
  {
    path: "/create/review",
    seed: {
      productId: "01J8ZQFX9K7YWVTN3MABCDP001",
      photoMediaId: "01J8ZQFX9K7YWVTN3MABCDM001",
      transcriptReviewed: true,
      generatedAt: 1_700_000_000_000,
    },
  },
  {
    path: "/create/publish",
    seed: {
      productId: "01J8ZQFX9K7YWVTN3MABCDP001",
      photoMediaId: "01J8ZQFX9K7YWVTN3MABCDM001",
      transcriptReviewed: true,
      generatedAt: 1_700_000_000_000,
      contentReviewedAt: 1_700_000_100_000,
    },
  },
];

/** Menyemai draf sebelum halaman dimuat, supaya penjagaan langkah meloloskannya. */
async function seedDraft(page: Page, seed: DraftSeed): Promise<void> {
  // Tanpa token, useCreateFlow langsung mengalihkan ke /masuk — baik saat
  // goto maupun saat tes berikutnya. Menyemainya di sini menutup seluruh
  // rute yang memakai helper ini, termasuk TC-A11Y-03 dan TC-A11Y-10.
  await seedAccessToken(page);
  await page.goto("/create/photo");
  await page.evaluate(async (draft) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("katavis", 1);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("drafts")) {
          database.createObjectStore("drafts");
        }
      };
      request.onerror = () => reject(new Error("IndexedDB tidak dapat dibuka"));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("drafts", "readwrite");
        transaction.objectStore("drafts").put(draft, "current");
        transaction.oncomplete = () => {
          // Wajib ditutup. Koneksi yang dibiarkan terbuka memblokir
          // pembukaan berikutnya, dan halamannya berhenti di keadaan
          // memuat selamanya — di WebKit, tanpa galat apa pun.
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(new Error("Draf tidak dapat disimpan"));
      };
    });
  }, { ...EMPTY_DRAFT, ...seed, updatedAt: Date.now() });
}

test.describe("@a11y pelanggaran otomatis", () => {
  for (const route of ROUTES) {
    test(`TC-A11Y-01 tidak ada pelanggaran serius di ${route.path}`, async ({ page }) => {
      await seedDraft(page, route.seed);
      await page.goto(route.path);
      // Menunggu halaman selesai dirender sebelum memeriksa.
      await expect(page.locator("h1")).toBeVisible();

      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );

      expect(
        serious.map((violation) => `${violation.id}: ${violation.help}`),
        "Pelanggaran serius atau kritis",
      ).toEqual([]);
    });
  }
});

test.describe("@a11y Accessibility Mode", () => {
  test("bantuan suara yang belum tersedia tidak diklaim aktif", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Mode Aksesibilitas/ }).click();
    await expect(page.getByLabel("Bantuan suara")).toBeDisabled();
    await expect(page.getByText("Perintah suara di aplikasi belum tersedia.", { exact: false })).toBeVisible();
  });

  test("pilihan aksesibilitas sebelum login tetap aktif untuk akun baru", async ({ page }) => {
    let savedVisual = false;
    await stubApi(page, "POST", "/auth/otp/request", () => apiOk({
      expiresAt: Date.now() + 300_000, resendAfter: Date.now() + 60_000,
    }));
    await stubApi(page, "POST", "/auth/otp/verify", () => apiOk({
      accessToken: "uji-sesi", refreshToken: "uji-refresh", expiresIn: 900,
      user: {
        id: "01J8ZQFX9K7YWVTN3MABCDP001", displayName: null, role: "artisan",
        locale: "id", isNewUser: true,
        a11yProfile: { visual: false, hearing: false, motor: false, cognitive: false, voice: false },
      },
    }));
    await stubApi(page, "PUT", "/me/a11y-profile", (route) => {
      savedVisual = (route.request().postDataJSON() as { visual: boolean }).visual;
      return apiOk({});
    });

    await page.goto("/masuk");
    await page.getByRole("button", { name: /Mode Aksesibilitas/ }).click();
    await page.getByLabel("Visual").check();
    await page.getByRole("button", { name: /Mode Aksesibilitas/ }).click();
    await page.getByLabel("Nomor ponsel").fill("081234567890");
    await page.getByRole("button", { name: "Kirim kode" }).click();
    await page.getByLabel("Kode dari SMS").fill("123456");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();

    await expect(page.locator("html")).toHaveAttribute("data-a11y-visual", "true");
    await expect.poll(() => savedVisual).toBe(true);
  });

  test("profil dari akun langsung aktif setelah masuk pada perangkat baru", async ({ page }) => {
    // TC-I-13: profil yang tersimpan di server harus menang atas cermin lokal.
    await stubApi(page, "POST", "/auth/otp/request", () => apiOk({
      expiresAt: Date.now() + 300_000, resendAfter: Date.now() + 60_000,
    }));
    await stubApi(page, "POST", "/auth/otp/verify", () => apiOk({
      accessToken: "uji-sesi", refreshToken: "uji-refresh", expiresIn: 900,
      user: {
        id: "01J8ZQFX9K7YWVTN3MABCDP001", displayName: null, role: "artisan",
        locale: "id", isNewUser: false,
        a11yProfile: { visual: true, hearing: false, motor: true, cognitive: false, voice: false },
      },
    }));

    await page.goto("/masuk");
    await page.getByLabel("Nomor ponsel").fill("081234567890");
    await page.getByRole("button", { name: "Kirim kode" }).click();
    await page.getByLabel("Kode dari SMS").fill("123456");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();

    await expect(page.locator("html")).toHaveAttribute("data-a11y-visual", "true");
    await expect(page.locator("html")).toHaveAttribute("data-a11y-motor", "true");
  });

  test("TC-A11Y-11 tombolnya ada di seluruh rute", async ({ page }) => {
    for (const route of ROUTES) {
      await seedDraft(page, route.seed);
      await page.goto(route.path);

      // Ditemukan lewat peran ARIA, bukan lewat axe-core: yang diperiksa
      // adalah keberadaannya, dan itu tidak terlihat oleh aturan mana pun.
      await expect(
        page.getByRole("button", { name: /Mode Aksesibilitas/ }),
        `Tombol tidak ada di ${route.path}`,
      ).toBeVisible();
    }
  });

  test("TC-A11Y-25 lima profil dapat digabung", async ({ page }) => {
    await page.goto("/create/photo");
    await page.getByRole("button", { name: /Mode Aksesibilitas/ }).click();

    const motor = page.getByLabel("Motorik");
    const hearing = page.getByLabel("Pendengaran");

    await motor.check();
    await hearing.check();

    // Keduanya menyala bersamaan — bukan satu pilihan dari lima.
    await expect(motor).toBeChecked();
    await expect(hearing).toBeChecked();

    // Dan atributnya benar-benar sampai ke elemen akar, tempat tokens.css
    // membacanya.
    await expect(page.locator("html")).toHaveAttribute("data-a11y-motor", "true");
    await expect(page.locator("html")).toHaveAttribute("data-a11y-hearing", "true");
    await expect(page.locator("html")).toHaveAttribute("data-a11y-visual", "false");

    // Profil ketiga menyala tanpa memadamkan dua yang pertama.
    await page.getByLabel("Kognitif").check();
    await expect(motor).toBeChecked();
    await expect(hearing).toBeChecked();
  });

  test("profil Visual menaikkan ukuran teks dan target", async ({ page }) => {
    await page.goto("/create/photo");
    await page.getByRole("button", { name: /Mode Aksesibilitas/ }).click();
    await page.getByLabel("Visual").check();

    const body = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--text-body").trim(),
    );

    // tokens.css menaikkan --text-body ke --text-body-lg pada profil Visual.
    expect(body).not.toBe("1.125rem");
  });

  test("TC-A11Y-03 target sentuh memenuhi 56px", async ({ page }) => {
    await page.goto("/create/photo");
    await page.getByRole("button", { name: /Mode Aksesibilitas/ }).click();

    const toggle = page.getByRole("button", { name: /Mode Aksesibilitas/ });
    const box = await toggle.boundingBox();

    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
  });

  test("TC-A11Y-07 fokus terlihat pada tombol", async ({ page }) => {
    await page.goto("/create/photo");

    const toggle = page.getByRole("button", { name: /Mode Aksesibilitas/ });
    await toggle.focus();

    const outline = await toggle.evaluate((element) => {
      const style = getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });

    expect(outline.style).not.toBe("none");
    expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(3);
  });
});

test.describe("@a11y preferensi sistem", () => {
  test("TC-A11Y-09 halaman berfungsi pada zoom 200%", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto("/create/photo");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    expect(overflows, "Ada gulir horizontal pada lebar setara zoom 200%").toBe(false);
  });

  test("TC-A11Y-08 animasi berhenti saat pengguna memintanya", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/create/photo");

    const durations = await page.evaluate(() => {
      const toggle = document.querySelector("button");
      if (toggle === null) return [];
      const style = getComputedStyle(toggle);
      return [style.animationDuration, style.transitionDuration];
    });

    for (const duration of durations) {
      expect(Number.parseFloat(duration)).toBeLessThan(0.05);
    }
  });
});

test.describe("@a11y papan ketik", () => {
  test("TC-E2E-03 tombol dapat dijangkau dan dijalankan tanpa tetikus", async ({ page }) => {
    await page.goto("/create/photo");

    const toggle = page.getByRole("button", { name: /Mode Aksesibilitas/ });
    await toggle.focus();
    await page.keyboard.press("Enter");

    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Seluruh kotak centang dapat dijangkau dengan Tab dan diubah dengan
    // papan ketik, tanpa satu pun klik.
    await page.getByLabel("Motorik").focus();
    await page.keyboard.press("Space");
    await expect(page.getByLabel("Motorik")).toBeChecked();
  });
});

/**
 * Pemeriksaan yang melengkapi TC-A11Y-01.
 *
 * Axe-core menangkap sekitar sepertiga masalah aksesibilitas (TEST-PLAN
 * bagian 6). Aturan yang dilewatinya justru yang paling sering dilanggar di
 * proyek ini — target sentuh, urutan heading, dan label masukan — karena
 * ketiganya tuntutan yang lebih ketat daripada bawaan WCAG, bukan pelanggaran
 * yang terdeteksi otomatis.
 */
test.describe("@a11y tuntutan yang lebih ketat dari WCAG", () => {
  test("TC-A11Y-03 seluruh target sentuh memenuhi 56 px", async ({ page }) => {
    // AGENTS.md aturan 6: target sentuh minimum 56x56 px, bukan 44.
    await seedDraft(page, {});
    await page.goto("/create/photo");
    await expect(page.locator("h1")).toBeVisible();

    const undersized = await page.evaluate(() => {
      const minimum = 56;
      const offenders: { readonly text: string; readonly width: number; readonly height: number }[] = [];

      const interactive = document.querySelectorAll("button, a[href], input, select, textarea");

      for (const element of interactive) {
        const rect = element.getBoundingClientRect();

        // Elemen yang tidak terlihat tidak diukur: yang tersembunyi dari
        // pengguna tidak dapat disentuh, sehingga ukurannya tidak berarti.
        if (rect.width === 0 || rect.height === 0) continue;

        // Masukan yang disembunyikan dengan pola sr-only (klip 1px) BUKAN
        // target sentuh: ia dijalankan lewat tombol pemicunya yang terlihat,
        // dan tombol itu diukur sebagai elemennya sendiri. Mengukurnya
        // berarti menghukum pola aksesibilitas yang benar.
        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") continue;
        if (style.clipPath === "inset(50%)") continue;

        if (rect.width < minimum || rect.height < minimum) {
          offenders.push({
            text: (element.textContent ?? element.getAttribute("aria-label") ?? "").trim().slice(0, 40),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }

      return offenders;
    });

    expect(
      undersized,
      `Target sentuh di bawah 56 px: ${undersized.map((item) => `${item.text} (${item.width}x${item.height})`).join(", ")}`,
    ).toEqual([]);
  });

  test("TC-A11Y-04 setiap gambar punya teks alternatif", async ({ page }) => {
    // Alt kosong hanya sah untuk gambar dekoratif, dan gambar dekoratif
    // dinyatakan dengan `alt=""` **dan** `aria-hidden`, bukan dengan
    // menghilangkan atributnya.
    for (const route of ROUTES) {
      await seedDraft(page, route.seed);
      await page.goto(route.path);
      await expect(page.locator("h1")).toBeVisible();

      const missing = await page.evaluate(() =>
        [...document.querySelectorAll("img")]
          .filter((image) => !image.hasAttribute("alt"))
          .map((image) => image.getAttribute("src") ?? "(tanpa src)"),
      );

      expect(missing, `Gambar tanpa alt di ${route.path}`).toEqual([]);
    }
  });

  test("TC-A11Y-05 setiap input punya label terkait", async ({ page }) => {
    // Placeholder saja tidak dihitung: ia hilang begitu pengguna mengetik,
    // dan pembaca layar tidak selalu menyampaikannya sebagai nama.
    //
    // Rute yang memang memuat masukan diperiksa dengan draf yang membuka
    // layarnya; rute tanpa masukan lolos tanpa menemukan apa pun.
    const routesWithInputs = [
      { path: "/create/transcript", seed: { productId: "01J", photoMediaId: "01M" } },
      {
        path: "/create/review",
        seed: { productId: "01J", photoMediaId: "01M", transcriptReviewed: true, generatedAt: 1 },
      },
      {
        path: "/create/publish",
        seed: {
          productId: "01J",
          photoMediaId: "01M",
          transcriptReviewed: true,
          generatedAt: 1,
          contentReviewedAt: 1,
        },
      },
    ];

    for (const route of routesWithInputs) {
      await seedDraft(page, route.seed);
      await page.goto(route.path);
      await expect(page.locator("h1")).toBeVisible();

      const unlabelled = await page.evaluate(() => {
        const offenders: string[] = [];

        for (const input of document.querySelectorAll("input, select, textarea")) {
          const rect = input.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;

          const id = input.getAttribute("id");
          const hasLabel = id !== null && document.querySelector(`label[for="${id}"]`) !== null;
          const wrapped = input.closest("label") !== null;
          const ariaLabel = input.getAttribute("aria-label");
          const ariaLabelledBy = input.getAttribute("aria-labelledby");

          if (!hasLabel && !wrapped && ariaLabel === null && ariaLabelledBy === null) {
            offenders.push(`${input.tagName.toLowerCase()}#${id ?? "(tanpa id)"}`);
          }
        }

        return offenders;
      });

      expect(unlabelled, `Masukan tanpa label di ${route.path}`).toEqual([]);
    }
  });

  test("TC-A11Y-06 urutan heading tidak melompati tingkat", async ({ page }) => {
    // S6-05. Lompatan dari h1 ke h3 menyembunyikan satu tingkat dari
    // pengguna yang menelusuri halaman lewat daftar heading.
    for (const route of ROUTES) {
      await seedDraft(page, route.seed);
      await page.goto(route.path);
      await expect(page.locator("h1")).toBeVisible();

      const levels = await page.evaluate(() =>
        [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) =>
          Number.parseInt(heading.tagName.slice(1), 10),
        ),
      );

      expect(levels[0], `Heading pertama di ${route.path} bukan h1`).toBe(1);

      for (let index = 1; index < levels.length; index += 1) {
        const previous = levels[index - 1] ?? 1;
        const current = levels[index] ?? 1;

        // Naik boleh berapa saja; turun maksimum satu tingkat.
        expect(
          current - previous,
          `Urutan heading melompat di ${route.path}: ${levels.join(" -> ")}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test("TC-A11Y-10 halaman berfungsi pada zoom 400%", async ({ page }) => {
    // Berbeda dari TC-A11Y-09: pada 400% konten wajib mengalir, bukan hanya
    // tidak menggulir mendatar. Dua hal diperiksa: tidak ada gulir
    // horizontal, dan isi utamanya masih terbaca.
    await seedDraft(page, {});
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/create/photo");
    await expect(page.locator("h1")).toBeVisible();

    // 320 px CSS adalah lebar 360 px pada zoom 400% ke atas, dibulatkan ke
    // bawah untuk memberi ruang aman.
    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForTimeout(200);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    expect(overflows, "Ada gulir horizontal pada zoom 400%").toBe(false);

    // Isi utamanya masih ada, bukan terpotong sampai hilang.
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByRole("button", { name: /Ambil atau pilih foto/ })).toBeVisible();
  });
});

test.describe("@a11y pembacaan transkrip", () => {
  test("TC-A11Y-12 tombol TTS membacakan transkrip", async ({ page }) => {
    // S6-03. Ini berbeda dari pembaca layar pengguna (S6 menegaskan
    // keduanya hal berbeda dan keduanya wajib bekerja): tombol ini ada di
    // dalam KATAVIS, dan yang dibacakannya hanya transkrip cerita.
    //
    // `speechSynthesis` tidak ada di peramban uji, jadi yang diperiksa
    // adalah kontraknya: tombolnya ada, namanya menyatakan apa yang
    // dilakukannya, dan menekannya memanggil sintesis suara dengan teks
    // transkripnya.
    await page.addInitScript(() => {
      const spoken: string[] = [];
      (window as unknown as { __spoken: string[] }).__spoken = spoken;

      // WebKit tidak menyediakan Web Speech API sama sekali. Kontrak yang
      // diuji adalah apa yang dipanggil KATAVIS bila API-nya ada, jadi
      // keduanya — objek sintesis dan konstruktor ucapannya — disediakan.
      class StubUtterance {
        public text: string;
        public lang = "";
        public onend: (() => void) | null = null;
        public onerror: (() => void) | null = null;
        public constructor(text?: string) {
          this.text = text ?? "";
        }
      }

      const win = window as unknown as Record<string, unknown>;
      if (typeof win["SpeechSynthesisUtterance"] === "undefined") {
        win["SpeechSynthesisUtterance"] = StubUtterance;
      }

      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          speak: (utterance: { text: string }) => spoken.push(utterance.text),
          cancel: () => undefined,
          getVoices: () => [],
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          speaking: false,
          pending: false,
        },
      });
    });

    await seedDraft(page, {
      productId: "01J8ZQFX9K7YWVTN3MABCDP001",
      photoMediaId: "01J8ZQFX9K7YWVTN3MABCDM001",
    });

    // Polling transkrip menolak tanpa sesi: tanpa token, layar menampilkan
    // galat UNAUTHENTICATED dan tombolnya tidak pernah dirender.
    await seedAccessToken(page);

    // Halaman memuat transkrip dari API saat dipasang; tanpa stub ini layar
    // berhenti di "Menyiapkan transkrip..." dan tombolnya tidak pernah
    // dirender. Bentuk jawabannya dari kontrak API bagian 6.
    await stubApi(page, "GET", "/products/:id/transcript", () =>
      apiOk({ text: TRANSCRIPT_TEXT, locale: "id", edited: false, provider: "groq", durationMs: 31_200 }),
    );

    await page.goto("/create/transcript");

    const speakButton = page.getByRole("button", { name: "Bacakan transkrip" });
    await expect(speakButton).toBeVisible();

    await speakButton.click();

    const spoken = await page.evaluate(
      () => (window as unknown as { __spoken: string[] }).__spoken,
    );

    expect(spoken.length, "Tombol TTS tidak membacakan apa pun").toBeGreaterThan(0);
    expect(spoken[0]?.length ?? 0, "Yang dibacakan kosong").toBeGreaterThan(0);
  });
});
