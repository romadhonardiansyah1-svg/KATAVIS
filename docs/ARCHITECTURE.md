# Arsitektur Sistem KATAVIS

**Versi** 1.0 · **Tanggal** 15 September 2026
**Status** Disetujui untuk build

---

## 1. Kendala yang membentuk arsitektur ini

Arsitektur ini bukan hasil memilih teknologi favorit. Ia dibentuk oleh batasan terukur berikut,
yang seluruhnya diverifikasi langsung pada mesin pengembangan:

| Kendala | Nilai terukur | Konsekuensi arsitektural |
|---|---|---|
| GPU | Intel Arc iGPU, 2 GB VRAM, **tanpa CUDA** | Semua inferensi berat wajib di luar mesin ini. SAM, Stable Diffusion, SadTalker, dan LivePortrait gugur. |
| RAM | 15,6 GB total, **1,7 GB bebas** saat diukur | Tidak boleh ada layanan berat yang menetap. PostgreSQL + Redis + Docker bersamaan tidak muat. |
| Disk | Sisa **28,3 GB** pada C: | Bobot model besar tidak dapat disimpan bersama aset media. |
| Jaringan demo | WiFi venue, keandalan belum terbukti | Jalur kritis wajib punya fallback. |
| Tim | 1 pengembang utama | Jumlah komponen harus minimum. Microservices penuh akan gagal diselesaikan. |
| Biaya | Cloudflare free, 9router, akun Gemini berlangganan | Desain menyesuaikan kuota gratis terverifikasi. |

**Penyimpangan dari proposal.** Proposal bagian 4.2 menyebut "microservices dan event-driven
architecture" dengan layanan terpisah. Dengan satu pengembang, itu akan menghasilkan sistem yang
tidak selesai. Kami memakai **modular monolith di Workers dengan pemisahan modul yang tegas**,
plus **satu worker lokal** yang terpisah karena alasan teknis nyata (bagian 4). Batas modulnya sama
dengan batas layanan di proposal, sehingga pemecahan menjadi layanan terpisah nanti tidak menuntut
penulisan ulang.

## 2. Gambaran tingkat konteks (C4 Level 1)

```
                    ┌──────────────────────────────────────┐
                    │              KATAVIS                 │
   Pengrajin ──────▶│                                      │
   Pendamping ─────▶│  PWA + Workers + D1 + R2 + Queues    │
   Admin ──────────▶│                                      │
   Pembeli ────────▶│                                      │
                    └───────┬──────────────────────────────┘
                            │
          ┌─────────────────┼──────────────────┬─────────────────┐
          ▼                 ▼                  ▼                 ▼
    ┌───────────┐   ┌──────────────┐   ┌─────────────┐   ┌──────────────┐
    │   Groq    │   │ 9router      │   │ Cloudflare  │   │ Studio Agent │
    │   (ASR)   │   │ (LLM)        │   │ Workers AI  │   │ (laptop)     │
    │           │   │              │   │ (gambar)    │   │ Gemini web   │
    └───────────┘   └──────────────┘   └─────────────┘   └──────────────┘
```

Studio Agent berjalan di laptop, bukan di cloud. Alasannya di bagian 4.

## 3. Komponen (C4 Level 2)

```
┌─────────────────────────────────────────────────────────────────────┐
│ KLIEN                                                               │
│  PWA Next.js 15 (App Router)  ──────▶  TWA → APK Android            │
│  Service Worker: cache aset + antrian draf offline                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────────────┐
│ EDGE — Cloudflare Workers (satu worker, modul terpisah)             │
│                                                                     │
│  auth/       OTP, sesi, PIN                                         │
│  rbac/       peran, izin, akses pendamping                          │
│  catalog/    produk, draf, versi                                    │
│  media/      URL bertanda tangan, unggah, turunan gambar            │
│  jobs/       siklus hidup pekerjaan AI, status, percobaan ulang     │
│  export/     PDF, feed marketplace, halaman publik                  │
│  audit/      log aktivitas                                          │
└───┬─────────────────┬──────────────────┬────────────────────────────┘
    │                 │                  │
    ▼                 ▼                  ▼
┌────────┐      ┌──────────┐      ┌─────────────┐
│ D1     │      │ R2       │      │ Queues      │
│ SQLite │      │ media    │      │ pekerjaan   │
└────────┘      └──────────┘      └──────┬──────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    ▼                    ▼                    ▼
              ┌───────────┐       ┌────────────┐      ┌──────────────┐
              │ Consumer  │       │ Consumer   │      │ Studio Agent │
              │ ASR       │       │ LLM        │      │ (pull, lokal)│
              │ → Groq    │       │ → 9router  │      │ → Gemini web │
              └───────────┘       └────────────┘      └──────┬───────┘
                                                             │ gagal
                                                             ▼
                                                    ┌──────────────────┐
                                                    │ Workers AI       │
                                                    │ flux-2-klein-9b  │
                                                    └──────────────────┘
```

## 4. Mengapa Studio Agent berjalan di laptop

Ini kendala paling menentukan dalam keseluruhan sistem, dan perlu dinyatakan terang-terangan.

Otomasi Gemini web **tidak dapat berjalan di Cloudflare Workers**. Workers adalah lingkungan
isolat V8 tanpa sistem berkas dan tanpa kemampuan menjalankan proses. Otomasi tersebut menuntut
Chrome asli dengan profil pengguna yang sudah login — sesuatu yang hanya ada di mesin fisik.

Maka Studio Agent adalah proses Node.js di laptop yang:

1. Menarik pekerjaan dari Cloudflare Queues lewat **HTTP pull consumer** (Queues tersedia di
   Workers Free sejak 4 Februari 2026, dengan 10.000 operasi/hari).
2. Mengendalikan Chrome asli lewat CDP, memakai profil yang **sudah login secara manual**.
3. Mengunggah hasil ke R2 dan menandai pekerjaan selesai.
4. Bila gagal atau melewati batas waktu, pekerjaan dikembalikan ke antrian dan diambil consumer
   Workers AI.

### Batas waktu dan perilaku fallback

```
t=0s    Pekerjaan masuk antrian
t=0s    Studio Agent mengambil (bila agen hidup)
t=45s   BATAS WAKTU KERAS → pekerjaan dikembalikan ke antrian, ditandai gemini_failed
t=45s   Consumer Workers AI mengambil
t=70s   Hasil tersedia

Bila Studio Agent tidak hidup sama sekali:
t=0s    Pekerjaan masuk antrian
t=10s   Tidak ada agen yang mengambil → Workers AI langsung mengambil
t=35s   Hasil tersedia
```

Batas 45 detik dipilih supaya total waktu terburuk tetap di bawah 2 menit, menyisakan ruang untuk
sasaran 3 menit pada G2 di PRD. Angka ini **wajib diukur ulang** setelah implementasi; bila
generate Gemini nyatanya butuh lebih lama, batasnya disesuaikan atau Gemini dipindah ke jalur
pra-produksi aset.

### Risiko yang diterima secara sadar

Otomasi Gemini web melanggar Google Terms of Service bagian *"Don't abuse our services"*
("bypassing our systems or protective measures"), dengan sanksi hingga penghapusan akun Google.
Pemilik produk telah menerima risiko ini. Mitigasinya dicatat di `docs/ops/RISK-REGISTER.md` R-04,
dan arsitektur dirancang agar demo tetap berjalan tanpa jalur ini.

**Konsekuensi yang harus disiapkan tim:** bila juri bertanya "layanan AI apa yang dipakai?",
jawaban yang jujur adalah Cloudflare Workers AI sebagai jalur produksi, dengan Gemini sebagai
jalur eksperimental. Menyebut Gemini sebagai tulang punggung akan sulit dipertahankan.

## 5. Alur data — Buat katalog

```
Pengrajin                 PWA              Worker            Queues        Penyedia AI
    │                      │                  │                 │               │
    │ 1. foto produk       │                  │                 │               │
    ├─────────────────────▶│                  │                 │               │
    │                      │ 2. minta URL     │                 │               │
    │                      ├─────────────────▶│                 │               │
    │                      │◀─────────────────┤ URL bertanda    │               │
    │                      │ 3. PUT ke R2 langsung              │               │
    │                      ├──────────────────────────────▶ R2  │               │
    │                      │                  │                 │               │
    │ 4. rekam 30 detik    │                  │                 │               │
    ├─────────────────────▶│ 5. unggah audio  │                 │               │
    │                      ├─────────────────▶│ 6. antre ASR    │               │
    │                      │                  ├────────────────▶│               │
    │                      │                  │                 │ 7. transkrip  │
    │                      │                  │                 ├──────────────▶│ Groq
    │                      │                  │                 │◀──────────────┤
    │ 8. TINJAU TRANSKRIP  │                  │                 │               │
    │◀─────────────────────┤                  │                 │               │
    │ 9. koreksi bila perlu│                  │                 │               │
    ├─────────────────────▶│                  │                 │               │
    │                      │ 10. antre LLM + gambar (paralel)   │               │
    │                      ├─────────────────▶├────────────────▶│               │
    │                      │                  │                 ├──────────────▶│ 9router
    │                      │                  │                 ├──────────────▶│ Studio Agent
    │                      │                  │                 │               │   ↓ gagal
    │                      │                  │                 │               │ Workers AI
    │                      │ 11. progres via polling             │               │
    │◀─────────────────────┤◀─────────────────┤◀────────────────┤◀──────────────┤
    │ 12. PERIKSA HASIL    │                  │                 │               │
    │◀─────────────────────┤                  │                 │               │
    │ 13. terbitkan        │                  │                 │               │
    ├─────────────────────▶│                 ▶│ tulis D1 + R2   │               │
```

**Langkah 8 adalah keputusan desain yang disengaja.** Transkrip ditinjau pengrajin sebelum masuk
LLM. ASR akan salah pada nama daerah, istilah kriya, dan aksen. Membiarkan kesalahan itu mengalir
ke seluruh pipeline akan menghasilkan katalog yang salah dalam lima bahasa sekaligus. Satu layar
koreksi menghentikan galat di hulu.

## 6. Skema data

Dijalankan di D1 (SQLite). Kolom `id` memakai ULID agar terurut secara waktu.

Skema lengkap dan tervalidasi ada di `migrations/0001_initial_schema.sql` — **11 tabel**. Bagian di
bawah menampilkan tujuh tabel inti beserta alasan rancangannya. Empat tabel penunjang
(`consents`, `transcripts`, `agent_heartbeats`, `idempotency_keys`) dijelaskan setelahnya.

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  phone         TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('artisan','caregiver','admin','buyer')),
  pin_hash      TEXT,
  a11y_profile  TEXT,            -- JSON: {visual, hearing, motor, cognitive, voice}
  locale        TEXT NOT NULL DEFAULT 'id',
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

CREATE TABLE caregiver_links (
  id            TEXT PRIMARY KEY,
  artisan_id    TEXT NOT NULL REFERENCES users(id),
  caregiver_id  TEXT NOT NULL REFERENCES users(id),
  permissions   TEXT NOT NULL,  -- JSON array: ["edit_draft","upload_media","submit_review"]
  status        TEXT NOT NULL CHECK (status IN ('pending','active','revoked')),
  granted_at    INTEGER,
  revoked_at    INTEGER,
  expires_at    INTEGER NOT NULL,
  UNIQUE (artisan_id, caregiver_id)
);
CREATE INDEX idx_caregiver_active ON caregiver_links(caregiver_id, status);

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  artisan_id    TEXT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL CHECK (status IN ('draft','processing','review','published','archived')),
  slug          TEXT UNIQUE,
  progress      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  published_at  INTEGER
);
CREATE INDEX idx_products_artisan ON products(artisan_id, status);

-- Satu baris per bahasa. Kegagalan satu bahasa tidak menggagalkan yang lain.
CREATE TABLE product_content (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locale        TEXT NOT NULL,
  name          TEXT,
  story         TEXT,
  specs         TEXT,            -- JSON array
  social_copy   TEXT,
  seo_keywords  TEXT,            -- JSON array
  source        TEXT NOT NULL CHECK (source IN ('ai','human','ai_edited')),
  updated_at    INTEGER NOT NULL,
  UNIQUE (product_id, locale)
);

CREATE TABLE media_assets (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('photo_original','photo_studio','audio_raw','audio_tts')),
  r2_key        TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  alt_text      TEXT,
  provider      TEXT,            -- 'gemini_web' | 'workers_ai' | NULL
  is_primary    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_media_product ON media_assets(product_id, kind);

CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('asr','copy','image','tts','export')),
  status        TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  provider      TEXT,
  attempt       INTEGER NOT NULL DEFAULT 0,
  error_code    TEXT,            -- kode internal, tidak pernah tampil ke pengrajin
  payload       TEXT,            -- JSON
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  completed_at  INTEGER
);
CREATE INDEX idx_jobs_product ON jobs(product_id, kind, status);

CREATE TABLE activity_log (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT NOT NULL REFERENCES users(id),
  on_behalf_of  TEXT REFERENCES users(id),   -- terisi bila pendamping bertindak
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  metadata      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id, created_at);
```

### Empat tabel penunjang

| Tabel | Peran | Menegakkan |
|---|---|---|
| `consents` | Persetujuan pemrosesan audio dan publikasi, per pengguna | TC-I-14, TC-I-15 |
| `transcripts` | Transkrip beserta penanda `reviewed` | ADR-008 — `reviewed=0` memblokir generate |
| `agent_heartbeats` | Kesehatan Studio Agent | TC-SA-02 — agen mati tidak memperlambat siapa pun |
| `idempotency_keys` | Respons yang sudah dikirim, per kunci | Mencegah pekerjaan ganda saat jaringan buruk |

`users` juga memiliki kolom `token_version` yang tidak tampak di ringkasan di atas. Kolom inilah
yang membuat pencabutan akses berlaku seketika: setiap permintaan membandingkan versi di token
dengan versi di basis data. Tanpa kolom ini, pencabutan hanya mengubah baris sementara token lama
tetap sah sampai kedaluwarsa.

### Catatan desain skema

**`on_behalf_of` pada `activity_log`.** Kolom ini menjawab kebutuhan dari `Fitur pendukung.pdf`
hal. 5: pendamping membantu tanpa mengambil alih akun. Tanpa kolom ini, tindakan pendamping akan
tercatat seolah dilakukan pengrajin, dan pengrajin kehilangan kemampuan mengaudit siapa mengubah
karyanya.

**`product_content` dipisah per bahasa.** Menyimpan lima bahasa dalam satu kolom JSON akan membuat
kegagalan satu bahasa merusak seluruh baris. Pemisahan ini yang memungkinkan kriteria penerimaan F1
"kegagalan pada satu bahasa tidak menggagalkan bahasa lain".

**`jobs.error_code` bukan `error_message`.** Kode internal dipetakan ke pesan ramah pengguna di
lapisan penyajian. Ini mencegah pesan teknis seperti "Error 500" bocor ke pengrajin — persis yang
dilarang `Fitur pendukung.pdf` hal. 6–7.

## 7. Batas kuota yang terverifikasi

Seluruh angka di bawah dikutip dari dokumentasi resmi, bukan perkiraan.

| Layanan | Batas gratis | Sumber |
|---|---|---|
| D1 — baca | 5 juta baris/hari | docs Cloudflare D1 pricing |
| D1 — tulis | 100.000 baris/hari | docs Cloudflare D1 pricing |
| D1 — penyimpanan | 5 GB total, 500 MB/basis data | docs Cloudflare D1 limits |
| D1 — kueri per invocation | **50 (Free)** vs 1000 (Paid) | docs Cloudflare D1 limits |
| R2 — penyimpanan | 10 GB-bulan | docs Cloudflare R2 pricing |
| R2 — operasi A | 1 juta/bulan | docs Cloudflare R2 pricing |
| R2 — operasi B | 10 juta/bulan | docs Cloudflare R2 pricing |
| R2 — egress | Gratis | docs Cloudflare R2 pricing |
| Queues | 10.000 operasi/hari, retensi 24 jam di free | changelog Queues 2026-02-04 |
| Workers AI | 10.000 Neurons/hari, reset 00:00 UTC | docs Workers AI pricing |
| Groq Whisper | 28.800 detik audio/hari, 20 permintaan/menit | docs Groq rate limits |

### Batas yang paling mengikat

**D1 free hanya mengizinkan 50 kueri per invocation Worker.** Ini jauh lebih ketat daripada 1000
pada paket berbayar, dan akan menggigit jika ada kode yang melakukan kueri di dalam perulangan.
Aturan yang mengikat: setiap penanganan permintaan wajib memakai kueri berkelompok (`batch()`),
dan pola N+1 dilarang. Ini diuji, bukan diandalkan pada disiplin.

**Workers AI 10.000 Neurons/hari** setara sekitar 7 penyuntingan gambar `flux-2-klein-9b` atau
sekitar 170 gambar draf `flux-1-schnell` per hari. Untuk latihan demo berulang, ini akan habis.
Konsekuensinya: aset demo wajib di-cache, dan latihan memakai hasil yang sudah tersimpan.

## 8. Strategi penyedia AI

```
┌──────────────────────────────────────────────────────────┐
│ Antarmuka: ImageProvider                                 │
│   generate(photo, stylePrompt) → Promise<ImageResult>     │
├──────────────────────────────────────────────────────────┤
│ 1. GeminiWebProvider   (Studio Agent, batas waktu 45s)   │
│ 2. WorkersAIProvider   (flux-2-klein-9b)   ← selalu siap  │
│ 3. CachedProvider      (aset pra-produksi) ← jaring akhir │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ Antarmuka: TranscriptionProvider                         │
│   transcribe(audio, locale) → Promise<Transcript>         │
├──────────────────────────────────────────────────────────┤
│ 1. GroqProvider        (whisper-large-v3-turbo)          │
│ 2. WorkersAIProvider   (@cf/openai/whisper-large-v3-turbo)│
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ Antarmuka: TextProvider                                  │
│   generate(transcript, locale, task) → Promise<Content>   │
├──────────────────────────────────────────────────────────┤
│ 1. NineRouterProvider  (model dipilih per tugas)         │
│ 2. WorkersAIProvider   (model teks Workers AI)           │
└──────────────────────────────────────────────────────────┘
```

Setiap antarmuka punya minimal dua implementasi. Tidak ada satu penyedia pun yang, bila mati,
menghentikan demo.

### Mengapa ASR bukan Whisper Large-v3 lokal

Proposal menyebut Whisper Large-v3. Model itu membutuhkan sekitar 3,9 GB memori runtime menurut
tabel resmi whisper.cpp, sementara memori bebas terukur hanya 1,7 GB. Ia tidak muat.

Kandidat "SOTA" lain gugur karena alasan yang lebih mendasar — **tidak mendukung Bahasa Indonesia**:

| Model | Bahasa didukung | Indonesia? |
|---|---|---|
| NVIDIA Parakeet-TDT-0.6B-v3 | 25 bahasa Eropa | Tidak |
| NVIDIA Canary-1B-v2 | 25 bahasa Eropa | Tidak |
| Moonshine | English-only | Tidak |
| Kyutai STT | EN, EN+FR | Tidak |
| Mistral Voxtral-Mini-3B | 8 bahasa Eropa | Tidak |
| AssemblyAI Universal-3.5 Pro | 18 bahasa | Tidak |

Yang tersisa dan mendukung Indonesia: keluarga Whisper (99 bahasa) dan SeamlessM4T (lisensi
non-komersial, 9 GB — gugur). Maka pilihannya Whisper, dijalankan di cloud, bukan lokal.

**Peringatan akurasi yang wajib diketahui tim:** AssemblyAI menempatkan bahasa Jawa pada kelompok
WER di atas 50%. Bahasa Indonesia baku beraksen daerah akan tertranskripsi baik; campur kode dengan
bahasa daerah akan kacau. Inilah alasan kedua mengapa langkah tinjau transkrip (bagian 5, langkah 8)
tidak opsional. Untuk demo, skrip narasi memakai Bahasa Indonesia baku.

## 9. Ketahanan saat demo

Tiga lapis, dari yang paling diinginkan sampai jaring terakhir:

| Lapis | Kondisi | Perilaku |
|---|---|---|
| 1 | Semua normal | Pipeline penuh berjalan langsung |
| 2 | Satu penyedia gagal atau lambat | Fallback otomatis, pengguna hanya melihat progres sedikit lebih lama |
| 3 | Jaringan putus total | Service Worker menyajikan produk demo yang sudah di-cache; alur tetap dapat ditelusuri |

Lapis 3 disiapkan sebagai **mode demo yang eksplisit**, diaktifkan lewat feature flag, bukan
tipuan. Bila diaktifkan, antarmuka menampilkan penanda bahwa data berasal dari cache. Menyembunyikan
hal ini akan melanggar R-36 (larangan klaim yang dibuat-buat) dan berisiko lebih besar bila juri
menyadarinya.

## 10. Rencana penerapan

```
Pengembangan
  PWA            → next dev            localhost:3000
  Worker         → wrangler dev        localhost:8787
  D1             → miniflare lokal     berkas .wrangler/
  R2             → miniflare lokal     berkas .wrangler/
  Studio Agent   → node agent/         Chrome dengan profil khusus

Produksi
  PWA            → Cloudflare Pages
  Worker         → Cloudflare Workers
  D1             → D1 (region otomatis)
  R2             → R2
  Studio Agent   → laptop, dijalankan manual sebelum demo
  Android        → Bubblewrap → APK bertanda tangan
```

Studio Agent tidak pernah diterapkan ke cloud. Ia membutuhkan Chrome asli dengan profil login.

## 11. Yang belum diputuskan

| # | Pertanyaan | Diukur pada |
|---|---|---|
| O1 | Model 9router mana untuk tiap tugas teks? Perlu tolok ukur kualitas Bahasa Indonesia. | Minggu 3 |
| O2 | Berapa waktu nyata generate Gemini web? Batas 45 detik adalah tebakan berdasar. | **Minggu 1** — uji tembak |
| O3 | Apakah D1 free 500 MB per basis data cukup? Bergantung volume teks. | Minggu 5 |
| O4 | TTS mana untuk Bahasa Indonesia yang terdengar wajar? | **Minggu 4** — uji dengar |
| O5 | Berapa neuron nyata per gambar untuk ukuran keluaran yang dipakai? Menentukan jatah gratis harian. | **Minggu 1** — uji tembak |
| O6 | Berapa biaya token 9router per katalog? Diperlukan ADR-007 untuk klaim biaya. | Minggu 3 |

Kolom "Diukur pada" selaras dengan `docs/ops/ROADMAP.md`. Bila jadwal di salah satu berubah,
keduanya diperbarui bersamaan.

Pertanyaan-pertanyaan ini dijawab dengan pengukuran, bukan asumsi. Sampai terjawab, ia tetap
tercatat terbuka di sini.
