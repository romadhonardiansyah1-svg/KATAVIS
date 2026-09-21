/**
 * Uji satuan notifikasi multimodal (S10).
 *
 * Yang diuji di sini adalah dua kanal yang diurus `lib/notify.ts`: audio dan
 * getar. Kanal visualnya diuji di tingkat E2E (`notification.spec.ts`),
 * karena keberadaannya bergantung pada render halaman.
 *
 * Lingkungan uji `unit` di vitest tidak menyediakan `window`, `navigator`,
 * maupun Web Audio. Karena itu setiap objek dipasang sendiri, dan yang
 * diperiksa adalah **perilaku modul terhadap ketiadaan maupun kehadiran
 * API** — bukan perilaku peramban sesungguhnya.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { announce, notify, resetNotificationAudio } from "./notify";

type VibrateCalls = number[][];

interface FakeOscillator {
  readonly type: string;
  readonly frequency: { value: number };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

interface FakeGain {
  readonly gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

interface FakeAudioContext {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: object;
  readonly oscillators: FakeOscillator[];
  readonly gains: FakeGain[];
  resume: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  createOscillator: () => FakeOscillator;
  createGain: () => FakeGain;
}

/** Membangun tiruan `AudioContext` yang mencatat setiap osilator yang dibuat. */
function fakeAudioContext(state = "running"): FakeAudioContext {
  const context: FakeAudioContext = {
    state,
    currentTime: 0,
    destination: {},
    oscillators: [],
    gains: [],
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createOscillator: () => {
      const oscillator: FakeOscillator = {
        type: "sine",
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
      };
      context.oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => {
      const gain: FakeGain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      context.gains.push(gain);
      return gain;
    },
  };

  return context;
}

let vibrateCalls: VibrateCalls;

function installWindow(options: {
  readonly vibrate?: unknown;
  readonly audioContext?: unknown;
  readonly speechSynthesis?: unknown;
}): void {
  vibrateCalls = [];

  const navigatorStub: Record<string, unknown> = {};

  if ("vibrate" in options) {
    navigatorStub.vibrate = options.vibrate;
  }

  const windowStub: Record<string, unknown> = { navigator: navigatorStub };

  if ("audioContext" in options) {
    windowStub.AudioContext = options.audioContext;
  }

  if ("speechSynthesis" in options) {
    windowStub.speechSynthesis = options.speechSynthesis;
  }

  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("navigator", navigatorStub);
}

beforeEach(() => {
  vibrateCalls = [];
});

afterEach(() => {
  resetNotificationAudio();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("kanal getar (S10-01, S10-03)", () => {
  it("meminta satu getar untuk peristiwa 'foto tersimpan'", () => {
    installWindow({
      vibrate: (pattern: number | number[]) => {
        vibrateCalls.push(Array.isArray(pattern) ? pattern : [pattern]);
        return true;
      },
    });

    notify("photo-saved");

    expect(vibrateCalls).toHaveLength(1);
    expect(vibrateCalls[0]).toHaveLength(1);
  });

  it("meminta pola getar yang berbeda untuk berhasil dan gagal", () => {
    // S10-02: pengguna tunanetra tidak dapat membedakan hasil bila polanya sama.
    installWindow({
      vibrate: (pattern: number | number[]) => {
        vibrateCalls.push(Array.isArray(pattern) ? pattern : [pattern]);
        return true;
      },
    });

    notify("photo-saved");
    notify("error");

    expect(vibrateCalls).toHaveLength(2);
    expect(vibrateCalls[1]).not.toEqual(vibrateCalls[0]);
  });

  it("memakai tiga getar pendek untuk kesalahan, sesuai tabel S10", () => {
    installWindow({
      vibrate: (pattern: number | number[]) => {
        vibrateCalls.push(Array.isArray(pattern) ? pattern : [pattern]);
        return true;
      },
    });

    notify("error");

    expect(vibrateCalls[0]).toHaveLength(3);
  });

  it("tidak menimbulkan galat bila Vibration API tidak ada", () => {
    // S10-03. Ketiadaan API adalah keadaan normal di peramban desktop.
    installWindow({});

    expect(() => {
      notify("photo-saved");
    }).not.toThrow();
  });

  it("tidak menimbulkan galat bila properti vibrate ada tetapi bukan fungsi", () => {
    // Sebagian peramban menyediakan properti bernilai null. Memanggilnya
    // melempar; memeriksa `typeof` tidak.
    installWindow({ vibrate: null });

    expect(() => {
      notify("error");
    }).not.toThrow();
  });

  it("tidak menimbulkan galat bila perangkat menolak pola getar", () => {
    installWindow({
      vibrate: () => {
        throw new Error("NotAllowedError");
      },
    });

    expect(() => {
      notify("photo-saved");
    }).not.toThrow();
  });
});

describe("kanal audio (S10-01, S10-02)", () => {
  it("membunyikan nada untuk peristiwa 'foto tersimpan'", () => {
    const context = fakeAudioContext();
    installWindow({ audioContext: function FakeContext() { return context; } });

    notify("photo-saved");

    expect(context.oscillators.length).toBeGreaterThan(0);
  });

  it("membedakan frekuensi nada berhasil dan gagal", () => {
    // S10-02. Perbedaan hanya pada durasi mudah terlewat pada speaker kecil,
    // jadi nadanya memang harus berbeda frekuensi.
    const successContext = fakeAudioContext();
    installWindow({ audioContext: function FakeContext() { return successContext; } });
    notify("photo-saved");
    const successFrequencies = successContext.oscillators.map((o) => o.frequency.value);

    resetNotificationAudio();

    const failureContext = fakeAudioContext();
    installWindow({ audioContext: function FakeContext() { return failureContext; } });
    notify("error");
    const failureFrequencies = failureContext.oscillators.map((o) => o.frequency.value);

    expect(failureFrequencies).not.toEqual(successFrequencies);
  });

  it("memakai satu AudioContext bersama, bukan satu per peristiwa", () => {
    // Peramban membatasi jumlah konteks yang hidup bersamaan. Membuat yang
    // baru setiap peristiwa membuat peristiwa jauh ke-n berbunyi senyap.
    const context = fakeAudioContext();
    let created = 0;
    installWindow({
      audioContext: function FakeContext() {
        created += 1;
        return context;
      },
    });

    notify("photo-saved");
    notify("photo-saved");
    notify("error");

    expect(created).toBe(1);
  });

  it("memulihkan konteks yang tertunda karena kebijakan autoplay", () => {
    const context = fakeAudioContext("suspended");
    installWindow({ audioContext: function FakeContext() { return context; } });

    notify("photo-saved");

    expect(context.resume).toHaveBeenCalled();
  });

  it("tidak menimbulkan galat bila Web Audio tidak tersedia", () => {
    installWindow({});

    expect(() => {
      notify("catalog-done");
    }).not.toThrow();
  });

  it("tidak menimbulkan galat bila pembuatan AudioContext ditolak", () => {
    installWindow({
      audioContext: function Rejecting() {
        throw new Error("Tidak diizinkan");
      },
    });

    expect(() => {
      notify("photo-saved");
    }).not.toThrow();
  });
});

describe("announce — kalimat 'katalog selesai' (S10 tabel)", () => {
  it("mengucapkan kalimat dengan bahasa Indonesia", () => {
    const speak = vi.fn();
    const utterances: { text: string; lang: string }[] = [];

    class FakeUtterance {
      public text: string;
      public lang = "";

      constructor(text: string) {
        this.text = text;
        utterances.push(this as unknown as { text: string; lang: string });
      }
    }

    installWindow({ speechSynthesis: { speak } });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    announce("Katalog Anda sudah selesai");

    expect(speak).toHaveBeenCalledTimes(1);
    expect(utterances[0]?.text).toBe("Katalog Anda sudah selesai");
    expect(utterances[0]?.lang).toBe("id-ID");
  });

  it("tidak menimbulkan galat bila sintesis suara tidak tersedia", () => {
    installWindow({});

    expect(() => {
      announce("Katalog Anda sudah selesai");
    }).not.toThrow();
  });

  it("tidak menimbulkan galat bila perangkat menolak pengucapan", () => {
    installWindow({
      speechSynthesis: {
        speak: () => {
          throw new Error("Tidak diizinkan");
        },
      },
    });

    expect(() => {
      announce("Katalog Anda sudah selesai");
    }).not.toThrow();
  });
});
