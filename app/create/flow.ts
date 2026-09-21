/**
 * Model alur enam langkah (FEATURE-SPECS S2).
 *
 * Berkas ini murni: tidak menyentuh jaringan, penyimpanan, maupun DOM.
 * Yang dilakukannya adalah menjawab satu pertanyaan yang menentukan seluruh
 * alur — **langkah mana yang boleh dibuka sekarang** — dan jawabannya
 * dipakai setiap halaman untuk menolak lompatan langkah, termasuk lewat
 * manipulasi URL (S2-04).
 */

export type StepId = "photo" | "record" | "transcript" | "process" | "review" | "publish";

export interface FlowStep {
  readonly id: StepId;
  /** 1 sampai 6. Ditampilkan sebagai "Langkah 2 dari 6" (S2-05). */
  readonly position: number;
  readonly path: string;
  /** Judul yang menjelaskan apa yang harus dilakukan, bukan nama fitur. */
  readonly title: string;
}

/**
 * Urutannya tetap (S2-01). Kalimat judulnya diambil apa adanya dari
 * `Fitur pendukung.pdf` halaman 2–3 lewat FEATURE-SPECS S2.
 */
export const FLOW_STEPS: readonly FlowStep[] = [
  {
    id: "photo",
    position: 1,
    path: "/create/photo",
    title: "Arahkan kamera ke produk Anda",
  },
  {
    id: "record",
    position: 2,
    path: "/create/record",
    title: "Tekan tombol dan ceritakan produk Anda",
  },
  {
    id: "transcript",
    position: 3,
    path: "/create/transcript",
    title: "Apakah ini yang Anda ceritakan?",
  },
  {
    id: "process",
    position: 4,
    path: "/create/process",
    title: "KATAVIS sedang membuat katalog Anda",
  },
  {
    id: "review",
    position: 5,
    path: "/create/review",
    title: "Apakah katalog sudah sesuai?",
  },
  {
    id: "publish",
    position: 6,
    path: "/create/publish",
    title: "Katalog siap dilihat pembeli",
  },
];

export const TOTAL_STEPS = FLOW_STEPS.length;

export function stepById(id: StepId): FlowStep {
  const step = FLOW_STEPS.find((candidate) => candidate.id === id);
  // Daftarnya konstan dan id-nya bertipe union, jadi ini tidak dapat
  // terjadi; melempar di sini menandai cacat kode, bukan kegagalan pengguna.
  if (step === undefined) throw new Error(`Langkah tidak dikenal: ${id}`);
  return step;
}

export function stepPath(id: StepId): string {
  return stepById(id).path;
}

/**
 * Draf yang bertahan di perangkat.
 *
 * Bentuknya sengaja datar dan seluruh bidangnya opsional-bernilai-null:
 * draf yang setengah jadi adalah keadaan normal pada alur enam langkah,
 * bukan pengecualian yang perlu ditangani terpisah.
 */
export interface Draft {
  readonly productId: string | null;
  readonly photoMediaId: string | null;
  readonly audioJobId: string | null;
  readonly transcript: string;
  /** `reviewed` menyala hanya setelah pengrajin menekan "Sudah benar". */
  readonly transcriptReviewed: boolean;
  readonly generatedAt: number | null;
  /** Menyala setelah layar periksa hasil disetujui. */
  readonly contentReviewedAt: number | null;
  readonly publishedAt: number | null;
  readonly slug: string | null;
  readonly updatedAt: number;
}

export const EMPTY_DRAFT: Draft = {
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

/**
 * Syarat tiap langkah.
 *
 * Ditulis sebagai satu fungsi, bukan diperiksa di dalam masing-masing
 * halaman: aturan "melompati langkah ditolak" hanya benar bila keempat
 * belas pemeriksaannya memakai sumber yang sama.
 */
export function canOpenStep(draft: Draft, id: StepId): boolean {
  switch (id) {
    case "photo":
      return true;
    case "record":
      return draft.productId !== null;
    case "transcript":
      return draft.photoMediaId !== null;
    case "process":
      return draft.transcriptReviewed;
    case "review":
      return draft.generatedAt !== null;
    case "publish":
      return draft.contentReviewedAt !== null;
  }
}

/**
 * Langkah terjauh yang boleh dibuka.
 *
 * Dipakai saat sebuah lompatan ditolak: pengrajin diarahkan ke langkah
 * yang memang sudah boleh ia buka, bukan ke halaman galat.
 */
export function furthestAllowedStep(draft: Draft): StepId {
  let furthest: StepId = "photo";

  for (const step of FLOW_STEPS) {
    if (!canOpenStep(draft, step.id)) break;
    furthest = step.id;
  }

  return furthest;
}

/** Apakah draf ini memuat pekerjaan yang layak ditawarkan untuk dilanjutkan. */
export function draftHasWork(draft: Draft): boolean {
  return draft.productId !== null || draft.transcript.trim().length > 0;
}

export function withDraftChange(draft: Draft, patch: Partial<Draft>, nowMs: number): Draft {
  return { ...draft, ...patch, updatedAt: nowMs };
}
