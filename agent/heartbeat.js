/**
 * Heartbeat Studio Agent.
 *
 * Dikirim setiap 15 detik ke `POST /agent/heartbeat`. Kontrak API bagian 8
 * menyatakan konsekuensi kehilangan heartbeat dengan sangat spesifik:
 *
 *   Tanpa heartbeat sehat selama 30 detik, pekerjaan gambar langsung menuju
 *   Workers AI tanpa menunggu batas 45 detik.
 *
 * Artinya heartbeat bukan sekadar indikator pemantauan. Ia adalah masukan
 * yang menentukan berapa lama pengrajin menunggu. Agen yang berhenti
 * mengirim heartbeat setelah mengambil pekerjaan justru memperburuk keadaan:
 * rantai penyedia akan menunggu sampai 45 detik sebelum menyerah, padahal
 * agennya sudah tidak ada.
 *
 * Karena itu interval 15 detik dipilih terhadap ambang 30 detik: satu
 * heartbeat yang hilang karena jaringan berkedip belum cukup untuk
 * menyatakan agen mati, sedangkan dua yang hilang sudah. Menyetel interval
 * lebih panjang dari 15 detik akan membuat ambang 30 detik tidak lagi berarti.
 */

import { ApiRequestError } from "./api.js";

/** Interval kontrak. Diuji terhadap TC-SA-02. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

export class HeartbeatLoop {
  /**
   * @param {{
   *   client: import("./api.js").AgentApiClient,
   *   agentId: string,
   *   getHealth: () => { selectorsOk: boolean, chromeSessionOk: boolean },
   *   log: (message: string) => void,
   *   intervalMs?: number,
   * }} options
   */
  constructor(options) {
    this.options = options;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.timer = null;
    this.inFlight = false;
    this.stopped = false;
    this.failures = 0;
  }

  /**
   * Jumlah heartbeat berturut-turut yang gagal.
   *
   * Dipakai `index.js` untuk menampilkan peringatan sebelum 30 detik
   * terlampaui, bukan sesudahnya. Operator yang tahu lebih awal dapat
   * memindahkan hotspot sebelum pengrajin merasakan akibatnya.
   *
   * @returns {number}
   */
  get consecutiveFailures() {
    return this.failures;
  }

  /**
   * Mengirim heartbeat pertama secara sinkron.
   *
   * Pemeriksaan kesehatan saat mulai menuntut agen mendaftar sebelum
   * mengambil pekerjaan. Server menolak claim dari agen yang belum pernah
   * melapor — tanpa urutan ini, `POST /agent/jobs/claim` mengembalikan
   * FORBIDDEN dan agen akan tampak rusak padahal hanya belum terdaftar.
   */
  async start() {
    await this.#send();
    this.#schedule();
  }

  /**
   * Menghentikan loop dan membersihkan timer.
   *
   * `clearTimeout` wajib. P3 menyebut "setTimeout tanpa membersihkannya saat
   * pekerjaan selesai lebih dulu" sebagai jebakan; pada loop heartbeat
   * akibatnya berbeda tetapi sama merusaknya: proses Node tidak keluar
   * karena timer yang masih menunggu, sehingga operator menutup terminal
   * secara paksa dan heartbeat terakhir tidak pernah terkirim.
   */
  stop() {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  #schedule() {
    if (this.stopped) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.#tick();
    }, this.options.intervalMs ?? HEARTBEAT_INTERVAL_MS);

    // Timer tidak boleh menahan proses tetap hidup; penghentian adalah
    // keputusan `index.js`, bukan efek samping dari heartbeat.
    this.timer.unref?.();
  }

  async #tick() {
    if (this.stopped) return;

    await this.#send();
    this.#schedule();
  }

  async #send() {
    if (this.inFlight) return;
    this.inFlight = true;

    const health = this.options.getHealth();
    // `healthy` hanya benar bila KEDUANYA benar. Agen dengan selector rusak
    // tetapi sesi hidup tetap tidak dapat menyelesaikan pekerjaan gambar,
    // dan menyatakannya sehat akan menahan pekerjaan 45 detik di jalur
    // Gemini yang tidak mungkin berhasil.
    const healthy = health.selectorsOk && health.chromeSessionOk;

    try {
      await this.options.client.post("/agent/heartbeat", {
        agentId: this.options.agentId,
        healthy,
        selectorsOk: health.selectorsOk,
        chromeSessionOk: health.chromeSessionOk,
      });
      this.failures = 0;
    } catch (error) {
      this.#handleFailure(error);
    } finally {
      this.inFlight = false;
    }
  }

  /** @param {unknown} error */
  #handleFailure(error) {
    this.failures += 1;

    if (error instanceof ApiRequestError) {
      if (error.failure?.code === "FORBIDDEN") {
        // Kunci agen salah. Tidak ada gunanya mencoba lagi: setiap
        // percobaan akan ditolak dengan cara yang sama. Dihentikan agar
        // operator melihat satu pesan yang jelas, bukan log yang berulang
        // setiap 15 detik sampai ia berhenti membacanya.
        this.options.log(
          "Kunci agen ditolak server. Periksa AGENT_SHARED_KEY di agent/.env " +
            "agar sama dengan rahasia yang terpasang di Worker. Heartbeat dihentikan.",
        );
        this.stop();
        return;
      }

      this.options.log(
        `Heartbeat gagal (${error.failure?.code ?? error.status}). ` +
          `Percobaan gagal berturut-turut: ${this.failures}.`,
      );
      return;
    }

    this.options.log(
      `Heartbeat gagal dikirim. Percobaan gagal berturut-turut: ${this.failures}.`,
    );
  }
}
