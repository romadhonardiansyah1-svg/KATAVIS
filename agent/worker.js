/**
 * Siklus satu pekerjaan: ambil, buat, unggah, laporkan.
 *
 * ATURAN YANG MENGIKAT (docs/ops/MODEL-ROUTING.md P3)
 * --------------------------------------------------
 *   3. Satu pekerjaan pada satu waktu. max=1 pada claim.
 *   4. Batas waktu memakai `deadlineAt` absolut dari server, bukan durasi lokal.
 *   5. Gagal cepat. Satu percobaan lalu menyerah; jangan mencoba ulang sendiri.
 *
 * Aturan 4 dan 5 saling menopang, dan keduanya membentuk perilaku yang mudah
 * salah dibaca: agen ini TIDAK PERNAH mencoba lagi. Pekerjaan yang gagal
 * dilaporkan lewat `fail`, dan server mengembalikannya ke antrian supaya
 * consumer Workers AI mengambilnya. Agen yang mencoba ulang sendiri akan
 * membuat pengrajin menunggu dua kali lebih lama untuk hasil yang belum tentu
 * lebih baik — dan pada jalur oportunistik, menyerah adalah perilaku yang
 * benar.
 *
 * KONSEKUENSI KERAS YANG DIPEGANG DI SINI
 * ---------------------------------------
 * Foto asli tidak pernah ditimpa. Hasil generate diunggah sebagai aset BARU
 * dengan `kind: "photo_studio"`, dan itu satu-satunya jenis unggahan yang
 * dilakukan agen ini. Bila gagal pada tahap mana pun, foto pengrajin tetap
 * utuh karena tidak ada satu baris pun di sini yang menyentuhnya. TC-E2E-13.
 */

import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

import { AgentRuntimeError, GEMINI_SELECTORS, reasonFromFailure } from "./chrome.js";
import { ApiRequestError } from "./api.js";

/** Batas waktu ajakan gambar muncul, dihitung dari deadlineAt server. */
const IMAGE_APPEAR_CEILING_MS = 60_000;

/**
 * Sisa waktu terhadap deadline absolut.
 *
 * Server yang menetapkan tenggatnya, agen hanya mematuhinya. Menghitung
 * durasi lokal akan membuat agen memakai jamnya sendiri, dan jam laptop
 * adalah hal yang paling sering tidak akurat di ruang lomba.
 *
 * @param {number} deadlineAt
 * @param {number} nowMs
 * @returns {number}
 */
function remainingMs(deadlineAt, nowMs) {
  return deadlineAt - nowMs;
}

/**
 * Menolak pekerjaan yang tenggatnya sudah lewat sebelum dimulai.
 *
 * Terjadi bila agen sempat mati dan hidup lagi: `deadlineAt` disimpan di
 * baris pekerjaan, dan pekerjaan lama dapat terbawa klaim berikutnya tanpa
 * ini. Mengerjakannya hanya membuang waktu milik penyedia cadangan.
 *
 * @param {{ deadlineAt: number }} job
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isExpired(job, nowMs) {
  return remainingMs(job.deadlineAt, nowMs) <= 0;
}

/**
 * Membuat gambar di Gemini web.
 *
 * Langkahnya sengaja kecil dan terpisah, supaya kegagalannya dapat
 * diterjemahkan menjadi `reason` yang benar. Alasan yang tepat bukan
 * kerapian: `selector_not_found` menuntut kode diperbarui, sedangkan
 * `session_expired` menuntut manusia masuk lagi, dan operator yang
 * mendapat alasan salah akan memperbaiki hal yang salah.
 *
 * @param {import("./worker.js").AgentJob} job
 * @param {JobDependencies} dependencies
 * @returns {Promise<{ bytes: Uint8Array, mimeType: string }>}
 */
export async function generateInGemini(job, dependencies) {
  const { page, log } = dependencies;
  const nowMs = Date.now();

  if (remainingMs(job.deadlineAt, nowMs) <= 0) {
    throw new AgentRuntimeError("Tenggat pekerjaan sudah lewat sebelum dimulai.", "timeout");
  }

  // Buka percakapan BARU di Gemini setiap pekerjaan agar prompt lama
  // tidak menumpuk dan Gemini tidak bingung dengan konteks sebelumnya.
  log("Membuka percakapan Gemini baru...");
  await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForTimeout(1500);

  // Prompt datang dari server dan sudah memuat kalimat penegak F2-05
  // ("JANGAN mengubah bentuk, warna, tekstur, atau proporsi produk").
  // Kalimat itu TIDAK ditambahkan di sini: menambahkannya di dua tempat
  // berarti dua tempat yang dapat berbeda pendapat, dan yang berlaku
  // sesungguhnya adalah yang dikirim server.
  let tempFile = null;
  try {
    const imageBytes = await dependencies.client.getBinary(`/agent/jobs/${job.id}/source-image`);
    if (imageBytes !== null && imageBytes.byteLength > 0) {
      tempFile = resolve(tmpdir(), `katavis-source-${job.id}.png`);
      writeFileSync(tempFile, imageBytes);

      log("Melampirkan foto asli produk ke Gemini web...");
      let fileInput = page.locator('input[type="file"]').first();
      if ((await fileInput.count()) === 0) {
        const uploadBtn = page
          .locator('button[aria-label*="Upload" i], button[aria-label*="Unggah" i], button[aria-label*="tambah" i]')
          .first();
        if ((await uploadBtn.count()) > 0) {
          await uploadBtn.click();
          await page.waitForTimeout(600);
        }
      }
      fileInput = page.locator('input[type="file"]').first();
      if ((await fileInput.count()) > 0) {
        await fileInput.setInputFiles(tempFile);
        log("Foto asli produk berhasil dilampirkan ke Gemini.");
        await page.waitForTimeout(2000);
      }
    }
  } catch (err) {
    log(`Peringatan lampiran foto: ${err instanceof Error ? err.message : String(err)}`);
  }

  const promptText =
    tempFile !== null
      ? `Edit foto produk yang saya lampirkan menjadi foto katalog komersial studio yang menarik dan estetik.

ATURAN MUTLAK:
- Produk utama adalah SATU-SATUNYA objek di foto hasil. Hapus semua objek lain, tangan, kemasan berlebih, atau gangguan di sekitar produk.
- Pertahankan produk 100% persis seperti di foto lampiran: bentuk, warna, tekstur bahan, ukuran relatif, dan seluruh detailnya. Jangan menggambar ulang produk menjadi barang lain.

HASIL YANG DIMINTA:
- Produk diletakkan di atas meja marmer putih bersih, difoto dari sudut tiga-perempat yang menonjolkan bentuknya.
- Pencahayaan studio softbox profesional dari kiri atas, bayangan kontak yang halus dan natural di bawah produk.
- Latar belakang gradient abu-abu muda ke putih yang bersih, dengan sedikit kesan ruang (depth) agar tidak terlihat polos dan datar.
- Gaya fotografi katalog pameran seni kriya internasional: tajam, hidup, dan menjual.
- Tanpa teks, tanpa watermark, tanpa objek tambahan.`
      : job.prompt.trim().length > 0
        ? job.prompt
        : "Buat foto produk studio profesional dari foto produk kerajinan ini. Latar bersih dengan pencahayaan studio yang lembut. JANGAN mengubah bentuk, warna, tekstur, atau proporsi produk. Pertahankan seluruh detail apa adanya.";

  await assertSessionAlive(page);

  const promptInput = await firstMatch(page, GEMINI_SELECTORS.promptInput);
  if (promptInput === null) {
    throw new AgentRuntimeError("Kotak masukan Gemini tidak ditemukan.", "selector_not_found");
  }

  const imageCountBefore = await countImages(page);

  await promptInput.click();
  // Kosongkan dulu kotak masukan: memastikan prompt dikirim tepat SATU kali.
  // Tanpa ini, sisa teks dari percobaan sebelumnya dapat ikut terkirim
  // bersama prompt baru bila navigasi chat baru belum selesai me-render.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  // `insertText`, bukan penekanan tombol satu per satu: prompt memuat
  // karakter non-ASCII, dan menekan tombol demi tombol pada aplikasi Angular
  // dapat kehilangan karakter saat rendering ulang.
  await page.keyboard.insertText(promptText);

  const sendButton = await firstMatch(page, GEMINI_SELECTORS.sendButton, 3_000);
  if (sendButton === null) {
    throw new AgentRuntimeError("Tombol kirim Gemini tidak ditemukan.", "selector_not_found");
  }
  await sendButton.click();

  log("Prompt dan foto terkirim ke Gemini. Menunggu hasil gambar...");

  try {
    return await waitForImage(job, { ...dependencies, imageCountBefore });
  } finally {
    if (tempFile !== null) {
      try {
        unlinkSync(tempFile);
      } catch {
        // Abaikan pembersihan berkas sementara
      }
    }
  }
}

/**
 * Memastikan sesi belum kehilangan status login.
 *
 * Diperiksa sebelum setiap pekerjaan, bukan hanya saat mulai. Sesi dapat
 * berakhir kapan saja di tengah demo — Google membatasi umur sesi, dan
 * laptop yang tertidur memutusnya lebih cepat. TC-SA-04.
 *
 * @param {import("@playwright/test").Page} page
 */
async function assertSessionAlive(page) {
  const signIn = await firstMatch(page, GEMINI_SELECTORS.signInPage, 2_000);
  if (signIn !== null) {
    throw new AgentRuntimeError("Sesi Chrome sudah tidak masuk.", "session_expired");
  }
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {readonly string[]} selectors
 * @param {number} [timeoutMs]
 * @returns {Promise<import("@playwright/test").Locator | null>}
 */
async function firstMatch(page, selectors, timeoutMs = 5_000) {
  const perSelector = Math.max(400, Math.floor(timeoutMs / selectors.length));

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: perSelector });
      return locator;
    } catch {
      // Alternatif berikutnya.
    }
  }

  return null;
}

/**
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<number | null>}
 */
async function countImages(page) {
  for (const selector of GEMINI_SELECTORS.generatedImage) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) return count;
    } catch {
      // Alternatif berikutnya.
    }
  }
  return 0;
}

/**
 * Menunggu gambar hasil muncul.
 *
 * Perbandingan jumlah gambar sebelum dan sesudah dikirim, bukan sekadar
 * keberadaan gambar: halaman Gemini memuat gambar dari percakapan sebelumnya,
 * dan menganggap gambar lama sebagai hasil baru akan mengunggah foto yang
 * salah ke katalog pengrajin. Itu kegagalan yang lebih buruk daripada tidak
 * menghasilkan apa-apa.
 *
 * @param {import("./worker.js").AgentJob} job
 * @param {JobDependencies & { imageCountBefore: number }} context
 * @returns {Promise<{ bytes: Uint8Array, mimeType: string }>}
 */
async function waitForImage(job, context) {
  const { page, log } = context;

  // Sisa waktu dibagi: sebagian untuk gambar muncul, sebagian untuk
  // mengunduh dan mengunggahnya. Menghabiskan seluruh tenggat untuk menunggu
  // lalu kehabisan waktu saat mengunduh akan membuang hasil yang sudah jadi.
  const budget = Math.min(
    IMAGE_APPEAR_CEILING_MS,
    Math.max(15_000, remainingMs(job.deadlineAt, Date.now())),
  );
  const until = Date.now() + budget;

  while (Date.now() < until) {
    const refusal = await firstMatch(page, GEMINI_SELECTORS.refusalNotice, 300);
    if (refusal !== null) {
      const text = (await refusal.textContent()) ?? "";
      // Penolakan Gemini bukan kerusakan: modelnya memang menolak permintaan
      // ini. Mencoba lagi dengan prompt yang sama akan ditolak lagi, jadi
      // pekerjaannya diserahkan ke Workers AI yang tidak punya kebijakan
      // penolakan seperti ini.
      throw new AgentRuntimeError(
        `Gemini menolak permintaan ini. ${text.slice(0, 120)}`,
        "generation_refused",
      );
    }

    await assertSessionAlive(page);

    const found = await newestImage(page, context.imageCountBefore);
    if (found !== null) {
      log(`Gambar hasil terdeteksi (${found.width}x${found.height}). Mengunduh.`);
      const outcome = await downloadImage(found, context);
      if (outcome !== null) {
        log(`Gambar hasil terunduh: ${outcome.bytes.byteLength} bita (${outcome.mimeType}).`);
        return outcome;
      }

      throw new AgentRuntimeError("Gambar hasil tidak dapat diunduh.", "selector_not_found");
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new AgentRuntimeError("Gambar belum muncul sebelum tenggat.", "timeout");
}

/**
 * Gambar hasil terbaru beserta alamatnya, ditangkap atomis.
 *
 * Alamat (`src`) dibaca PADA SAAT gambar terdeteksi, bukan saat mengunduh:
 * DOM Gemini me-render ulang respons yang sedang streaming, sehingga locator
 * yang dibaca belakangan dapat menunjuk elemen yang sudah dilepas — dan
 * itulah yang membuat unduhan gagal tepat setelah deteksi berhasil.
 *
 * Hanya elemen `generated-image` yang dihitung. Pratinjau lampiran foto
 * input (`preview-image-button`) BUKAN hasil dan tidak pernah dihitung.
 *
 * @param {import("@playwright/test").Page} page
 * @param {number} countBefore
 * @returns {Promise<{ src: string, width: number, height: number } | null>}
 */
async function newestImage(page, countBefore) {
  for (const selector of GEMINI_SELECTORS.generatedImage) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count <= countBefore) continue;

      const last = locator.nth(count - 1);
      const src = await last.getAttribute("src").catch(() => null);
      if (src === null || src.length === 0) continue;

      const size = await last
        .evaluate((el) => ({
          width: el.naturalWidth ?? 0,
          height: el.naturalHeight ?? 0,
          currentSrc: el.currentSrc ?? "",
        }))
        .catch(() => null);

      return {
        src: size?.currentSrc && size.currentSrc.length > 0 ? size.currentSrc : src,
        width: size?.width ?? 0,
        height: size?.height ?? 0,
      };
    } catch {
      // Alternatif berikutnya.
    }
  }

  return null;
}

/**
 * Mengunduh gambar hasil sebagai bita.
 *
 * Tiga jalur dicoba berurutan, dari yang paling hemat sampai yang paling
 * kasar:
 *
 *   1. Ambil `src` langsung bila sudah berupa `data:` URL. Ini jalur yang
 *      paling sering berlaku pada Gemini.
 *   2. Klik tombol unduh dan tangkap berkasnya lewat peristiwa unduhan.
 *   3. Ambil `src` apa pun dan minta halamannya yang mengambil bita.
 *
 * Jalur ketiga ada karena gambar dapat dilayani dari URL berumur pendek yang
 * menuntut cookie sesi; memintanya dari konteks peramban membawa cookie itu
 * tanpa perlu menyalinnya ke mana pun.
 *
 * Menerima ALAMAT gambar (string), bukan locator: alamat ditangkap pada saat
 * deteksi, sehingga unduhan tidak bergantung pada elemen DOM yang mungkin
 * sudah di-render ulang oleh Gemini.
 *
 * @param {{ src: string, width: number, height: number }} found
 * @param {JobDependencies & { imageCountBefore: number }} context
 * @returns {Promise<{ bytes: Uint8Array, mimeType: string } | null>}
 */
async function downloadImage(found, context) {
  const { page } = context;

  const inline = inlineDataUrl(found.src);
  if (inline !== null) return inline;

  const downloadButton = await firstMatch(page, GEMINI_SELECTORS.downloadButton, 2_000);
  if (downloadButton !== null) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 8_000 }),
        downloadButton.click(),
      ]);
      const stream = await download.createReadStream();
      /** @type {Uint8Array[]} */
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      }
      const bytes = concat(chunks);
      if (bytes.byteLength > 0) {
        return { bytes, mimeType: mimeFromBytes(bytes) };
      }
    } catch {
      // Tombol unduh tidak membawa hasil. Jatuh ke jalur berikutnya.
    }
  }

  return fetchViaPage(found.src, page);
}

/**
 * @param {string} source
 * @returns {{ bytes: Uint8Array, mimeType: string } | null}
 */
function inlineDataUrl(source) {
  if (!source.startsWith("data:")) return null;

  const commaAt = source.indexOf(",");
  if (commaAt < 0) return null;

  const header = source.slice(5, commaAt);
  const payload = source.slice(commaAt + 1);
  const mimeType = header.split(";")[0] || "image/png";

  const bytes = header.includes("base64")
    ? Buffer.from(payload, "base64")
    : new TextEncoder().encode(decodeURIComponent(payload));

  return bytes.byteLength > 0 ? { bytes: new Uint8Array(bytes), mimeType } : null;
}

/**
 * @param {string} source
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ bytes: Uint8Array, mimeType: string } | null>}
 */
async function fetchViaPage(source, page) {
  if (source.length === 0) return null;

  const encoded = await page
    .evaluate(async (url) => {
      const response = await fetch(url);
      if (!response.ok) return null;
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }, source)
    .catch(() => null);

  if (encoded === null) return null;

  const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
  return bytes.byteLength > 0 ? { bytes, mimeType: mimeFromBytes(bytes) } : null;
}

/**
 * @param {readonly Uint8Array[]} chunks
 * @returns {Uint8Array}
 */
function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Menentukan MIME dari magic bytes, bukan dari apa yang dikatakan halaman.
 *
 * Daftar yang sama dengan `IMAGE_MAGIC_BYTES` di lib/schemas.ts. Nilai yang
 * tidak dikenal dikembalikan sebagai PNG dan akan ditolak server saat
 * konfirmasi — lebih baik ditolak di sana, dengan pesan yang sudah
 * disiapkan, daripada diterima lalu merusak katalog.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function mimeFromBytes(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return "image/png";
}

/**
 * Ekstensi berkas dari MIME. Dipakai untuk membentuk kunci R2.
 *
 * @param {string} mimeType
 * @returns {string}
 */
function extensionFor(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

/**
 * Mengunggah hasil dan menandai pekerjaan selesai.
 *
 * Urutannya mengikuti kontrak API bagian 5 dan 8 persis, dan urutan itu
 * penting: mengunggah lebih dulu, melaporkan selesai kemudian. Melaporkan
 * selesai sebelum berkasnya ada di penyimpanan akan menghasilkan pekerjaan
 * berstatus sukses dengan gambar yang tidak dapat dibuka.
 *
 * @param {import("./worker.js").AgentJob} job
 * @param {{ bytes: Uint8Array, mimeType: string }} outcome
 * @param {JobDependencies} dependencies
 * @returns {Promise<string>}
 */
export async function reportSuccess(job, outcome, dependencies) {
  const { client, log } = dependencies;
  const startedAt = Date.now();

  const uploadPlan = await client.post(`/products/${job.productId}/media/upload-url`, {
    kind: "photo_studio",
    mimeType: outcome.mimeType,
    bytes: outcome.bytes.byteLength,
  });

  const uploadUrl = uploadPlan.uploadUrl;
  const mediaId = uploadPlan.mediaId;
  if (typeof uploadUrl !== "string" || typeof mediaId !== "string") {
    throw new AgentRuntimeError(
      "Server tidak mengembalikan alamat unggah yang lengkap.",
      "unknown",
    );
  }

  // Kontrak API bagian 5: `PUT` biner langsung ke uploadUrl, lalu
  // `POST .../confirm`. Langkah konfirmasi memeriksa magic bytes; berkas
  // yang isinya bukan gambar ditolak di sana dengan CONTENT_MISMATCH.
  await client.putBinary(uploadUrl, outcome.bytes, outcome.mimeType);

  await client.post(`/products/${job.productId}/media/${mediaId}/confirm`, {});

  const r2Key = buildStudioKey(job.productId, job.id, outcome.mimeType);

  await client.post(`/agent/jobs/${job.id}/complete`, {
    r2Key,
    durationMs: Date.now() - startedAt,
  });

  log(`Pekerjaan ${job.id} selesai. Hasil diunggah sebagai aset baru.`);
  return r2Key;
}

/**
 * Kunci objek hasil studio.
 *
 * Dibentuk di sisi agen karena `POST /agent/jobs/:jobId/complete` menerima
 * `r2Key` sementara `upload-url` hanya mengembalikan `mediaId`. Nilai ini
 * hanya dipakai untuk melaporkan; yang menentukan letak berkas sebenarnya
 * adalah tanda tangan pada `uploadUrl`.
 *
 * @param {string} productId
 * @param {string} jobId
 * @param {string} mimeType
 * @returns {string}
 */
function buildStudioKey(productId, jobId, mimeType) {
  return `products/${productId}/studio-${jobId}.${extensionFor(mimeType)}`;
}

/**
 * Melaporkan kegagalan.
 *
 * Selalu dipanggil sebelum agen menyerah pada sebuah pekerjaan. P3
 * menyebutnya jebakan: "keluar tanpa mengirim status kegagalan ke server".
 * Pekerjaan yang tidak dilaporkan gagal akan tetap berstatus `running`
 * sampai batas waktunya habis, dan selama itu penyedia cadangan tidak
 * menyentuhnya. TC-SA-06.
 *
 * @param {import("./worker.js").AgentJob} job
 * @param {unknown} error
 * @param {JobDependencies} dependencies
 * @returns {Promise<string>}
 */
export async function reportFailure(job, error, dependencies) {
  const { client, log } = dependencies;
  const reason = reasonFromFailure(error);

  try {
    await client.post(`/agent/jobs/${job.id}/fail`, {
      reason,
      // Durasi diukur sejak pekerjaan dipegang, bukan sejak agen hidup.
      // `deadlineAt` adalah tenggat yang diberikan server saat klaim.
      durationMs: Math.max(0, Date.now() - job.startedAt),
    });
    log(
      `Pekerjaan ${job.id} dilaporkan gagal (${reason}). ` +
        "Pekerjaan kembali ke antrian dan diteruskan ke penyedia cadangan.",
    );
  } catch (reportError) {
    // Kegagalan melaporkan kegagalan adalah kejadian yang berbeda, dan
    // operator perlu tahu bedanya: yang pertama berarti jalur Gemini tidak
    // bekerja, yang kedua berarti Worker tidak terjangkau sama sekali.
    const detail =
      reportError instanceof ApiRequestError
        ? `server menolak dengan ${reportError.failure?.code ?? reportError.status}`
        : "Worker tidak terjangkau";
    log(
      `Pekerjaan ${job.id} tidak dapat dilaporkan gagal: ${detail}. ` +
        "Pekerjaan akan dikembalikan ke antrian oleh batas waktu server.",
    );
  }

  return reason;
}

/**
 * Mengambil dan mengerjakan satu pekerjaan.
 *
 * Mengembalikan `true` bila ada pekerjaan yang dikerjakan, sehingga `index.js`
 * tahu apakah perlu segera memeriksa antrian lagi atau menunggu.
 *
 * @param {JobDependencies} dependencies
 * @returns {Promise<boolean>}
 */
export async function processOneJob(dependencies) {
  const { client, log } = dependencies;

  const claim = await client.post("/agent/jobs/claim", {
    agentId: dependencies.agentId,
    max: 1,
  });

  const jobs = claim.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return false;

  const job = parseJob(jobs[0]);
  if (job === null) {
    log("Server mengembalikan pekerjaan dengan bentuk yang tidak dikenal. Dilewati.");
    return false;
  }

  if (isExpired(job, Date.now())) {
    await reportFailure(
      job,
      new AgentRuntimeError("Tenggat sudah lewat saat pekerjaan diterima.", "timeout"),
      dependencies,
    );
    dependencies.onFinished?.("failed");
    return true;
  }

  try {
    const outcome = await generateInGemini(job, dependencies);
    await reportSuccess(job, outcome, dependencies);
    dependencies.onFinished?.("succeeded");
  } catch (error) {
    await reportFailure(job, error, dependencies);
    dependencies.onFinished?.("failed");
  }

  return true;
}

/**
 * Mengubah respons klaim menjadi pekerjaan yang bertipe.
 *
 * Bidang yang hilang menghasilkan `null`, bukan nilai bawaan yang dikarang.
 * `deadlineAt` khususnya: pekerjaan tanpa tenggat akan berjalan tanpa batas,
 * dan itu justru yang dicegah oleh seluruh rancangan ini.
 *
 * @param {unknown} value
 * @returns {import("./worker.js").AgentJob | null}
 */
export function parseJob(value) {
  if (typeof value !== "object" || value === null) return null;

  const candidate = /** @type {Record<string, unknown>} */ (value);
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.productId !== "string" ||
    typeof candidate.prompt !== "string" ||
    typeof candidate.deadlineAt !== "number"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    productId: candidate.productId,
    sourceImageUrl:
      typeof candidate.sourceImageUrl === "string" ? candidate.sourceImageUrl : null,
    prompt: candidate.prompt,
    deadlineAt: candidate.deadlineAt,
    // Waktu klaim dicatat di sisi agen. Kontrak hanya mengirim tenggat, bukan
    // waktu mulai, sedangkan `POST /agent/jobs/:jobId/fail` menuntut
    // `durationMs`. Mengukur dari waktu klaim adalah satu-satunya titik yang
    // tersedia di sisi agen dan tidak mengarang data dari server.
    startedAt: Date.now(),
  };
}
