/**
 * Studio Agent — proses utama.
 *
 * Dijalankan di laptop, bukan di cloud. Workers adalah isolat V8 tanpa
 * sistem berkas dan tanpa kemampuan menjalankan proses, sedangkan otomasi
 * Gemini web menuntut Chrome asli dengan profil yang sudah login. Karena itu
 * modul ini ada. ARCHITECTURE.md bagian 4.
 *
 * PERINGATAN
 * ----------
 * Gunakan akun Google TERPISAH, bukan akun utama. Otomasi ini melanggar
 * Google Terms of Service bagian "Don't abuse our services", dan sanksinya
 * dapat mencakup penghapusan seluruh akun Google termasuk Gmail dan Drive.
 * ADR-004 mencatat risiko ini secara lengkap dan pemilik produk telah
 * menerimanya. Mitigasinya ada dua: akun terpisah, dan arsitektur yang tidak
 * pernah bergantung pada jalur ini.
 *
 * Yang TIDAK dilakukan modul ini: mengotomasi proses masuk. Login dilakukan
 * manusia satu kali. Tidak ada kredensial Google di mana pun dalam kode ini.
 *
 * Pemakaian:
 *   node agent/index.js                 menjalankan agen
 *   node agent/index.js --health-check  memeriksa kesiapan lalu keluar
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AgentApiClient, ApiRequestError } from "./api.js";
import {
  AgentRuntimeError,
  ChromeProcess,
  checkHealth,
  connectToGemini,
} from "./chrome.js";
import { HeartbeatLoop } from "./heartbeat.js";
import { processOneJob } from "./worker.js";

const AGENT_DIR = dirname(fileURLToPath(import.meta.url));

/** Jeda antar pemeriksaan antrian saat kosong. */
const IDLE_POLL_MS = 2_000;

/**
 * Memuat `agent/.env`.
 *
 * Penulisan sederhana, bukan pustaka `dotenv`: menambah dependensi baru
 * menuntut pertanyaan lebih dulu (AGENTS.md), dan kebutuhannya di sini hanya
 * `NAMA=nilai` per baris.
 *
 * Berkas ini diabaikan git karena memuat AGENT_SHARED_KEY.
 */
function loadEnvFile(path) {
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const separatorAt = line.indexOf("=");
    if (separatorAt <= 0) continue;

    const name = line.slice(0, separatorAt).trim();
    let value = line.slice(separatorAt + 1).trim();

    // Tanda kutip dibuang; nilai yang memuat tanda sama dengan tetap utuh
    // karena pemisahnya hanya yang pertama.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[name] === undefined) process.env[name] = value;
  }
}

export function readConfig() {
  const profileDir = resolve(
    AGENT_DIR,
    process.env.CHROME_PROFILE_DIR ?? "./chrome-profile",
  );

  return {
    workerUrl: process.env.WORKER_URL ?? "http://127.0.0.1:8787",
    agentId: process.env.AGENT_ID ?? "laptop-01",
    agentKey: process.env.AGENT_SHARED_KEY ?? "",
    chromePath: process.env.CHROME_PATH ?? "",
    profileDir,
    debugPort: Number.parseInt(process.env.CHROME_DEBUG_PORT ?? "9222", 10),
    geminiUrl: process.env.GEMINI_URL ?? "https://gemini.google.com/app",
  };
}

/**
 * Memeriksa konfigurasi sebelum menyentuh Chrome atau jaringan.
 *
 * Urutannya disengaja: kesalahan konfigurasi dilaporkan sebagai kesalahan
 * konfigurasi, bukan sebagai Chrome yang gagal dijalankan. Pesan yang salah
 * membuat operator memperbaiki hal yang salah.
 */
export function validateConfig(config) {
  const problems = [];

  if (config.agentKey.length === 0) {
    problems.push(
      "AGENT_SHARED_KEY belum diisi di agent/.env. Nilainya harus sama dengan " +
        "rahasia yang terpasang di Worker.",
    );
  }

  if (config.chromePath.length === 0) {
    problems.push(
      "CHROME_PATH belum diisi di agent/.env. Isi dengan jalur lengkap ke chrome.exe.",
    );
  } else if (!existsSync(config.chromePath)) {
    problems.push(
      `Chrome tidak ada di ${config.chromePath}. Perbaiki CHROME_PATH di agent/.env.`,
    );
  }

  if (existsSync(config.profileDir)) {
    const marker = resolve(config.profileDir, "Default");
    if (!existsSync(marker)) {
      problems.push(
        `Profil Chrome di ${config.profileDir} belum pernah dibuka. Jalankan ` +
          "agen sekali tanpa --health-check untuk membuka jendela Chrome, masuk " +
          "manual dengan akun Google TERPISAH, lalu jalankan lagi.",
      );
    }
  }

  return problems;
}

function timestamp() {
  return new Date().toISOString().slice(11, 19);
}

function log(message) {
  process.stdout.write(`[${timestamp()}] ${message}\n`);
}

/** Menghentikan proses dengan kode keluar yang dapat dibaca skrip. */
function exitWith(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

async function main() {
  const healthCheckOnly = process.argv.includes("--health-check");

  loadEnvFile(resolve(AGENT_DIR, ".env"));

  const config = readConfig();

  const problems = validateConfig(config);
  if (problems.length > 0) {
    process.stderr.write("Konfigurasi agen belum lengkap:\n");
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(2);
  }

  log(`Studio Agent ${config.agentId} mulai. Worker: ${config.workerUrl}`);
  log(
    "Pengingat: akun Google yang dipakai harus akun TERPISAH. " +
      "Sanksi ToS dapat mencakup penghapusan seluruh akun. ADR-004.",
  );

  const client = new AgentApiClient({
    baseUrl: config.workerUrl,
    agentKey: config.agentKey,
  });

  const chrome = new ChromeProcess({
    executablePath: config.chromePath,
    profileDir: config.profileDir,
    debugPort: config.debugPort,
  });

  let heartbeat = null;
  let session = null;
  const health = { selectorsOk: false, chromeSessionOk: false };

  /**
   * Membersihkan seluruh sumber daya.
   *
   * Dipanggil pada jalur keluar mana pun, termasuk sinyal. Timer heartbeat
   * dibersihkan lebih dulu supaya tidak ada permintaan yang dikirim setelah
   * proses dinyatakan berhenti.
   */
  const shutdown = () => {
    heartbeat?.stop();
    void session?.browser.close().catch(() => undefined);
    void chrome.dispose().catch(() => undefined);
  };

  const stopWith = (code) => {
    shutdown();
    process.exit(code);
  };

  process.on("SIGINT", () => {
    log("Dihentikan operator. Pekerjaan yang sedang berjalan akan kembali ke antrian.");
    stopWith(0);
  });
  process.on("SIGTERM", () => stopWith(0));

  try {
    await chrome.start();
  } catch (error) {
    const detail = error instanceof AgentRuntimeError ? error.message : "Chrome gagal dijalankan.";
    process.stderr.write(`${detail}\n`);
    process.exit(3);
  }

  try {
    session = await connectToGemini(config.debugPort, config.geminiUrl);
  } catch (error) {
    const detail =
      error instanceof AgentRuntimeError ? error.message : "Chrome tidak dapat dikendalikan.";
    process.stderr.write(`${detail}\n`);
    process.exit(3);
  }

  log("Menghubungkan ke Chrome. Menjalankan pemeriksaan kesehatan.");

  const report = await checkHealth(session.page);
  health.selectorsOk = report.selectorsOk;
  health.chromeSessionOk = report.chromeSessionOk;

  if (!report.selectorsOk || !report.chromeSessionOk) {
    // Agen yang tidak sehat TETAP mendaftar. Ini bukan kerapian: server
    // menolak claim dari agen yang belum pernah melapor, dan laporan tidak
    // sehat justru yang membuat pekerjaan langsung menuju Workers AI tanpa
    // menunggu 45 detik. TC-SA-01, TC-SA-02.
    await reportUnhealthy(client, config.agentId, health, log);

    process.stderr.write(`\nAgen TIDAK SEHAT: ${report.detail}\n`);
    process.stderr.write(
      "Pekerjaan gambar akan dikerjakan penyedia cadangan selama agen tidak sehat.\n",
    );

    shutdown();
    process.exit(healthCheckOnly ? 1 : 4);
  }

  log(`Pemeriksaan kesehatan lolos. ${report.detail}`);

  if (healthCheckOnly) {
    log("Mode pemeriksaan kesehatan: keluar tanpa mengambil pekerjaan.");
    shutdown();
    process.exit(0);
  }

  heartbeat = new HeartbeatLoop({
    client,
    agentId: config.agentId,
    getHealth: () => health,
    log,
  });
  await heartbeat.start();

  log("Agen siap. Menunggu pekerjaan.");

  const dependencies = {
    client,
    page: session.page,
    agentId: config.agentId,
    log,
  };

  /**
   * Loop kerja.
   *
   * Satu pekerjaan pada satu waktu — `max` dibatasi 1 oleh kontrak, dan loop
   * ini tidak pernah memanggil `processOneJob` dua kali bersamaan. Satu
   * peramban tidak menjalankan dua pekerjaan paralel. TC-SA-05.
   */
  for (;;) {
    try {
      const worked = await processOneJob(dependencies);

      if (!worked) {
        await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.failure?.code === "FORBIDDEN") {
        // Kunci agen salah atau agen belum terdaftar. Mencoba lagi setiap
        // dua detik hanya menghasilkan log yang tidak terbaca.
        exitWith(
          5,
          "Server menolak permintaan agen. Periksa AGENT_SHARED_KEY di agent/.env " +
            "agar sama dengan rahasia yang terpasang di Worker.",
        );
      }

      const detail = error instanceof Error ? error.message : "gangguan tidak dikenal";
      log(`Gangguan saat mengambil pekerjaan: ${detail}. Mencoba lagi.`);
      await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
    }
  }
}

/**
 * Mendaftarkan diri sebagai tidak sehat.
 *
 * Kegagalan di sini tidak dihentikan dengan proses keluar: agen tetap
 * mencoba mendaftar lagi lewat loop heartbeat berikutnya, dan kegagalannya
 * sudah terlihat di keluaran terminal.
 */
async function reportUnhealthy(client, agentId, health, logLine) {
  try {
    await client.post("/agent/heartbeat", {
      agentId,
      healthy: false,
      selectorsOk: health.selectorsOk,
      chromeSessionOk: health.chromeSessionOk,
    });
  } catch (error) {
    const detail = error instanceof ApiRequestError ? `kode ${error.status}` : "tidak terjangkau";
    logLine(`Tidak dapat melaporkan status tidak sehat ke server: ${detail}.`);
  }
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Agen berhenti karena gangguan: ${detail}\n`);
  process.exit(1);
});
