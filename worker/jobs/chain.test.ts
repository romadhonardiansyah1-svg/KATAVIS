/**
 * Kasus uji modul jobs — TC-U-JOB-01 sampai TC-U-JOB-10.
 *
 * Sumber: docs/testing/TEST-PLAN.md bagian 3 dan aturan pengikat prompt P2
 * di docs/ops/MODEL-ROUTING.md.
 *
 * Seluruh kasus berjalan tanpa basis data dan tanpa jaringan: penyedia di
 * sini adalah objek biasa. Yang diuji bukan panggilan HTTP-nya, melainkan
 * perilaku rantai saat penyedia berhasil, melempar, melambat, atau menjawab
 * terlambat — bagian yang paling sulit dipercaya kalau hanya diuji manual
 * saat demo.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { FORBIDDEN_MESSAGE_TERMS, type ApiErrorBody } from "../../lib/errors";
import { LIMITS, type Locale } from "../../lib/schemas";

import {
  failureResponse,
  imageChainSteps,
  transcriptionChainSteps,
  runPerLocale,
  runProviderChain,
  textChainSteps,
  type JobFailure,
} from "./chain";
import { canRetryJob, canTransition, isTerminal } from "./lifecycle";
import {
  ProviderError,
  type Content,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
  type ProviderId,
  type TextProvider,
  type TranscriptionProvider,
} from "./providers";

const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDEFGQ";

/**
 * Batas waktu lapis 2 dan 3 belum diukur; ARCHITECTURE bagian 4 menuntut
 * pengukuran ulang setelah implementasi. Angkanya ditetapkan masing-masing
 * penyedia, jadi di sini cukup angka yang tidak akan pernah tercapai.
 */
const FALLBACK_TIMEOUT_MS = 30_000;

const IMAGE_REQUEST: Omit<ImageRequest, "signal"> = {
  productId: PRODUCT_ID,
  sourceImageUrl: `https://media.example/products/${PRODUCT_ID}/asli.jpg`,
  stylePrompt: "marble_light",
};

afterEach(() => {
  vi.useRealTimers();
});

// --- Alat bantu ---

interface Deferred<TValue> {
  readonly promise: Promise<TValue>;
  readonly settle: (value: TValue) => void;
}

function deferred<TValue>(): Deferred<TValue> {
  let settle: (value: TValue) => void = () => {};
  const promise = new Promise<TValue>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

function imageResult(
  r2Key: string,
  provider: ProviderId,
  durationMs = 1,
): ImageResult {
  return { r2Key, provider, durationMs };
}

function content(locale: Locale, provider: ProviderId): Content {
  return {
    name: `Nama ${locale}`,
    story: `Cerita ${locale}`,
    provider,
    durationMs: 1_200,
  };
}

interface SucceedingImageOptions {
  readonly r2Key: string;
  readonly durationMs?: number;
  readonly timeoutMs?: number;
}

function succeedingImageProvider(
  id: ProviderId,
  options: SucceedingImageOptions,
): ImageProvider {
  return {
    id,
    timeoutMs: options.timeoutMs ?? FALLBACK_TIMEOUT_MS,
    generate: async () => imageResult(options.r2Key, id, options.durationMs ?? 1),
  };
}

function failingImageProvider(id: ProviderId, error: unknown): ImageProvider {
  return {
    id,
    timeoutMs: FALLBACK_TIMEOUT_MS,
    generate: async () => {
      throw error;
    },
  };
}

/** Membungkus penyedia agar urutan pemanggilan dapat diperiksa. */
function recording(provider: ImageProvider, calls: ProviderId[]): ImageProvider {
  return {
    ...provider,
    generate: (request) => {
      calls.push(provider.id);
      return provider.generate(request);
    },
  };
}

interface ControlledImageProvider {
  readonly provider: ImageProvider;
  /** Signal yang diterima penyedia, untuk memastikan ia benar-benar dibatalkan. */
  readonly signals: AbortSignal[];
  readonly settle: (result: ImageResult) => void;
}

/** Penyedia yang tidak pernah menjawab sampai uji memutuskan sebaliknya. */
function controlledImageProvider(
  id: ProviderId,
  timeoutMs: number,
): ControlledImageProvider {
  const result = deferred<ImageResult>();
  const signals: AbortSignal[] = [];

  return {
    provider: {
      id,
      timeoutMs,
      generate: (request) => {
        signals.push(request.signal);
        return result.promise;
      },
    },
    signals,
    settle: result.settle,
  };
}

describe("jobs — rantai fallback", () => {
  it("memakai hasil penyedia utama tanpa menyentuh fallback", async () => {
    // TC-U-JOB-01
    const calls: ProviderId[] = [];
    const gemini = recording(
      succeedingImageProvider("gemini_web", {
        r2Key: `products/${PRODUCT_ID}/studio-gemini.webp`,
        durationMs: 28_400,
        timeoutMs: LIMITS.GEMINI_TIMEOUT_MS,
      }),
      calls,
    );
    const workersAi = recording(
      succeedingImageProvider("workers_ai", {
        r2Key: `products/${PRODUCT_ID}/studio-workers.webp`,
      }),
      calls,
    );
    const cache = recording(
      succeedingImageProvider("cache", {
        r2Key: `products/${PRODUCT_ID}/studio-cache.webp`,
      }),
      calls,
    );

    const outcome = await runProviderChain(
      imageChainSteps([gemini, workersAi, cache], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.value.r2Key).toBe(`products/${PRODUCT_ID}/studio-gemini.webp`);
    expect(outcome.provider).toBe("gemini_web");
    expect(outcome.layersTried).toBe(1);
    // Lapis berikutnya tidak dipanggil sama sekali — bukan dipanggil lalu
    // dibuang. Jatah neuron gratis terlalu sedikit untuk itu.
    expect(calls).toEqual(["gemini_web"]);
  });

  it("memanggil fallback saat penyedia utama melempar galat", async () => {
    // TC-U-JOB-02
    const calls: ProviderId[] = [];
    const gemini = recording(
      failingImageProvider(
        "gemini_web",
        new ProviderError(500, "Selector .response-container tidak ditemukan"),
      ),
      calls,
    );
    const workersAi = recording(
      succeedingImageProvider("workers_ai", {
        r2Key: `products/${PRODUCT_ID}/studio-workers.webp`,
      }),
      calls,
    );
    const cache = recording(
      succeedingImageProvider("cache", {
        r2Key: `products/${PRODUCT_ID}/studio-cache.webp`,
      }),
      calls,
    );

    const outcome = await runProviderChain(
      imageChainSteps([gemini, workersAi, cache], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.provider).toBe("workers_ai");
    expect(outcome.layersTried).toBe(2);
    expect(calls).toEqual(["gemini_web", "workers_ai"]);
  });

  it("membatalkan penyedia yang melewati 45 detik lalu memakai fallback", async () => {
    // TC-U-JOB-03
    vi.useFakeTimers();

    const gemini = controlledImageProvider("gemini_web", LIMITS.GEMINI_TIMEOUT_MS);
    const workersAi = succeedingImageProvider("workers_ai", {
      r2Key: `products/${PRODUCT_ID}/studio-workers.webp`,
    });

    const pending = runProviderChain(
      imageChainSteps([gemini.provider, workersAi], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );

    await vi.advanceTimersByTimeAsync(LIMITS.GEMINI_TIMEOUT_MS);
    const outcome = await pending;

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.provider).toBe("workers_ai");
    expect(outcome.layersTried).toBe(2);
    expect(outcome.durationMs).toBe(LIMITS.GEMINI_TIMEOUT_MS);
    // Batas waktu ditegakkan lewat AbortController, bukan sekadar berhenti
    // menunggu: penyedia yang masih berjalan harus benar-benar dimatikan.
    expect(gemini.signals[0]?.aborted).toBe(true);

    // Tanpa Studio Agent yang hidup, lapis 1 memang tidak terdaftar. Pekerjaan
    // langsung menuju Workers AI tanpa menunggu 45 detik (ARCHITECTURE
    // bagian 4, prompt P2 aturan 2).
    const withoutAgent = await runProviderChain(
      imageChainSteps([workersAi], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );
    expect(withoutAgent.ok).toBe(true);
    if (!withoutAgent.ok) return;
    expect(withoutAgent.provider).toBe("workers_ai");
    expect(withoutAgent.layersTried).toBe(1);
  });

  it("memakai lapis cache saat penyedia utama dan fallback gagal", async () => {
    // TC-U-JOB-04
    const calls: ProviderId[] = [];
    const gemini = recording(
      failingImageProvider(
        "gemini_web",
        new ProviderError(500, "Sesi Chrome kedaluwarsa"),
      ),
      calls,
    );
    const workersAi = recording(
      failingImageProvider("workers_ai", new ProviderError(502, "Model menolak")),
      calls,
    );
    const cache = recording(
      succeedingImageProvider("cache", {
        r2Key: `products/${PRODUCT_ID}/studio-cache.webp`,
      }),
      calls,
    );

    const outcome = await runProviderChain(
      imageChainSteps([gemini, workersAi, cache], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );

    expect(calls).toEqual(["gemini_web", "workers_ai", "cache"]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.provider).toBe("cache");
    expect(outcome.layersTried).toBe(3);
    expect(outcome.value.r2Key).toBe(`products/${PRODUCT_ID}/studio-cache.webp`);
  });

  it("mengembalikan galat terstruktur saat ketiga lapis gagal", async () => {
    // TC-U-JOB-05
    const gemini = failingImageProvider("gemini_web", new Error("boom"));
    const workersAi = failingImageProvider(
      "workers_ai",
      new ProviderError(503, "Jatah neuron harian habis"),
    );
    const cache = failingImageProvider("cache", new Error("Aset pra-produksi kosong"));

    const outcome = await runProviderChain(
      imageChainSteps([gemini, workersAi, cache], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );

    // Bukan lemparan mentah: pemanggil menerima nilai yang bisa diperiksa
    // dan disimpan sebagai jobs.error_code.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    // Kode khusus dari lapis yang mengenali sebabnya menang atas kode umum.
    // "Sistem sedang sibuk" lebih benar daripada "gambar gagal dibuat" bila
    // penyebabnya memang kuota.
    expect(outcome.failure.code).toBe("QUOTA_EXCEEDED");
    expect(outcome.failure.provider).toBe("cache");
    expect(outcome.failure.layersTried).toBe(3);
  });

  it("memetakan error_code ke pesan pengguna tanpa istilah teknis", async () => {
    // TC-U-JOB-06
    const failures: readonly JobFailure[] = [
      {
        code: "IMAGE_GENERATE_FAILED",
        provider: "gemini_web",
        layersTried: 3,
        diagnostic:
          "Timeout 45000ms pada net::ERR_CONNECTION_RESET; selector .x tidak ditemukan",
      },
      {
        code: "COPY_GENERATE_FAILED",
        provider: "9router",
        layersTried: 2,
        diagnostic: "HTTP 500: stack trace at nineRouter.generate (internal)",
      },
      {
        code: "RATE_LIMITED",
        provider: "workers_ai",
        layersTried: 2,
        diagnostic: "429 Too Many Requests after 3 retries",
      },
      {
        code: "QUOTA_EXCEEDED",
        provider: "workers_ai",
        layersTried: 2,
        diagnostic: "503 Service Unavailable",
      },
    ];

    for (const failure of failures) {
      const response = failureResponse(failure);
      const body = (await response.json()) as ApiErrorBody;

      expect(body.ok).toBe(false);
      expect(body.error.code).toBe(failure.code);
      expect(body.error.workSafe).toBe(true);

      // Keterangan penyedia tidak pernah ikut ke keluaran.
      expect(body.error.message).not.toContain(failure.diagnostic);

      const lowered = body.error.message.toLowerCase();
      for (const term of FORBIDDEN_MESSAGE_TERMS) {
        expect(lowered).not.toContain(term);
      }
    }
  });

  it("mengabaikan hasil yang datang setelah penyedia dibatalkan", async () => {
    // TC-U-JOB-07
    vi.useFakeTimers();

    const gemini = controlledImageProvider("gemini_web", LIMITS.GEMINI_TIMEOUT_MS);
    const workersAi = succeedingImageProvider("workers_ai", {
      r2Key: `products/${PRODUCT_ID}/studio-workers.webp`,
    });

    const pending = runProviderChain(
      imageChainSteps([gemini.provider, workersAi], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );

    await vi.advanceTimersByTimeAsync(LIMITS.GEMINI_TIMEOUT_MS);
    const outcome = await pending;

    // Gemini baru menjawab setelah batas waktu. Hasilnya harus menguap:
    // tidak menimpa hasil Workers AI, tidak muncul di mana pun.
    gemini.settle(
      imageResult(`products/${PRODUCT_ID}/studio-gemini.webp`, "gemini_web", 90_000),
    );
    await Promise.resolve();

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(gemini.signals[0]?.aborted).toBe(true);
    expect(outcome.provider).toBe("workers_ai");
    expect(outcome.value.r2Key).toBe(`products/${PRODUCT_ID}/studio-workers.webp`);
    expect(outcome.value.provider).toBe("workers_ai");
  });
});

describe("jobs — siklus hidup", () => {
  it("menerima urutan queued lalu running lalu succeeded", () => {
    // TC-U-JOB-08
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "succeeded")).toBe(true);

    // Percobaan ulang hanya lewat failed, dan failed bukan keadaan akhir.
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("failed", "queued")).toBe(true);
    expect(isTerminal("failed")).toBe(false);

    // Pengrajin boleh membatalkan selama pekerjaan belum selesai.
    expect(canTransition("queued", "cancelled")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(true);
  });

  it("menolak transisi mundur dari succeeded", () => {
    // TC-U-JOB-09
    expect(canTransition("succeeded", "running")).toBe(false);
    expect(canTransition("succeeded", "queued")).toBe(false);
    expect(canTransition("succeeded", "failed")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);

    // Melompati running juga ditolak: pekerjaan yang selesai tanpa pernah
    // tercatat berjalan berarti ada langkah yang terlewat.
    expect(canTransition("queued", "succeeded")).toBe(false);

    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);

    // Percobaan ulang dibatasi LIMITS.MAX_JOB_ATTEMPTS, termasuk saat
    // penyedia membalas 429. Percobaan ulang tanpa batas menghabiskan jatah
    // gratis sekaligus memperpanjang waktu tunggu pengrajin tanpa ujung.
    expect(LIMITS.MAX_JOB_ATTEMPTS).toBe(3);
    expect(canRetryJob(0)).toBe(true);
    expect(canRetryJob(LIMITS.MAX_JOB_ATTEMPTS - 1)).toBe(true);
    expect(canRetryJob(LIMITS.MAX_JOB_ATTEMPTS)).toBe(false);
  });
});

describe("jobs — isolasi per bahasa", () => {
  it("menyimpan dua bahasa yang berhasil dan menandai satu bahasa gagal", async () => {
    // TC-U-JOB-10
    const stored = new Map<Locale, Content>();
    const failed: Locale[] = [];

    const nineRouter: TextProvider = {
      id: "9router",
      timeoutMs: FALLBACK_TIMEOUT_MS,
      generate: async (request) => {
        if (request.locale === "ja") {
          throw new ProviderError(500, "Model menolak locale ja");
        }
        return content(request.locale, "9router");
      },
    };
    const workersAi: TextProvider = {
      id: "workers_ai",
      timeoutMs: FALLBACK_TIMEOUT_MS,
      generate: async (request) => {
        if (request.locale === "ja") {
          throw new ProviderError(500, "Model teks tidak mendukung ja");
        }
        return content(request.locale, "workers_ai");
      },
    };

    const outcomes = await runPerLocale(["id", "en", "ja"], (locale) =>
      runProviderChain(
        textChainSteps([nineRouter, workersAi], {
          transcript: "Saya membuat tas dari kulit kerbau.",
          locale,
          task: "copy",
        }),
        "COPY_GENERATE_FAILED",
      ),
    );

    for (const entry of outcomes) {
      if (entry.outcome.ok) stored.set(entry.locale, entry.outcome.value);
      else failed.push(entry.locale);
    }

    // Dua bahasa tersimpan, satu ditandai gagal. Bahasa Jepang yang gagal
    // tidak menghentikan Indonesia dan Inggris — inilah alasan
    // `product_content` dipisah per bahasa.
    expect([...stored.keys()]).toEqual(["id", "en"]);
    expect(stored.get("id")?.story).toBe("Cerita id");
    expect(failed).toEqual(["ja"]);
    expect(outcomes).toHaveLength(3);

    // Pemanggil yang meledak pun tidak menghentikan bahasa lain.
    const resilient = await runPerLocale<Content>(["id", "ja"], async (locale) => {
      if (locale === "ja") throw new Error("Pemanggil meledak");
      return {
        ok: true,
        value: content("id", "9router"),
        provider: "9router",
        layersTried: 1,
        durationMs: 1,
      };
    });

    expect(resilient.map((entry) => entry.outcome.ok)).toEqual([true, false]);
    const japanese = resilient.find((entry) => entry.locale === "ja");
    expect(japanese?.outcome.ok).toBe(false);
  });
});

describe("jobs/chain — keterangan galat dari penyedia", () => {
  it("memakai teks apa adanya saat penyedia melempar string", async () => {
    // Penyedia yang melempar string (bukan Error) adalah keadaan yang nyata
    // pada klien HTTP yang tidak membungkus galatnya. Keterangannya tetap
    // berguna di log — dan tetap tidak pernah sampai ke pengrajin
    // (TC-U-JOB-06).
    const provider = failingImageProvider("gemini_web", "koneksi terputus");

    const outcome = await runProviderChain(
      imageChainSteps([provider], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.diagnostic).toBe("koneksi terputus");
  });

  it("memakai keterangan umum saat penyedia melempar nilai yang bukan galat", async () => {
    // Objek biasa, angka, null: tidak ada yang dapat dibaca dari sana.
    // Yang penting adalah rantainya tetap menghasilkan galat terstruktur,
    // bukan lemparan mentah.
    const provider = failingImageProvider("gemini_web", { kode: 500 });

    const outcome = await runProviderChain(
      imageChainSteps([provider], IMAGE_REQUEST),
      "IMAGE_GENERATE_FAILED",
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.diagnostic).toBe("Penyedia gagal tanpa keterangan.");
    expect(outcome.failure.provider).toBe("gemini_web");
    expect(outcome.failure.layersTried).toBe(1);
  });
});

describe("jobs/chain — rantai transkripsi", () => {
  const TRANSCRIPTION_REQUEST = {
    audioUrl: `https://media.example/products/${PRODUCT_ID}/cerita.m4a`,
    locale: "id" as Locale,
  };

  function succeedingTranscriber(
    id: ProviderId,
    calls: ProviderId[],
  ): TranscriptionProvider {
    return {
      id,
      timeoutMs: 30_000,
      async transcribe() {
        calls.push(id);
        return { text: "Saya membuat tas dari kulit kerbau.", provider: id, durationMs: 28_000 };
      },
    };
  }

  function failingTranscriber(id: ProviderId, calls: ProviderId[]): TranscriptionProvider {
    return {
      id,
      timeoutMs: 30_000,
      async transcribe() {
        calls.push(id);
        throw new ProviderError(429, "Jatah harian habis");
      },
    };
  }

  it("menyusun langkah groq lalu workers_ai, sesuai urutan yang ditetapkan", async () => {
    // AGENTS.md aturan 5: ASR memakai rantai Groq -> Workers AI. Urutannya
    // tetap, dan fungsi inilah yang menetapkannya.
    const calls: ProviderId[] = [];
    const groq = succeedingTranscriber("groq", calls);
    const workersAi = succeedingTranscriber("workers_ai", calls);

    const steps = transcriptionChainSteps([groq, workersAi], TRANSCRIPTION_REQUEST);

    expect(steps.map((step) => step.id)).toEqual(["groq", "workers_ai"]);

    const outcome = await runProviderChain(steps, "INTERNAL_ERROR");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.provider).toBe("groq");
    expect(outcome.value.text).toBe("Saya membuat tas dari kulit kerbau.");
    expect(calls).toEqual(["groq"]);
  });

  it("memakai workers_ai saat groq menolak", async () => {
    // TC-E2E-12: Groq mengembalikan 429, transkrip tetap diperoleh lewat
    // fallback.
    const calls: ProviderId[] = [];
    const groq = failingTranscriber("groq", calls);
    const workersAi = succeedingTranscriber("workers_ai", calls);

    const outcome = await runProviderChain(
      transcriptionChainSteps([groq, workersAi], TRANSCRIPTION_REQUEST),
      "INTERNAL_ERROR",
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.provider).toBe("workers_ai");
    expect(calls).toEqual(["groq", "workers_ai"]);
  });

  it("mengembalikan galat terstruktur saat keduanya gagal", async () => {
    const calls: ProviderId[] = [];
    const groq = failingTranscriber("groq", calls);
    const workersAi = failingTranscriber("workers_ai", calls);

    const outcome = await runProviderChain(
      transcriptionChainSteps([groq, workersAi], TRANSCRIPTION_REQUEST),
      "INTERNAL_ERROR",
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.layersTried).toBe(2);
    expect(outcome.failure.provider).toBe("workers_ai");
  });
});
