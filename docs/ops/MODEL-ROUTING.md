# Pemetaan Model per Modul

Menentukan modul mana dikerjakan model frontier dan mana cukup model biasa, beserta prompt siap
pakai untuk tiap modul kritis.

---

## Dasar pemetaan

Kriterianya bukan kesulitan, melainkan **biaya kegagalan**. Sebuah modul masuk tingkat tertinggi
bila memenuhi salah satu dari ini:

| Sifat | Mengapa berbahaya |
|---|---|
| Kegagalan tidak terlihat sampai terlambat | Lubang keamanan lolos seluruh pengujian naif |
| Kegagalan menghentikan demo | Penilaian final adalah demo langsung |
| Kebenaran menuntut penalaran berlapis | Race condition, pembatalan, status yang berpindah |
| Kegagalan merusak nilai inti produk | Aksesibilitas adalah alasan produk ini ada |

Modul yang kegagalannya **langsung terlihat** saat dijalankan tidak butuh frontier. Anda akan
melihatnya sendiri dalam hitungan detik.

---

## Tabel pemetaan

| Modul | Tingkat | Alasan | Kasus uji |
|---|---|---|---|
| `worker/rbac` | **Frontier** | Kegagalan tak terlihat. Cakupan 95%, mutasi 70%. | TC-U-RBAC-01..13, TC-I-04, TC-SEC-16 |
| `worker/jobs` | **Frontier** | Menghentikan demo. Race condition dan pembatalan. | TC-U-JOB-01..10, TC-E2E-10..13 |
| `agent/` Studio Agent | **Frontier** | Paling rapuh. Proses, CDP, deteksi sesi mati. | TC-SA-01..07 |
| `worker/auth` | **Frontier** | Enumerasi, penguncian, rotasi token. | TC-SEC-01..05, 12..14 |
| Accessibility Mode + ARIA | Frontier | Nilai inti. axe-core hanya menangkap sepertiga. | TC-A11Y-01..29 |
| Lapisan kueri D1 | Frontier | Batas 50 kueri hanya meledak di produksi. | TC-PERF-04 |
| `worker/media` | Menengah | Validasi magic bytes, URL bertanda tangan. | TC-U-CAT-04..06, TC-SEC-09..11 |
| `worker/catalog` | Menengah | CRUD dengan aturan status. | TC-I-01..03 |
| Alur enam langkah | Menengah | Manajemen state, auto save. | TC-E2E-01..03, 23, 25 |
| Talking-Catalog | Menengah | Sinkronisasi subtitle ±200 ms. | TC-A11Y-24, 28 |
| `worker/export` | Biasa | Deterministik, kegagalan terlihat. | TC-E2E-07, 08 |
| Komponen UI | Biasa | Kegagalan terlihat di layar. | TC-A11Y-03..07 |
| Halaman katalog publik | Biasa | Render statis. | TC-E2E-06 |
| i18n dan terjemahan | Biasa | Pemetaan data. | TC-E2E-09 |
| Tutorial interaktif | Biasa | Tidak ada logika berisiko. | — |

### Urutan pengerjaan

Frontier lebih dulu, bukan belakangan. `rbac` dan `jobs` adalah fondasi yang dipanggil hampir
semua modul lain. Menulisnya setelah UI berarti menulis ulang UI.

```
Minggu 1-2  : rbac, jobs, auth, lapisan kueri D1   <- frontier
Minggu 3-4  : media, catalog, Accessibility Mode    <- frontier + menengah
Minggu 5-6  : alur enam langkah, Talking-Catalog    <- menengah
Minggu 7    : export, UI, i18n                      <- biasa
```

---

## Prompt siap pakai

Prompt di bawah ditulis untuk ditempel langsung. Masing-masing memuat konteks, kriteria penerimaan,
dan **jebakan yang harus dihindari** — bagian terakhir yang paling menentukan.

### P1 — `worker/rbac` (Frontier)

```
Baca dulu: AGENTS.md, docs/ARCHITECTURE.md bagian 6, docs/spec/FEATURE-SPECS.md
bagian S3, docs/spec/API-CONTRACT.md bagian 9, docs/testing/TEST-PLAN.md bagian 3.

Tulis modul worker/rbac dengan pendekatan tes lebih dulu.

Tanggung jawab:
- Fungsi izin murni: canViewProduct, canEditDraft, canUploadMedia,
  canSubmitReview, canPublish, canDeleteProduct, canCurate
- Pemuatan tautan pendamping beserta izinnya
- Verifikasi token_version

Aturan yang mengikat:
1. Default MENOLAK. Peran tidak dikenal, izin tidak dikenal, atau tautan
   berstatus apa pun selain 'active' mengembalikan false.
2. Pendamping TIDAK PERNAH dapat menerbitkan atau menghapus. Keduanya tidak
   ada dalam daftar izin yang dapat diberikan.
3. Admin mengurasi, tidak menyunting isi katalog.
4. Pencabutan berlaku SEKETIKA: naikkan users.token_version dan periksa
   nilainya pada setiap permintaan. Mengubah status baris saja tidak cukup
   karena token lama masih sah sampai kedaluwarsa.
5. Fungsi izin murni, tanpa I/O. Data dimuat pemanggil lalu dioper masuk.
   Ini yang membuat 13 kasus uji berjalan tanpa basis data.

Kriteria penerimaan:
- TC-U-RBAC-01 sampai TC-U-RBAC-13 lolos
- Cakupan baris >= 95%, skor mutasi Stryker >= 70%
- Tidak ada `any`, tidak ada `@ts-ignore`

JEBAKAN yang harus dihindari:
- Menulis `if (link.status !== 'revoked') return true` — ini mengizinkan
  status 'pending' dan 'expired'. Periksa secara positif: `=== 'active'`.
- Lupa memeriksa expires_at meski status 'active'
- Memeriksa token_version hanya saat masuk, bukan pada setiap permintaan
- Menggabungkan pemeriksaan izin dengan kueri basis data sehingga tidak
  dapat diuji tanpa D1
- Mengembalikan true saat data tautan bernilai null

Setelah selesai, jalankan: pnpm run test && pnpm run test:mutation
```

### P2 — `worker/jobs` rantai penyedia (Frontier)

```
Baca dulu: AGENTS.md, docs/ARCHITECTURE.md bagian 4 dan 8,
docs/adr/ADR-004-image-provider.md, docs/spec/API-CONTRACT.md bagian 7 dan 8.

Tulis modul worker/jobs dengan pendekatan tes lebih dulu.

Tanggung jawab:
- Antarmuka ImageProvider, TranscriptionProvider, TextProvider
- Rantai fallback dengan batas waktu
- Siklus hidup pekerjaan: queued, running, succeeded, failed, cancelled
- Konsumen antrian

Rantai yang wajib:
  Gambar : GeminiWeb (batas 45 detik) -> WorkersAI -> Cache
  ASR    : Groq -> WorkersAI
  Teks   : 9router -> WorkersAI

Aturan yang mengikat:
1. Batas waktu memakai AbortController. Penyedia yang mengembalikan hasil
   SETELAH dibatalkan diabaikan sepenuhnya — hasilnya tidak boleh menimpa
   hasil dari penyedia berikutnya.
2. Tanpa heartbeat agen yang sehat selama 30 detik, pekerjaan gambar LANGSUNG
   menuju WorkersAI tanpa menunggu 45 detik.
3. Transisi status hanya maju. succeeded -> running ditolak.
4. Kegagalan satu bahasa tidak menggagalkan bahasa lain. Setiap bahasa
   adalah pekerjaan terpisah dengan baris product_content sendiri.
5. Maksimum 3 percobaan per pekerjaan.
6. Galat memakai error_code, bukan pesan mentah. Daftar lengkapnya ada di
   docs/spec/API-CONTRACT.md bagian 12.

Kriteria penerimaan:
- TC-U-JOB-01 sampai TC-U-JOB-10 lolos
- Cakupan baris >= 90%, skor mutasi >= 70%
- Mematikan penyedia mana pun tidak menghentikan pipeline

JEBAKAN yang harus dihindari:
- Memakai Promise.race tanpa membatalkan yang kalah — penyedia yang kalah
  tetap berjalan dan membuang kuota
- Menulis hasil dari panggilan yang sudah dibatalkan
- Percobaan ulang tanpa batas saat penyedia mengembalikan 429
- Menganggap pekerjaan gagal saat sebenarnya masih berjalan
- Menyimpan pesan galat penyedia langsung ke basis data lalu
  menampilkannya ke pengguna
- Lupa mengembalikan pekerjaan ke antrian saat agen mati di tengah jalan

Setelah selesai, jalankan: pnpm run test && pnpm run test:integration
```

### P3 — Studio Agent (Frontier)

```
Baca dulu: AGENTS.md, docs/adr/ADR-004-image-provider.md,
docs/spec/API-CONTRACT.md bagian 8, docs/testing/TEST-PLAN.md bagian 9.

Tulis agent/ sebagai proses Node.js yang berjalan di laptop.

Tanggung jawab:
- Menjalankan Chrome ASLI lewat subprocess dengan --remote-debugging-port
  dan --user-data-dir, lalu menghubungkannya dengan connectOverCDP
- Menarik pekerjaan lewat HTTP pull consumer
- Mengirim heartbeat setiap 15 detik
- Mengunggah hasil ke R2 dan menandai pekerjaan selesai

Aturan yang mengikat:
1. JANGAN memakai Chromium bawaan Playwright. Google terbukti memblokirnya
   dengan pesan "This browser or app may not be secure". Gunakan Chrome asli
   yang dijalankan lewat subprocess.
2. JANGAN mengotomasi proses masuk. Login dilakukan manusia satu kali; agen
   hanya menggerakkan sesi yang sudah terautentikasi.
3. Pemeriksaan kesehatan saat mulai: verifikasi selector dan status login.
   Bila gagal, daftarkan diri sebagai tidak sehat dan JANGAN mengambil
   pekerjaan.
4. Satu pekerjaan pada satu waktu. max=1 pada claim.
5. Batas waktu memakai deadlineAt absolut dari server, bukan durasi lokal.
6. Gagal cepat. Satu percobaan lalu menyerah; jangan mencoba ulang sendiri.
7. Setiap kegagalan menyertakan reason: selector_not_found, session_expired,
   timeout, generation_refused, atau unknown.

Kriteria penerimaan:
- TC-SA-01 sampai TC-SA-07 lolos
- Mematikan agen di tengah pekerjaan mengembalikan pekerjaan ke antrian
- Selector yang pecah terdeteksi dalam 5 detik, bukan 45

JEBAKAN yang harus dihindari:
- Camoufox atau undetected-chromedriver. Ada bukti Camoufox terdeteksi Google,
  dan undetected-chromedriver tidak terpelihara sejak Juli 2025.
- Menyimpan kredensial Google di mana pun dalam kode
- Menulis profil Chrome ke dalam repositori — ia memuat sesi login
- setTimeout tanpa membersihkannya saat pekerjaan selesai lebih dulu
- Menganggap Chrome masih hidup tanpa memeriksa proses
- Keluar tanpa mengirim status kegagalan ke server

PERINGATAN: gunakan akun Google TERPISAH. Sanksi ToS dapat mencakup
penghapusan seluruh akun termasuk Gmail dan Drive.
```

### P4 — `worker/auth` (Frontier)

```
Baca dulu: AGENTS.md, docs/PRD.md bagian 6, docs/spec/API-CONTRACT.md
bagian 2, docs/testing/TEST-PLAN.md bagian 8.

Tulis modul worker/auth dengan pendekatan tes lebih dulu.

Tanggung jawab:
- Permintaan dan verifikasi OTP
- Penetapan dan verifikasi PIN 6 digit
- Penerbitan, penyegaran, dan pembatalan token

Aturan yang mengikat:
1. Respons /auth/otp/request SERAGAM untuk nomor terdaftar maupun tidak.
   Respons yang berbeda memungkinkan penyerang memetakan pengguna — untuk
   platform yang melayani kelompok rentan, ini bukan masalah kecil.
2. PIN disimpan sebagai hash Argon2id, tidak pernah plaintext, tidak pernah
   dengan MD5 atau SHA saja.
3. Salah 5 kali mengunci akun 15 menit.
4. Batas laju: 3 OTP per nomor per jam, 10 per IP per jam.
5. Access token 15 menit, refresh token 30 hari sejak aktivitas terakhir.
6. Setiap token memuat token_version. Permintaan dengan versi yang lebih
   rendah dari nilai di basis data ditolak.
7. logout-all menaikkan token_version.

Kriteria penerimaan:
- TC-SEC-01 sampai TC-SEC-05, TC-SEC-12 sampai TC-SEC-14, TC-SEC-21 lolos

JEBAKAN yang harus dihindari:
- Membandingkan OTP atau PIN dengan === biasa — gunakan perbandingan
  berwaktu tetap untuk mencegah timing attack
- Respons berbeda untuk nomor terdaftar dan tidak terdaftar
- Batas laju yang disimpan di memori Worker — isolat dapat dimatikan
  kapan saja, gunakan D1 atau KV
- Token tanpa masa berlaku
- Lupa memeriksa token_version pada jalur refresh
```

### P5 — Accessibility Mode dan ARIA (Frontier)

```
Baca dulu: DESIGN.md, docs/design/DESIGN-SYSTEM.md bagian 9,
docs/spec/FEATURE-SPECS.md bagian S1 dan S6,
docs/testing/TEST-PLAN.md bagian 6.

Bangun Accessibility Mode dan lapisan ARIA.

Aturan yang mengikat:
1. Lima profil dapat digabung: visual, hearing, motor, cognitive, voice.
2. Pilihan tersimpan di server agar berlaku lintas perangkat.
3. Target sentuh minimum 56px, profil Motorik 72px dengan jarak 16px.
4. Setiap elemen interaktif punya ENAM status: default, hover, focus-visible,
   active, disabled, loading.
5. Fokus: outline 3px solid var(--focus-ring) dengan offset 2px. Tidak pernah
   `outline: none` tanpa pengganti yang lebih terlihat.
6. Status tidak pernah disampaikan lewat warna saja.
7. Perubahan status diumumkan lewat aria-live. Ini penting pada langkah
   pemrosesan yang berjalan 60 detik: pengguna screen reader harus mendengar
   kemajuannya, bukan menunggu dalam senyap.
8. Ikon selalu berdampingan label teks.

Kriteria penerimaan:
- TC-A11Y-01 sampai TC-A11Y-12 lolos otomatis
- 0 pelanggaran axe-core serius atau kritis
- Alur penuh dapat diselesaikan hanya dengan papan ketik (TC-E2E-03)

JEBAKAN yang harus dihindari:
- aria-label pada elemen yang sudah punya teks terlihat — screen reader
  akan membacanya dua kali
- role="button" pada div padahal <button> tersedia
- tabindex positif
- aria-live="assertive" untuk hal yang tidak mendesak — ia memotong
  pembacaan yang sedang berjalan
- Menganggap axe-core hijau berarti aksesibel. Ia menangkap sekitar
  sepertiga masalah. Uji manual dengan NVDA dan TalkBack tetap wajib.
- Placeholder sebagai satu-satunya label input
- Animasi yang tetap berjalan di bawah prefers-reduced-motion

Jalankan setelah selesai: pnpm run test:e2e:a11y && python tools/contrast.py
```

### P6 — Lapisan kueri D1 (Frontier)

```
Baca dulu: AGENTS.md aturan 1, docs/ARCHITECTURE.md bagian 7,
docs/adr/ADR-006-data-store.md, docs/testing/TEST-PLAN.md bagian 7.

Bangun lapisan akses data D1 dan penghitung kueri untuk pengujian.

Aturan yang mengikat:
1. D1 paket gratis mengizinkan 50 kueri per invocation Worker, bukan 1000.
2. Ambang pengujian 25 kueri, memberi ruang aman.
3. Pola N+1 dilarang. Gunakan db.batch().
4. Paginasi berbasis kursor, bukan OFFSET. OFFSET yang besar memindai
   seluruh baris sebelumnya.
5. GET /products/:id mengembalikan produk, konten seluruh bahasa, media,
   pekerjaan, dan transkrip dalam SATU invocation di bawah 25 kueri.

Kriteria penerimaan:
- TC-PERF-04 lolos: seluruh rute di bawah 25 kueri
- Penghitung kueri berjalan di pengujian integrasi dengan D1 asli Miniflare

JEBAKAN yang harus dihindari:
- Kueri di dalam Array.map atau forEach
- await di dalam perulangan
- SELECT * saat hanya perlu beberapa kolom
- Menghitung kueri dengan tiruan alih-alih D1 asli — tiruan akan
  menyembunyikan justru masalah yang dicari
- Transaksi yang menahan koneksi lebih lama dari perlunya
```

---

## Cara memakai prompt ini

1. Buka sesi baru untuk tiap modul. Konteks yang bercampur menurunkan mutu.
2. Tempel prompt apa adanya. Bagian "JEBAKAN" adalah yang paling menentukan — jangan dihapus.
3. Minta pengujian ditulis lebih dulu untuk modul frontier.
4. Jalankan `pnpm run verify` sebelum menerima hasil.
5. Untuk `rbac` dan `jobs`, jalankan juga `pnpm run test:mutation`.

### Tanda hasil perlu ditolak

| Tanda | Artinya |
|---|---|
| Ada `any` atau `@ts-ignore` | Model menghindari masalah tipe, bukan menyelesaikannya |
| Pengujian diubah agar lolos | Pengujian melemah, bug tetap ada |
| `catch` kosong atau hanya `console.log` | Galat ditelan |
| Abstraksi tanpa konsumen kedua | Kompleksitas spekulatif |
| Cakupan tinggi tapi mutasi rendah | Pengujian menjalankan kode tanpa memeriksa hasilnya |
| Pesan galat memuat istilah teknis | Melanggar aturan 2 di AGENTS.md |

---

## Anggaran penggunaan frontier

Bila kuota model frontier terbatas, prioritasnya:

```
1. worker/rbac        <- tidak dapat dinegosiasikan, ini keamanan
2. worker/jobs        <- tidak dapat dinegosiasikan, ini demo
3. agent/             <- dapat ditunda bila Gemini dimatikan lewat feature flag
4. worker/auth        <- dapat dikerjakan model menengah dengan pengawasan ketat
5. Accessibility      <- dapat dikerjakan model menengah + uji manual intensif
6. Lapisan D1         <- dapat dikerjakan model menengah + TC-PERF-04 sebagai gerbang
```

Dua teratas tidak boleh dipotong. Kegagalan di sana tidak terlihat sampai terlambat — dan pada
lomba dengan penilaian demo langsung, "terlambat" berarti di atas panggung.
