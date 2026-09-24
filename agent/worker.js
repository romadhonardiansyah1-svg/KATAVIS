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
  let attachedBytes = 0;
  let attached = false;
  try {
    const imageBytes = await dependencies.client.getBinary(`/agent/jobs/${job.id}/source-image`);
    if (imageBytes !== null && imageBytes.byteLength > 0) {
      attachedBytes = imageBytes.byteLength;
      tempFile = resolve(tmpdir(), `katavis-source-${job.id}.png`);
      writeFileSync(tempFile, imageBytes);
      log(`Foto asli produk diambil dari server: ${attachedBytes} bita.`);

      const blobsBefore = await page
        .locator('img[src^="blob:"]')
        .count()
        .catch(() => 0);
      log("Melampirkan foto asli produk ke Gemini web...");

      // Buka menu unggah agar kolom berkas terpasang di DOM, lalu isi
      // input KHUSUS gambar (accept gambar). Input dokumen (.first())
      // menerima berkas tanpa galat tetapi foto tidak pernah menempel.
      const uploadBtn = page
        .locator('button[aria-label*="Upload" i], button[aria-label*="Unggah" i]')
        .first();
      if ((await uploadBtn.count()) > 0) {
        await uploadBtn.click().catch(() => undefined);
      }
      const imageInput = page
        .locator(GEMINI_SELECTORS.imageFileInput[0] ?? 'input[accept*="image"]')
        .first();
      try {
        await imageInput.waitFor({ state: "attached", timeout: 5_000 });
        await imageInput.setInputFiles(tempFile);
      } catch {
        // Kolom tidak muncul; verifikasi pratinjau di bawah yang menentukan.
      }

      await page.waitForTimeout(2500);
      const blobsAfter = await page
        .locator('img[src^="blob:"]')
        .count()
        .catch(() => blobsBefore);
      attached = blobsAfter > blobsBefore;
      if (attached) {
        log(`Foto asli produk berhasil dilampirkan ke Gemini (pratinjau tampil).`);
      } else {
        log(
          "Peringatan: pratinjau lampiran tidak terdeteksi di chat. " +
            "Foto mungkin tetap terlampir; melanjutkan dengan prompt teks.",
        );
      }
    } else {
      log("Peringatan: foto asli tidak tersedia di server. Melanjutkan dengan prompt teks.");
    }
  } catch (err) {
    log(`Peringatan lampiran foto: ${err instanceof Error ? err.message : String(err)}`);
  }

  const serverPrompt = job.prompt.trim();
  // `attached` (pratinjau tampil), bukan sekadar berkas tertulis, yang
  // menentukan bingkai prompt: aturan pelestarian hanya benar bila foto
  // benar-benar ada di chat. Tanpa foto terverifikasi, prompt server dipakai
  // apa adanya agar model tidak diperintah mengedit lampiran yang tak ada.
  const promptText =
    attached
      ? `Edit foto produk yang saya lampirkan. Arah kreatif: ${serverPrompt.length > 0 ? serverPrompt : "foto katalog studio yang menarik dan estetik"}.

ATURAN MUTLAK:
- Produk utama adalah SATU-SATUNYA objek di foto hasil. Hapus semua objek lain, tangan, kemasan berlebih, atau gangguan di sekitar produk.
- Pertahankan produk 100% persis seperti di foto lampiran: bentuk, warna, tekstur bahan, ukuran relatif, dan seluruh detailnya. Jangan menggambar ulang produk menjadi barang lain.
- Tanpa teks, tanpa watermark, tanpa objek tambahan.`
      : serverPrompt.length > 0
        ? serverPrompt
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

  const sendButton = await firstMatch(page, GEMINI_SELECTORS.sendButton, 8_000);
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
  let rounds = 0;

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

    // Pemeriksaan sesi (probe ~2 detik) tidak perlu setiap putaran 500 ms;
    // setiap putaran keempat cukup untuk mendeteksi sesi yang mati tanpa
    // memperlambat deteksi gambar hasil.
    rounds += 1;
    if (rounds % 4 === 1) {
      await assertSessionAlive(page);
    }

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
 * @returns {Promise<{ selector: string, index: number, src: string, width: number, height: number } | null>}
 */
async function newestImage(page, countBefore) {
  for (const selector of GEMINI_SELECTORS.generatedImage) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count <= countBefore) continue;

      const index = count - 1;
      const last = locator.nth(index);
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
        selector,
        index,
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
 * Dua jalur, dari yang paling tepat sampai yang paling resmi:
 *
 *   1. Ambil `src` langsung bila sudah berupa `data:` URL. Ini jalur yang
 *      paling sering berlaku pada Gemini.
 *   2. Klik tombol unduh ("Download gambar ukuran penuh") dan tangkap
 *      berkasnya lewat peristiwa unduhan. Ini berkas ASLI resolusi penuh
 *      dari Gemini — bukan tangkapan layar.
 *   3. Minta halamannya mengambil bita lewat `fetch`. Bekerja untuk `blob:`
 *      maupun `https:` karena berjalan di konteks halaman yang punya cookie
 *      sesi.
 *
 * Yang SENGAJA tidak ada: tangkapan layar elemen sebagai "hasil". Dua aset
 * yang pernah tersimpan lewat jalur itu terbukti berisi BELUM tentu gambar
 * hasil — satu memuat tombol UI Gemini di dalam pikselnya (tangkapan
 * menangkap seluruh komposit kotak itu, termasuk overlay), satu lagi
 * menangkap foto input + kolom chat. Tangkapan layar tidak dapat
 * membedakan ketiganya, jadi kegagalan unduhan dikembalikan sebagai gagal
 * dan rantai fallback (Workers AI → foto asli) yang bekerja jujur.
 *
 * Menerima HASIL deteksi (alamat + selector + indeks), bukan locator:
 * alamat ditangkap pada saat deteksi, sehingga unduhan tidak bergantung
 * pada elemen DOM yang mungkin sudah di-render ulang oleh Gemini.
 *
 * @param {{ selector: string, index: number, src: string, width: number, height: number }} found
 * @param {JobDependencies & { imageCountBefore: number }} context
 * @returns {Promise<{ bytes: Uint8Array, mimeType: string } | null>}
 */
async function downloadImage(found, context) {
  const { page, log } = context;

  const inline = inlineDataUrl(found.src);
  if (inline !== null) {
    log(`Unduh via data-url: ${inline.bytes.byteLength} bita.`);
    return inline;
  }

  const downloadButton = await firstMatch(page, GEMINI_SELECTORS.downloadButton, 5_000);
  if (downloadButton !== null) {
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15_000 }),
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
        const result = { bytes, mimeType: mimeFromBytes(bytes) };
        log(`Unduh via tombol unduh: ${result.bytes.byteLength} bita (${result.mimeType}).`);
        return result;
      }
      log("Tombol unduh diklik tetapi berkasnya kosong.");
    } catch (err) {
      log(
        `Tombol unduh tidak membawa hasil: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}.`,
      );
    }
  } else {
    log("Tombol unduh tidak ditemukan di halaman.");
  }

  const fetched = await fetchViaPage(found.src, page, log).catch((err) => {
    log(`Fetch halaman gagal: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}.`);
    return null;
  });
  if (fetched !== null && fetched.bytes.byteLength > 0) {
    log(`Unduh via fetch halaman: ${fetched.bytes.byteLength} bita (${fetched.mimeType}).`);
    return fetched;
  }

  log("Seluruh jalur unduhan gagal. Pekerjaan diserahkan ke penyedia cadangan.");
  return null;
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
 * @param {(line: string) => void} log
 * @returns {Promise<{ bytes: Uint8Array, mimeType: string } | null>}
 */
async function fetchViaPage(source, page, log) {
  if (source.length === 0) {
    log("Fetch halaman dilewati: alamat gambar kosong.");
    return null;
  }

  const encoded = await page
    .evaluate(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return { error: `status ${response.status}` };
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) return { error: "badan kosong" };
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return { data: btoa(binary) };
      } catch (err) {
        return { error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
      }
    }, source)
    .catch((err) => ({ error: `evaluate: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` }));

  if (encoded === null || typeof encoded !== "object" || !("data" in encoded)) {
    const reason =
      encoded !== null && typeof encoded === "object" && "error" in encoded
        ? String(encoded.error)
        : "tidak diketahui";
    log(`Fetch halaman gagal: ${reason}.`);
    return null;
  }

  const payload = encoded.data;
  if (typeof payload !== "string") {
    log("Fetch halaman gagal: badan bukan teks.");
    return null;
  }

  const bytes = new Uint8Array(Buffer.from(payload, "base64"));
  return bytes.byteLength > 0 ? { bytes, mimeType: mimeFromBytes(bytes) } : null;
}

/**
 * Dihapus: tangkapan layar elemen sebagai "hasil" (dihentikan Sep 2026).
 *
 * Dua aset yang tersimpan lewat jalur ini terbukti BUKAN gambar hasil:
 * satu memuat tombol UI Gemini di dalam pikselnya (tangkapan menangkap
 * seluruh komposit kotak itu termasuk overlay), satu lagi menangkap foto
 * input + kolom chat. Tangkapan layar tidak dapat membedakan ketiganya,
 * sehingga kegagalan unduhan sekarang dikembalikan sebagai gagal dan rantai
 * fallback (Workers AI → foto asli) bekerja dengan jujur.
 */

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
 * Mengunggah hasil dan menandai pekerjaan selesai.
 *
 * Urutannya mengikuti kontrak API bagian 8 persis, dan urutan itu
 * penting: mengunggah lebih dulu, melaporkan selesai kemudian. Melaporkan
 * selesai sebelum berkasnya ada di penyimpanan akan menghasilkan pekerjaan
 * berstatus sukses dengan gambar yang tidak dapat dibuka.
 *
 * Rute yang dipakai adalah rute AGEN (`/agent/jobs/:jobId/...`), bukan rute
 * sesi: agen hanya memegang `X-Agent-Key`, dan rute sesi selalu menolaknya
 * dengan 401.
 *
 * @param {import("./worker.js").AgentJob} job
 * @param {{ bytes: Uint8Array, mimeType: string }} outcome
 * @param {JobDependencies} dependencies
 * @returns {Promise<string>}
 */
export async function reportSuccess(job, outcome, dependencies) {
  const { client, log } = dependencies;
  const startedAt = Date.now();

  const uploadPlan = await client.post(`/agent/jobs/${job.id}/upload-url`, {
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

  // Kontrak API bagian 8: `PUT` biner langsung ke uploadUrl, lalu
  // `POST .../confirm-upload`. Langkah konfirmasi memeriksa magic bytes;
  // berkas yang isinya bukan gambar ditolak di sana dengan CONTENT_MISMATCH.
  await client.putBinary(uploadUrl, outcome.bytes, outcome.mimeType);

  const confirmed = await client.post(`/agent/jobs/${job.id}/confirm-upload`, { mediaId });
  const r2Key = confirmed.r2Key;
  if (typeof r2Key !== "string" || r2Key.length === 0) {
    throw new AgentRuntimeError(
      "Server tidak mengembalikan kunci hasil yang lengkap.",
      "unknown",
    );
  }

  await client.post(`/agent/jobs/${job.id}/complete`, {
    r2Key,
    durationMs: Date.now() - startedAt,
  });

  log(`Pekerjaan ${job.id} selesai. Hasil diunggah sebagai aset baru.`);
  return r2Key;
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
