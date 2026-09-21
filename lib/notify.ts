/**
 * Notifikasi multimodal — S10 di FEATURE-SPECS.
 *
 * Tabel S10 menetapkan tiga kanal untuk setiap peristiwa penting:
 *
 *   | Peristiwa       | Visual             | Audio                 | Getar        |
 *   |-----------------|--------------------|-----------------------|--------------|
 *   | Foto tersimpan  | Ikon centang+teks  | Nada pendek           | 1 getar      |
 *   | Katalog selesai | Banner + teks      | Kalimat diucapkan     | 2 getar      |
 *   | Kesalahan       | Ikon+pesan+langkah | Nada beda dari sukses | 3 getar      |
 *
 * Berkas ini sengaja **tidak menyentuh DOM visual**. Kanal visualnya sudah
 * ada di `StepShell` (`role="status"`) dan di setiap halaman (`statusRow`),
 * dan menggandakannya di sini akan membuat dua sumber kebenaran yang pada
 * akhirnya berbeda pendapat. Yang diurus berkas ini hanya dua kanal yang
 * memang belum ada: audio dan getar.
 *
 * ==== Mengapa satu titik terpusat ====
 *
 * S10-03 menuntut perangkat tanpa Vibration API **tidak menimbulkan galat**.
 * Jaminan itu jauh lebih mudah diberikan bila pemanggilan `navigator.vibrate`
 * hanya terjadi di satu tempat yang memeriksa ketersediaannya lebih dulu.
 * Disebar ke setiap pemanggil peristiwa, satu kelalaian sudah cukup untuk
 * menimbulkan `TypeError` di tengah alur demo.
 *
 * ==== Mengapa nada dibangkitkan, bukan berkas suara ====
 *
 * `public/` belum ada, dan menambah berkas biner berarti menambah aset yang
 * harus ikut dilacak, diunduh, dan dijaga nadanya. `OscillatorNode` memberi
 * nada yang sama di setiap perangkat tanpa satu byte pun aset. Ini juga
 * membuat S10-02 (nada sukses dan gagal wajib berbeda) dapat dijamin secara
 * struktural: dua pola frekuensi yang berbeda, bukan dua berkas yang
 * kebetulan mirip.
 *
 * Getar dan audio sama-sama **best-effort**. Kegagalan salah satu kanal tidak
 * boleh menghentikan alur pengrajin: bila `AudioContext` ditolak (kebijakan
 * autoplay), yang terjadi hanyalah kanal itu diam.
 */

/** Peristiwa yang diatur tabel S10. */
export type NotificationEvent = "photo-saved" | "catalog-done" | "error";

/**
 * Bentuk gelombang tiap kanal.
 *
 * Angka getar mengikuti tabel S10 apa adanya: 1 getar untuk foto tersimpan,
 * 2 untuk katalog selesai, 3 pendek untuk kesalahan. Nilainya dalam
 * milidetik, sesuai satuan Vibration API.
 */
const VIBRATION_PATTERNS: Record<NotificationEvent, readonly number[]> = {
  "photo-saved": [80],
  "catalog-done": [120, 80, 120],
  error: [60, 60, 60],
};

/**
 * Nada dibedakan oleh **frekuensi dan arah gerak**, bukan oleh durasi saja.
 * Nada sukses menaik (terdengar "selesai"); nada gagal menurun dan lebih
 * rendah (terdengar "berhenti"). Perbedaan yang hanya pada durasi mudah
 * terlewat pada speaker ponsel yang kecil.
 */
interface Tone {
  readonly frequencies: readonly number[];
  readonly durationMs: number;
  readonly gain: number;
}

const TONES: Record<NotificationEvent, Tone | null> = {
  "photo-saved": { frequencies: [880, 1320], durationMs: 70, gain: 0.05 },
  "catalog-done": { frequencies: [660, 880, 1320], durationMs: 90, gain: 0.05 },
  // Nada gagal: menurun, dan gain lebih tinggi supaya terdengar mendesak.
  error: { frequencies: [400, 260], durationMs: 110, gain: 0.07 },
};

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

/**
 * Konstruktor `AudioContext` bila peramban menyediakannya, atau `null`.
 *
 * `webkitAudioContext` ikut diperiksa: Safari lama hanya punya nama itu, dan
 * peramban itulah yang dipakai pada profil `mobile-safari` di Playwright.
 */
function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;

  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };

  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Satu `AudioContext` dipakai bersama, bukan satu per nada.
 *
 * Peramban membatasi jumlah `AudioContext` yang boleh hidup bersamaan
 * (Chrome: enam). Membuat yang baru di setiap peristiwa akan membuat
 * peristiwa ketujuh berbunyi dalam senyap — tepat saat demo berjalan lama.
 */
let sharedContext: AudioContext | null = null;

function contextFor(): AudioContext | null {
  const Constructor = audioContextConstructor();
  if (Constructor === null) return null;

  if (sharedContext === null || sharedContext.state === "closed") {
    try {
      sharedContext = new Constructor();
    } catch {
      // Peramban dapat menolak pembuatan konteks. Kanal audio mati; dua
      // kanal lain tetap berjalan, sesuai S10.
      return null;
    }
  }

  // Autoplay policy: konteks dapat lahir dalam keadaan "suspended" dan perlu
  // dipulihkan dari dalam gestur pengguna. `resume()` mengembalikan promise
  // yang tidak perlu ditunggu — kegagalannya tidak berkonsekuensi selain
  // senyap.
  if (sharedContext.state === "suspended") {
    void sharedContext.resume().catch(() => undefined);
  }

  return sharedContext;
}

/** Membunyikan pola frekuensi sebagai satu nada berurutan. */
function playTone(tone: Tone): void {
  const context = contextFor();
  if (context === null) return;

  try {
    const start = context.currentTime;

    tone.frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const amplifier = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      // Amplop naik-turun pendek supaya tidak ada letupan ("click") di ujung
      // nada — letupan terdengar seperti kerusakan, bukan seperti notifikasi.
      const noteStart = start + index * (tone.durationMs / 1000);
      const noteEnd = noteStart + tone.durationMs / 1000;

      amplifier.gain.setValueAtTime(0, noteStart);
      amplifier.gain.linearRampToValueAtTime(tone.gain, noteStart + 0.01);
      amplifier.gain.setValueAtTime(tone.gain, Math.max(noteStart + 0.01, noteEnd - 0.02));
      amplifier.gain.linearRampToValueAtTime(0, noteEnd);

      oscillator.connect(amplifier);
      amplifier.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd);
    });
  } catch {
    // Kanal audio gagal; bukan alasan untuk menghentikan alur.
  }
}

/** Meminta getar bila perangkat mendukungnya. Tidak pernah melempar. */
function vibrate(pattern: readonly number[]): void {
  if (typeof navigator === "undefined") return;

  // `typeof` diperiksa, bukan `navigator.vibrate?.()`: sebagian peramban
  // punya properti `vibrate` yang ada tetapi bernilai `null`, dan memanggilnya
  // melempar. Inilah bentuk yang dijaga S10-03.
  const canVibrate = typeof navigator.vibrate === "function";
  if (!canVibrate) return;

  try {
    navigator.vibrate([...pattern]);
  } catch {
    // Perangkat menolak pola. Kanal visual dan audio tetap berjalan.
  }
}

/**
 * Menyampaikan satu peristiwa S10 lewat kanal audio dan getar.
 *
 * Dipanggil dari dalam gestur pengguna (klik, perubahan berkas) supaya
 * `AudioContext` diizinkan berbunyi oleh kebijakan autoplay peramban.
 */
export function notify(event: NotificationEvent): void {
  const tone = TONES[event];
  if (tone !== null) playTone(tone);

  vibrate(VIBRATION_PATTERNS[event]);
}

/**
 * Mengucapkan kalimat notifikasi "Katalog selesai" (tabel S10).
 *
 * Kanal audio peristiwa ini adalah **kalimat**, bukan nada: pengrajin yang
 * tidak melihat layar perlu tahu katalognya selesai, dan nada tidak
 * menyampaikan itu. Memakai `speechSynthesis` bawaan perangkat, bukan TTS
 * pihak ketiga (ADR-005), dan tidak menambah dependensi.
 *
 * Best-effort sepenuhnya: perangkat tanpa suara tidak mengalami galat.
 */
export function announce(message: string): void {
  if (typeof window === "undefined") return;

  const synthesis = window.speechSynthesis;
  if (synthesis === undefined || synthesis === null) return;

  try {
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "id-ID";
    synthesis.speak(utterance);
  } catch {
    // Tanpa suara; kanal visual dan getar tetap menyampaikan peristiwanya.
  }
}

/**
 * Menutup `AudioContext` bersama. Dipakai pengujian.
 *
 * Diperlukan karena Vitest menjaga modul tetap hidup antarberkas uji, dan
 * `AudioContext` yang menggantung membuat proses tidak keluar.
 */
export function resetNotificationAudio(): void {
  if (sharedContext === null) return;

  try {
    void sharedContext.close();
  } catch {
    // Sudah tertutup.
  }

  sharedContext = null;
}
