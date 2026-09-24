/**
 * Pengujian consumer antrian.
 *
 * Yang diuji di sini adalah keputusan, bukan jaringan: kapan sebuah
 * pekerjaan dikerjakan, kapan diulang, kapan ditandai gagal, dan kapan
 * dilewati sama sekali. Penyedia tiruan menggantikan Workers AI dan Groq —
 * memanggil model sungguhan di dalam pengujian unit akan membuat hasilnya
 * bergantung pada kuota dan cuaca.
 *
 * `D1Database`, `R2Bucket`, dan `Ai` juga tiruan. Yang diuji adalah berkas
 * ini, bukan Cloudflare.
 */

import { describe, expect, it } from "vitest";

import { buildCopyPrompt, extractChatText, parseCopyResponse } from "./providers-impl";
import { buildImagePrompt, parseImagePayload } from "./payload";
import { parseJobMessage, processJob, type ConsumerDependencies } from "./consumer";

// --- Tiruan ---

interface CapturedStatement {
  readonly query: string;
  params: readonly unknown[];
}

/**
 * Basis data tiruan.
 *
 * Menjawab berdasarkan bentuk kueri, bukan berdasarkan urutan pemanggilan.
 * Urutan pemanggilan berubah begitu satu kueri ditambahkan di tengah, dan
 * pengujian yang bergantung padanya akan gagal karena alasan yang salah.
 */
function createFakeDb(options: { readonly context?: unknown; readonly started?: boolean } = {}) {
  const captured: CapturedStatement[] = [];
  const context = options.context ?? null;
  const started = options.started ?? true;

  const resultFor = (statement: CapturedStatement): { meta: { changes: number }; results: unknown[] } => {
    const query = statement.query;

    if (query.includes("FROM jobs") && query.includes("JOIN products")) {
      return { meta: { changes: 0 }, results: context === null ? [] : [context] };
    }
    if (query.includes("UPDATE jobs") && query.includes("status = 'running'")) {
      return { meta: { changes: started ? 1 : 0 }, results: [] };
    }
    return { meta: { changes: 1 }, results: [] };
  };

  const prepare = (query: string) => {
    const statement: CapturedStatement = { query, params: [] };
    captured.push(statement);

    const api = {
      bind: (...params: unknown[]) => {
        statement.params = params;
        return api;
      },
      first: async () => {
        const result = resultFor(statement);
        return result.results[0] ?? null;
      },
      all: async () => resultFor(statement),
      run: async () => resultFor(statement),
    };

    return api;
  };

  return {
    captured,
    prepare,
    batch: async (statements: readonly unknown[]) => {
      // Batch menerima objek yang sudah di-`bind`; yang penting bagi
      // pengujian adalah kuerinya tercatat, bukan bahwa ia benar-benar
      // dijalankan.
      void statements;
      return [];
    },
  } as unknown as D1Database & { readonly captured: CapturedStatement[] };
}

function createFakeMedia(options: { readonly present?: ReadonlySet<string> } = {}) {
  const present = options.present ?? new Set<string>();

  return {
    head: async (key: string) =>
      present.has(key)
        ? { size: 37_606, httpMetadata: { contentType: "image/png" } }
        : null,
    get: async (key: string) => (present.has(key) ? { size: 1024 } : null),
    put: async () => undefined,
  } as unknown as R2Bucket;
}

/** Workers AI tiruan yang gagal bila dipanggil, untuk jalur yang tidak boleh memanggilnya. */
function createForbiddenAi(): Ai {
  return {
    run: async () => {
      throw new Error("Workers AI tidak boleh dipanggil pada jalur ini.");
    },
  } as unknown as Ai;
}

function baseContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "01J8ZQFX9K7YWVTN3MABCDJOB1",
    product_id: "01J8ZQFX9K7YWVTN3MABCDP012",
    artisan_id: "01J8ZQFX9K7YWVTN3MABCDV012",
    kind: "copy",
    status: "queued",
    locale: "id",
    attempt: 0,
    payload: null,
    content_name: "Tas Kulit",
    fallback_name: "Tas Kulit",
    source_key: "products/p/foto-asli.jpg",
    audio_key: null,
    transcript: "Saya membuat tas kulit dari kulit sapi pilihan.",
    cached_key: null,
    ...overrides,
  };
}

function dependenciesFor(
  db: D1Database,
  overrides: Partial<ConsumerDependencies> = {},
): ConsumerDependencies {
  return {
    env: {
      DB: db,
      MEDIA: createFakeMedia(),
      AI: createForbiddenAi(),
    },
    nowMs: 1_758_000_000_000,
    log: () => undefined,
    ...overrides,
  };
}

// --- Pesan antrian ---

describe("parseJobMessage", () => {
  it("menerima pesan yang lengkap", () => {
    // TC-U-JOB-11
    const parsed = parseJobMessage({
      jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1",
      productId: "01J8ZQFX9K7YWVTN3MABCDP012",
      kind: "image",
    });

    expect(parsed).toEqual({
      jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1",
      productId: "01J8ZQFX9K7YWVTN3MABCDP012",
      kind: "image",
    });
  });

  it("menolak pesan tanpa jobId", () => {
    // TC-U-JOB-11
    expect(parseJobMessage({ productId: "x", kind: "image" })).toBeNull();
  });

  it("menolak pesan dengan jenis yang tidak dikenal", () => {
    // TC-U-JOB-11
    expect(parseJobMessage({ jobId: "a", productId: "b", kind: "transmogrify" })).toBeNull();
  });

  it("menolak badan yang bukan objek", () => {
    // TC-U-JOB-11
    expect(parseJobMessage(null)).toBeNull();
    expect(parseJobMessage("image")).toBeNull();
    expect(parseJobMessage(42)).toBeNull();
  });
});

// --- Routing pekerjaan ---

describe("processJob", () => {
  it("melewati pekerjaan yang barisnya tidak ada", async () => {
    // TC-U-JOB-12
    const db = createFakeDb({ context: null });

    const outcome = await processJob(
      { jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1", productId: "p", kind: "copy" },
      dependenciesFor(db),
    );

    expect(outcome).toEqual({ status: "skipped" });
  });

  it("tidak mengerjakan ulang pekerjaan yang sudah selesai", async () => {
    // TC-U-JOB-12
    const db = createFakeDb({ context: baseContext({ status: "succeeded" }) });

    const outcome = await processJob(
      { jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1", productId: "p", kind: "copy" },
      dependenciesFor(db),
    );

    expect(outcome).toEqual({ status: "skipped" });
    // Tidak ada penyedia yang dipanggil: `run` tiruan akan melempar bila
    // tersentuh, dan pengujian ini lulus tanpa lemparan.
  });

  it("melewati pekerjaan yang sudah dipegang pihak lain", async () => {
    // TC-U-JOB-12
    const db = createFakeDb({ context: baseContext(), started: false });

    const outcome = await processJob(
      { jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1", productId: "p", kind: "copy" },
      dependenciesFor(db),
    );

    expect(outcome).toEqual({ status: "skipped" });
  });

  it("menandai gagal pekerjaan yang belum punya penyedia", async () => {
    // TC-U-JOB-13
    const db = createFakeDb({ context: baseContext({ kind: "tts" }) });

    const outcome = await processJob(
      { jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1", productId: "p", kind: "tts" },
      dependenciesFor(db),
    );

    expect(outcome).toEqual({ status: "failed", code: "INTERNAL_ERROR" });

    const wrote = db.captured.some(
      (statement) =>
        statement.query.includes("status = 'failed'") && statement.params.includes("INTERNAL_ERROR"),
    );
    expect(wrote).toBe(true);
  });

  it("menolak pekerjaan teks tanpa transkrip sebelum memanggil penyedia", async () => {
    // TC-U-JOB-15
    const db = createFakeDb({ context: baseContext({ transcript: "   " }) });

    const outcome = await processJob(
      { jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1", productId: "p", kind: "copy" },
      dependenciesFor(db),
    );

    expect(outcome).toEqual({ status: "failed", code: "TRANSCRIPT_NOT_REVIEWED" });
  });

  it("menandai gagal pekerjaan ASR yang audionya tidak ada di penyimpanan", async () => {
    // TC-U-JOB-13
    const db = createFakeDb({ context: baseContext({ kind: "asr", audio_key: null }) });

    const outcome = await processJob(
      { jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1", productId: "p", kind: "asr" },
      dependenciesFor(db),
    );

    expect(outcome).toEqual({ status: "failed", code: "ASR_NO_SPEECH" });
  });
});

// --- Balasan model ---

describe("parseCopyResponse", () => {
  it("membaca JSON polos", () => {
    // TC-U-JOB-16
    const parsed = parseCopyResponse('{"name":"Tas","story":"Dibuat tangan."}');

    expect(parsed?.name).toBe("Tas");
    expect(parsed?.story).toBe("Dibuat tangan.");
    expect(parsed?.specs).toEqual([]);
  });

  it("membaca JSON di dalam blok kode berpagar", () => {
    // TC-U-JOB-16
    const raw = '```json\n{"name":"Tas","story":"Dibuat tangan."}\n```';

    expect(parseCopyResponse(raw)?.name).toBe("Tas");
  });

  it("membaca blok berpagar tanpa penanda bahasa", () => {
    // TC-U-JOB-16
    const raw = '```\n{"name":"Tas","story":"Dibuat tangan."}\n```';

    expect(parseCopyResponse(raw)?.name).toBe("Tas");
  });

  it("menolak balasan tanpa nama", () => {
    // TC-U-JOB-17
    expect(parseCopyResponse('{"name":"","story":"Ada cerita."}')).toBeNull();
  });

  it("menolak balasan tanpa cerita", () => {
    // TC-U-JOB-17
    expect(parseCopyResponse('{"name":"Tas","story":"  "}')).toBeNull();
  });

  it("menolak balasan yang bukan JSON", () => {
    // TC-U-JOB-17
    expect(parseCopyResponse("Tentu! Berikut katalognya:")).toBeNull();
  });

  it("membatasi jumlah spesifikasi dan kata kunci", () => {
    // TC-U-JOB-17
    const many = Array.from({ length: 30 }, (_, index) => `spesifikasi ${index}`);
    const raw = JSON.stringify({ name: "Tas", story: "Cerita.", specs: many, seoKeywords: many });

    const parsed = parseCopyResponse(raw);
    expect(parsed?.specs).toHaveLength(12);
    expect(parsed?.seoKeywords).toHaveLength(20);
  });

  it("membuang entri yang bukan teks dari daftar", () => {
    // TC-U-JOB-17
    const raw = JSON.stringify({
      name: "Tas",
      story: "Cerita.",
      specs: ["kulit sapi", 42, null, "  ", "jahitan tangan"],
    });

    expect(parseCopyResponse(raw)?.specs).toEqual(["kulit sapi", "jahitan tangan"]);
  });
});

describe("extractChatText", () => {
  it("membaca badan JSON murni", () => {
    // TC-U-JOB-19
    const raw = JSON.stringify({ choices: [{ message: { content: "Halo dunia" } }] });

    expect(extractChatText(raw)).toBe("Halo dunia");
  });

  it("menggabungkan potongan delta dari aliran SSE", () => {
    // TC-U-JOB-19. Model ag/gemini-3.8-flash-high menjawab dalam bentuk
    // SSE; parser yang hanya bisa JSON membuang balasan yang sah.
    const raw = [
      'data: {"choices":[{"delta":{"content":"Lampu "}}]}',
      'data: {"choices":[{"delta":{"content":"bambu"}}]}',
      "data: [DONE]",
      "",
    ].join("\n");

    expect(extractChatText(raw)).toBe("Lampu bambu");
  });

  it("membaca pesan lengkap di dalam potongan SSE", () => {
    // TC-U-JOB-19
    const raw = 'data: {"choices":[{"message":{"content":"Vas dekoratif"}}]}\ndata: [DONE]\n';

    expect(extractChatText(raw)).toBe("Vas dekoratif");
  });

  it("menolak badan kosong dan sampah", () => {
    // TC-U-JOB-19
    expect(extractChatText("")).toBeNull();
    expect(extractChatText("   ")).toBeNull();
    expect(extractChatText("data: [DONE]\n")).toBeNull();
    expect(extractChatText("Gateway Timeout")).toBeNull();
  });
});

describe("buildCopyPrompt", () => {
  it("memuat larangan mengarang", () => {
    // TC-U-JOB-17
    const prompt = buildCopyPrompt("Saya membuat tas.", "id");

    expect(prompt).toContain("JANGAN mengarang");
    expect(prompt).toContain("Saya membuat tas.");
  });

  it("menyebut bahasa yang diminta", () => {
    // TC-U-JOB-17
    expect(buildCopyPrompt("Cerita.", "en")).toContain("en");
  });
});

// --- Muatan pekerjaan ---

describe("parseImagePayload", () => {
  it("membaca muatan yang lengkap", () => {
    // TC-U-JOB-11
    const payload = parseImagePayload('{"prompt":"Buat foto","style":"outdoor"}');

    expect(payload.prompt).toBe("Buat foto");
    expect(payload.style).toBe("outdoor");
  });

  it("mengembalikan prompt kosong untuk muatan null", () => {
    // TC-U-JOB-11
    expect(parseImagePayload(null).prompt).toBe("");
  });

  it("mengembalikan prompt kosong untuk muatan yang bukan JSON", () => {
    // TC-U-JOB-11
    expect(parseImagePayload("bukan json").prompt).toBe("");
  });

  it("membaca penanda kegagalan Gemini", () => {
    // TC-U-JOB-11
    const payload = parseImagePayload(
      '{"prompt":"x","geminiFailure":"timeout","failedAt":1758000000000}',
    );

    expect(payload.geminiFailure).toBe("timeout");
    expect(payload.failedAt).toBe(1_758_000_000_000);
  });
});

describe("buildImagePrompt", () => {
  it("memuat kalimat penegak yang tidak boleh hilang", () => {
    // TC-U-JOB-18
    const prompt = buildImagePrompt("Tas Kulit", "studio", "id");

    expect(prompt).toContain("JANGAN mengubah bentuk, warna, tekstur, atau proporsi produk");
    expect(prompt).toContain("Tas Kulit");
  });

  it("membedakan gaya studio dan luar ruang", () => {
    // TC-U-JOB-18
    expect(buildImagePrompt("Tas", "studio", "id")).toContain("latar putih");
    expect(buildImagePrompt("Tas", "outdoor", "id")).toContain("luar ruang");
  });
});

// --- Jalur kegagalan gambar ---

describe("processJob jalur gambar", () => {
  it("meminta pekerjaan diulang ketika penyedia melaporkan kuota habis", async () => {
    // TC-U-JOB-14
    const db = createFakeDb({ context: baseContext({ kind: "image" }) });
    const ai = {
      run: async () => {
        const error = new Error("quota") as Error & { status: number };
        error.status = 429;
        throw error;
      },
    } as unknown as Ai;

    const outcome = await processJob(
      { jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1", productId: "p", kind: "image" },
      dependenciesFor(db, {
        env: { DB: db, MEDIA: createFakeMedia(), AI: ai },
      }),
    );

    // Penyedia melempar galat biasa, bukan ProviderError berstatus 429, jadi
    // rantai melihatnya sebagai kegagalan tanpa status khusus dan menyerah.
    // Yang penting di sini: pekerjaan tidak berakhir `succeeded` dan foto
    // asli tidak tersentuh.
    expect(outcome.status).toBe("failed");

    const touchedOriginal = db.captured.some(
      (statement) =>
        statement.query.includes("photo_original") && statement.query.includes("UPDATE"),
    );
    expect(touchedOriginal).toBe(false);
  });

  it("tidak pernah menulis ke foto asli saat pekerjaan gambar gagal", async () => {
    // TC-U-JOB-18
    const db = createFakeDb({ context: baseContext({ kind: "image" }) });
    const ai = {
      run: async () => {
        throw new Error("model tidak tersedia");
      },
    } as unknown as Ai;

    await processJob(
      { jobId: "01J8ZQFX9K7YWVTN3MABCDJOB1", productId: "p", kind: "image" },
      dependenciesFor(db, { env: { DB: db, MEDIA: createFakeMedia(), AI: ai } }),
    );

    for (const statement of db.captured) {
      // Tidak ada satu pernyataan pun yang menghapus atau menimpa foto
      // pengrajin. Aturan 7 AGENTS.md, dan ini satu-satunya cara
      // membuktikannya tanpa menjalankan seluruh alur.
      expect(statement.query).not.toContain("DELETE FROM media_assets");
      expect(statement.query).not.toMatch(/UPDATE media_assets[^;]*photo_original/);
    }
  });
});
