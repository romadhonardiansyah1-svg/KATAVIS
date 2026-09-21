/**
 * Menjalankan Chrome ASLI dan menghubungkannya lewat CDP.
 *
 * Chrome dijalankan sebagai proses terpisah dengan `--remote-debugging-port`
 * dan `--user-data-dir`, lalu dihubungkan dengan `connectOverCDP`.
 *
 * MENGAPA BUKAN Chromium bawaan Playwright
 * -----------------------------------------
 * Google terbukti memblokirnya dengan pesan "This browser or app may not be
 * secure". Konsekuensinya seluruh modul ini tidak pernah memanggil
 * `chromium.launch()`. Bila suatu saat ada yang menambahkannya, jalur Gemini
 * akan berhenti bekerja — dan kegagalannya akan tampak seperti masalah akun,
 * bukan masalah kode. ADR-004 mencatat buktinya.
 *
 * MENGAPA BUKAN Camoufox ATAU undetected-chromedriver
 * ---------------------------------------------------
 * Camoufox berbasis Firefox dan justru lebih mencurigakan daripada Firefox
 * biasa (camoufox#536, #555). undetected-chromedriver tidak terpelihara sejak
 * 5 Juli 2025. Keduanya ditolak di ADR-004.
 *
 * MENGAPA TIDAK ADA OTOMASI PROSES MASUK
 * --------------------------------------
 * Login dilakukan manusia satu kali ke profil yang sama. Agen hanya
 * menggerakkan sesi yang sudah terautentikasi. Ini menghilangkan permukaan
 * deteksi yang paling berat, dan yang lebih penting: kredensial Google tidak
 * pernah menyentuh kode ini. Tidak ada bidang kata sandi di berkas mana pun
 * dalam modul ini, dan itu disengaja.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "@playwright/test";

/** Batas waktu deteksi selector yang rusak. TC-SA-03 menuntut 5 detik. */
const SELECTOR_PROBE_TIMEOUT_MS = 5_000;

/** Batas waktu proses Chrome menjawab pada port debug saat mulai. */
const CDP_READY_TIMEOUT_MS = 20_000;
const CDP_READY_POLL_MS = 250;

/**
 * Selector Gemini web.
 *
 * `gemini.google.com` adalah aplikasi Angular dengan nama kelas yang
 * diobfuskasi, dan kelas semacam itu berubah setiap penerapan. Karena itu
 * setiap selector di bawah ditulis sedekat mungkin dengan peran ARIA, atribut
 * `data-*` yang stabil, dan teks terlihat — bukan dengan nama kelas hash.
 *
 * Konsekuensi yang harus diterima: ini akan pecah. ADR-004 menyatakan
 * pertanyaannya kapan, bukan apakah. Yang dapat dikendalikan adalah seberapa
 * cepat kerusakannya terdeteksi, dan itu tugas pemeriksaan kesehatan.
 *
 * Setiap daftar adalah alternatif berurutan: yang pertama dicoba lebih dulu.
 * Beberapa alternatif lebih baik daripada satu selector yang rapuh, karena
 * ketika Google mengganti satu atribut, sisanya masih menunjuk elemen yang
 * sama.
 *
 * @type {{
 *   promptInput: readonly string[],
 *   sendButton: readonly string[],
 *   downloadButton: readonly string[],
 *   generatedImage: readonly string[],
 *   signedInMarker: readonly string[],
 *   signInPage: readonly string[],
 *   refusalNotice: readonly string[],
 * }}
 */
export const GEMINI_SELECTORS = {
  /** Kotak masukan prompt. */
  promptInput: [
    'rich-textarea [contenteditable="true"]',
    ".ql-editor[contenteditable='true']",
    'div[contenteditable="true"][role="textbox"]',
  ],
  /** Tombol kirim. */
  sendButton: [
    'button[aria-label*="Send" i]',
    'button[aria-label*="Kirim" i]',
    "button.send-button",
  ],
  /** Tombol unduh pada gambar hasil. */
  downloadButton: [
    'button[aria-label*="Download" i]',
    'button[aria-label*="Unduh" i]',
    'button[data-test-id="download-button"]',
  ],
  /** Gambar yang dihasilkan. */
  generatedImage: [
    "generated-image img",
    'img[data-test-id="generated-image"]',
    'model-response img[src^="data:image"]',
  ],
  /**
   * Penanda sesi sudah masuk.
   *
   * Bila elemen ini tidak ada padahal halaman termuat, sesi Chrome sudah
   * kehilangan status login. TC-SA-04 menuntut keadaan itu terdeteksi dan
   * dilaporkan, bukan dibiarkan menggantung sampai batas waktu.
   */
  signedInMarker: [
    'a[href*="accounts.google.com/SignOutOptions"]',
    'button[aria-label*="Google Account" i]',
    "nav[aria-label]",
  ],
  /** Penanda halaman masuk. Bila ini ada, sesi sudah tidak sah. */
  signInPage: [
    'input[type="email"][name="identifier"]',
    'form[action*="signin"]',
    'a[href*="accounts.google.com/ServiceLogin"]',
  ],
  /** Galat yang dikembalikan Gemini alih-alih gambar. */
  refusalNotice: ['div[role="alert"]', '[data-test-id="error-message"]'],
};

/**
 * Galat runtime agen.
 *
 * Terpisah dari katalog galat API: katalog itu untuk pesan yang sampai ke
 * pengrajin lewat Worker, sedangkan kelas ini memuat pesan untuk operator di
 * laptop. Karena itu pesan di sini BOLEH menyebut nama berkas dan jalur —
 * yang dilarang adalah istilah teknis pada pesan ke pengrajin, bukan pada
 * keluaran terminal agen.
 */
export class AgentRuntimeError extends Error {
  /**
   * @param {string} message
   * @param {string} [reason]
   */
  constructor(message, reason = "unknown") {
    super(message);
    this.name = "AgentRuntimeError";
    this.reason = reason;
  }
}

/**
 * Memeriksa apakah salah satu selector ada di halaman.
 *
 * Batas 5 detik bukan angka yang dipilih agar terlihat rapi: TC-SA-03
 * menuntut selector yang pecah terdeteksi dalam 5 detik, bukan setelah batas
 * 45 detik. Menunggu 45 detik untuk sesuatu yang tidak akan muncul berarti
 * demo kehilangan 45 detik tanpa alasan.
 *
 * @param {import("@playwright/test").Page} page
 * @param {readonly string[]} selectors
 * @param {number} [timeoutMs]
 * @returns {Promise<string | null>}
 */
async function anySelectorPresent(page, selectors, timeoutMs = SELECTOR_PROBE_TIMEOUT_MS) {
  const perSelector = Math.max(500, Math.floor(timeoutMs / selectors.length));

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "attached", timeout: perSelector });
      return selector;
    } catch {
      // Selector ini tidak ada. Alternatif berikutnya dicoba.
    }
  }

  return null;
}

/** Menjalankan Chrome asli sebagai proses terpisah. */
export class ChromeProcess {
  /**
   * @param {{ executablePath: string, profileDir: string, debugPort: number, headless?: boolean }} options
   */
  constructor(options) {
    this.options = options;
    /** @type {import("node:child_process").ChildProcess | null} */
    this.child = null;
  }

  /**
   * Memulai Chrome dan menunggu port debug siap.
   *
   * `--user-data-dir` diarahkan ke luar repositori oleh pemanggil; berkas di
   * dalamnya memuat sesi login Google dan tidak boleh masuk git.
   */
  async start() {
    if (this.child !== null) return;

    const profileDir = resolve(this.options.profileDir);
    if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });

    /** @type {string[]} */
    const args = [
      `--remote-debugging-port=${this.options.debugPort}`,
      `--user-data-dir=${profileDir}`,
      // Profil pertama langsung dipakai. Tanpa ini Chrome dapat membuka
      // pemilih profil dan tidak pernah memuat halaman apa pun.
      "--profile-directory=Default",
      "--no-first-run",
      "--no-default-browser-check",
      // Jendela tetap tampil meski agen berjalan tanpa pengawasan: proses
      // masuk manual menuntut jendela yang dapat disentuh manusia.
    ];
    if (this.options.headless === true) args.push("--headless=new");
    args.push("about:blank");

    const child = spawn(this.options.executablePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this.child = child;

    child.once("error", () => {
      // Galat spawn muncul di sini sebagai ENOENT bila jalurnya salah.
      // Ditangani oleh pemeriksaan kesiapan di bawah, yang mengubahnya
      // menjadi pesan yang dapat dibaca operator.
      this.child = null;
    });

    await this.#waitForCdp();
  }

  /** Menunggu port debug benar-benar menjawab, bukan sekadar menunggu waktu tetap. */
  async #waitForCdp() {
    const endpoint = `http://127.0.0.1:${this.options.debugPort}/json/version`;
    const until = Date.now() + CDP_READY_TIMEOUT_MS;

    while (Date.now() < until) {
      if (this.child === null) {
        throw new AgentRuntimeError(
          "Chrome tidak dapat dijalankan pada jalur yang dikonfigurasi. " +
            "Periksa CHROME_PATH di agent/.env.",
        );
      }

      try {
        const response = await fetch(endpoint, {
          signal: AbortSignal.timeout(CDP_READY_POLL_MS * 4),
        });
        if (response.ok) return;
      } catch {
        // Port belum terbuka. Chrome butuh beberapa ratus milidetik.
        // Kegagalan di sini adalah keadaan yang diharapkan, bukan galat.
      }

      await delay(CDP_READY_POLL_MS);
    }

    throw new AgentRuntimeError(
      "Chrome tidak menjawab pada port debug. Kemungkinan profil sedang " +
        "dipakai jendela Chrome lain. Tutup semua jendela lalu jalankan lagi.",
    );
  }

  /**
   * Apakah proses Chrome masih hidup.
   *
   * Diperiksa terhadap proses, bukan terhadap koneksi CDP. Koneksi dapat
   * masih terbuka terhadap proses yang sudah menjadi zombie, dan P3
   * menyebut "menganggap Chrome masih hidup tanpa memeriksa proses" sebagai
   * jebakan yang harus dihindari.
   *
   * @returns {boolean}
   */
  isAlive() {
    const child = this.child;
    if (child === null) return false;
    return child.exitCode === null && child.signalCode === null;
  }

  /** Membebaskan sumber daya tanpa mematikan Chrome milik operator. */
  async dispose() {
    this.child = null;
  }
}

/**
 * Menghubungkan ke Chrome yang sudah berjalan dan membuka tab Gemini.
 *
 * Tab dipakai ulang bila sudah ada. Membuka tab baru setiap pekerjaan akan
 * menumpuk puluhan tab dalam satu sesi demo, dan setiap tab memuat konteks
 * Angular penuh — pada laptop dengan 1,7 GB RAM bebas itu berakhir dengan
 * proses yang dihentikan sistem.
 *
 * @param {number} port
 * @param {string} geminiUrl
 * @returns {Promise<{ browser: import("@playwright/test").Browser, page: import("@playwright/test").Page }>}
 */
export async function connectToGemini(port, geminiUrl) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: CDP_READY_TIMEOUT_MS,
  });

  const context = browser.contexts()[0];
  if (context === undefined) {
    throw new AgentRuntimeError(
      "Chrome terhubung tetapi tidak punya konteks peramban. " +
        "Tutup Chrome lalu jalankan agen lagi.",
    );
  }

  const existing = context.pages().find((candidate) => candidate.url().startsWith(geminiUrl));

  const page = existing ?? (await context.newPage());
  if (existing === undefined) {
    await page.goto(geminiUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  return { browser, page };
}

/**
 * Pemeriksaan kesehatan.
 *
 * Dipanggil saat mulai. Bila gagal, agen mendaftar sebagai tidak sehat dan
 * TIDAK mengambil pekerjaan — TC-SA-01. Pekerjaan yang tidak diambil langsung
 * menuju Workers AI tanpa menunggu 45 detik, dan itu justru hasil yang
 * diinginkan.
 *
 * Urutan pemeriksaan disengaja: status login diperiksa lebih dulu. Bila sesi
 * sudah mati, memeriksa selector masukan hanya menghasilkan kebingungan —
 * halaman login memang tidak punya kotak prompt.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ selectorsOk: boolean, chromeSessionOk: boolean, detail: string }>}
 */
export async function checkHealth(page) {
  const signInPage = await anySelectorPresent(page, GEMINI_SELECTORS.signInPage, 3_000);
  if (signInPage !== null) {
    return {
      selectorsOk: false,
      chromeSessionOk: false,
      detail:
        "Sesi Chrome sudah tidak masuk. Buka jendela Chrome profil agen dan " +
        "masuk manual dengan akun Google terpisah, lalu jalankan agen lagi.",
    };
  }

  const signedIn = await anySelectorPresent(page, GEMINI_SELECTORS.signedInMarker, 3_000);
  if (signedIn === null) {
    return {
      selectorsOk: false,
      chromeSessionOk: false,
      detail:
        "Tidak dapat memastikan sesi Chrome masih masuk. Pastikan jendela " +
        "Chrome profil agen menampilkan halaman Gemini dalam keadaan masuk.",
    };
  }

  const promptInput = await anySelectorPresent(page, GEMINI_SELECTORS.promptInput);
  if (promptInput === null) {
    return {
      selectorsOk: false,
      chromeSessionOk: true,
      detail:
        "Kotak masukan Gemini tidak ditemukan. Antarmuka Gemini berubah; " +
        "perbarui selector di agent/chrome.js. Sementara itu pekerjaan gambar " +
        "dikerjakan penyedia cadangan.",
    };
  }

  return {
    selectorsOk: true,
    chromeSessionOk: true,
    detail: "Chrome siap dan sesi Gemini masih masuk.",
  };
}

/**
 * Mengubah keadaan kegagalan menjadi alasan yang sah menurut kontrak.
 *
 * Daftar alasan dibatasi lima nilai oleh API-CONTRACT.md bagian 8 dan
 * `AgentFailSchema`. Menambah nilai keenam di sini akan ditolak server, dan
 * kegagalan yang ditolak server berarti pekerjaan tidak kembali ke antrian.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function reasonFromFailure(error) {
  if (error instanceof AgentRuntimeError) return error.reason;

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("timeout") || message.includes("deadline")) return "timeout";
    if (message.includes("context") || message.includes("closed")) return "session_expired";
    if (message.includes("selectors") || message.includes("element")) {
      return "selector_not_found";
    }
  }

  return "unknown";
}
