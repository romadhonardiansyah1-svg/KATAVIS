# Status Kesiapan Demo — KATAVIS

**Tanggal:** 21 September 2026
**Ruang lingkup:** penyelesaian fitur yang berjalan sebagian, perbaikan penghambat demo, dan
pemastian alur utama berjalan stabil end-to-end.

---

## 1. Ringkasan hasil

| Gerbang | Sebelum sesi ini | Sesudah |
|---|---|---|
| `pnpm run verify` (unit) | 571 lulus | **601 lulus** |
| `pnpm run test:integration` (workerd + D1) | 83 lulus | **85 lulus** |
| E2E `android-chrome` | 121 lulus / 2 dilewati / **3 gagal** | **126 lulus / 0 gagal / 0 dilewati** |
| E2E `reduced-motion` (aksesibilitas) | — | **21 lulus** |
| E2E seluruh empat peramban | 4 gagal | **398 lulus / 1 dilewati jujur / 0 gagal** |

`typecheck` bersih. `lint` bersih. Kontras 16 pasangan sesuai `DESIGN.md`. 136 rujukan silang
ID kasus uji menunjuk sasaran yang ada.

Tiga kegagalan yang ada di awal sesi seluruhnya `TC-E2E-26 notifikasi multimodal` — fitur yang
tidak ada di kode. Ketiganya kini hijau karena fiturnya dibangun, bukan karena pengujiannya
dilonggarkan.

---

## 2. Yang sudah selesai

### 2.1 Notifikasi multimodal dibangun — `lib/notify.ts`

`S10` di FEATURE-SPECS berstatus **Wajib**, tetapi tidak ada satu pun pemakaian
`navigator.vibrate` dan tidak ada kanal audio di seluruh kode.

Modul baru memuat dua kanal yang belum ada (audio + getar). Kanal visualnya sengaja tidak
disentuh karena sudah ada di `StepShell` dan tiap halaman — menggandakannya akan menciptakan dua
sumber kebenaran.

Tiga keputusan rancangan yang dulu terbuka, kini terjawab:

1. **Modul tersendiri**, bukan ditambahkan ke `StepShell`.
2. **Nada dibangkitkan `OscillatorNode`**, bukan berkas di `public/` — `public/` belum ada, dan
   ini membuat S10-02 (nada berhasil dan gagal wajib berbeda) terjamin secara struktural: nada
   sukses menaik, nada gagal menurun dan lebih rendah.
3. **Getar dari satu titik terpusat.** S10-03 menuntut ketiadaan Vibration API tidak melempar;
   itu jauh lebih mudah dijamin bila pemanggilannya hanya ada di satu tempat yang memeriksa
   `typeof` lebih dulu.

Peristiwa "Katalog selesai" memakai **kalimat yang diucapkan**, bukan nada: nada tidak memberi
tahu pengrajin tunanetra bahwa katalognya terbit.

**Dampak demo:** saat juri menekan tombol pada alur, perangkat berbunyi dan bergetar — dan bila
perangkat tidak mendukungnya, tidak ada galat sama sekali.

### 2.2 Talking-Catalog dihidupkan — `worker/catalog/narration.ts`

`narration.captions` selalu `[]` sejak awal, dan `TalkingCatalog` mengembalikan `null` bila
lariknya kosong. Artinya **fitur F3 tidak pernah tampil sama sekali** — bukan tampil tanpa suara,
melainkan tidak ada. Ini fitur yang disebut namanya di proposal.

Kunci pembebasannya: ADR-005 mencatat penyedia TTS sebagai keputusan terbuka (O4), tetapi dua hal
itu sesungguhnya tidak saling mengunci.

- **Audio** bergantung pada penyedia suara — belum diputuskan.
- **Naskah berwaktu** hanyalah pembagian `story` menjadi kalimat — tanpa penyedia, tanpa jaringan.

Yang dikerjakan hanya yang kedua. `audioUrl` tetap `null`, dan pemutar sudah menangani keadaan
itu sebagai keadaan yang sah (F3-03 memang menuntut fitur berfungsi penuh tanpa suara). Bila TTS
ditambahkan kelak, yang berubah hanya `audioUrl` — naskah berwaktunya sudah menunggu.

**Dampak demo:** halaman katalog publik sekarang menampilkan pemutar, avatar, dan subtitle yang
dapat disalin — di lima bahasa sekaligus.

### 2.3 Dua gerbang palsu dibongkar

**Stub mati di E2E.** Dua berkas uji memasang stub untuk `GET /public/catalog/:slug`. Halaman
katalog adalah Server Component — pengambilannya terjadi di server Next.js, dan `page.route`
bekerja di tingkat peramban sehingga **tidak pernah melihat permintaan itu**. Stubnya tidak
pernah dipakai, dan teksnya berbeda dari yang tersemai, sehingga kasus ujinya lulus atau gagal
karena kebetulan. Setelah naskah berwaktu hidup, dua kasus yang dulu "lulus" pecah dengan
strict-mode violation karena kalimat cerita yang sama kini muncul di empat tempat yang sah.
Stubnya dihapus; locator dipersempit; pagarnya diganti ke syarat yang sebenarnya.

**Bendera mati `GEMINI_ENABLED`.** Dideklarasikan, diisi `"false"`, dan **tidak pernah dibaca satu
baris pun kode** — sementara `DEMO-RUNBOOK` dan `DEMO-VIDEO-GUIDE` menyuruh operator
memeriksanya sebelum naik panggung. Bendera dihapus, bukan diimplementasikan: jalur GeminiWeb
sesungguhnya dijaga denyut Studio Agent.

`RISK-REGISTER.md` ikut dikoreksi. R-02 mitigasi #4 menjanjikan "feature flag untuk mematikan
jalur Gemini dalam hitungan detik" — janji yang tidak pernah dapat ditepati. Diganti dengan cara
yang benar-benar bekerja: hentikan proses agennya. **Mitigasi yang dipercaya tetapi tidak
terhubung ke apa pun lebih berbahaya daripada tidak ada mitigasi**, karena saat selector Gemini
pecah di panggung, yang menekannya akan menekan sakelar mati.

### 2.4 Dokumen yang diselaraskan

| Dokumen | Perubahan |
|---|---|
| `docs/spec/FEATURE-SPECS.md` | S10 mencatat letak implementasi; F3 mencatat sumber naskah berwaktu |
| `docs/ops/DEMO-RUNBOOK.md` | Baris feature flag dikoreksi |
| `docs/ops/DEMO-VIDEO-GUIDE.md` | Baris feature flag dikoreksi |
| `docs/ops/RISK-REGISTER.md` | R-02 mitigasi #4 dikoreksi dengan penjelasan sebabnya |

---

## 3. Yang masih perlu diperhatikan

### 3.1 Suara narasi katalog belum ada

`audioUrl` masih `null`. Subtitle, jam, penyorotan kalimat, dan seluruh cerita sebagai teks sudah
bekerja — yang belum ada hanya suaranya. Keputusan penyedia menunggu O4 di ADR-005.

**Untuk demo, ini tidak menghalangi.** Pemutar sudah menjelaskan keadaannya sendiri kepada
pembeli: *"Suara tidak tersedia. Seluruh cerita tetap terbaca di bawah."* Bila juri bertanya,
jawabannya adalah keputusan yang sudah terdokumentasi, bukan kelalaian.

### 3.2 Mekanisme notifikasi di WebKit

WebKit di lingkungan uji tidak menyediakan Web Audio sama sekali (`AudioContext` **dan**
`webkitAudioContext` keduanya `undefined`). Kanal audio karenanya mustahil di sana, dan satu
kasus uji dilewati dengan alasan yang menyebutkan hal itu. Perilaku produknya justru benar:
`lib/notify.ts` diam tanpa melempar — itulah S10-03.

Peramban sesungguhnya di ponsel Android dan iOS menyediakan Web Audio, jadi ini keterbatasan
lingkungan uji, bukan produk.

### 3.3 Studio Agent harus hidup untuk jalur Gemini

Tiga lapis fallback gambar tetap wajib berurutan: `GeminiWeb (45 detik) → WorkersAI → Cache`.
Bila agennya mati, rantai melewatinya sendiri tanpa menunggu — tetapi jalur utamanya tidak
terpakai. Periksa denyut agen di H-0.

### 3.4 Pekerjaan rumah yang sudah teridentifikasi sejak sebelum sesi ini

- `wrangler login` belum dilakukan; penyediaan Cloudflare jarak jauh belum dapat dikerjakan.
- Login sekali-jalan Gemini di profil Chrome Studio Agent.
- `gitleaks` belum pernah benar-benar dijalankan (Docker tidak ada di mesin ini), meski
  konfigurasinya sudah benar.
- Kebersihan repositori: `.tmp-fix.py`, `.tmp-fix2.py`, dan status `.workbuddy-ai/`; repositori
  masih belum punya satu pun commit meski 200+ berkas sudah ter-*stage*.

---

## 4. Langkah selanjutnya setelah demo

Urutan berdasarkan nilai, bukan kelengkapan.

1. **Putuskan penyedia TTS Bahasa Indonesia (O4, ADR-005).** Dengarkan keluaran nyata dari dua
   kandidat sebelum memilih — bukan berdasarkan klaim pemasaran. Setelah diputuskan, yang perlu
   diubah hanya `audioUrl`; naskah berwaktunya sudah siap.

2. **`wrangler login` lalu penyediaan jarak jauh.** D1, R2, Queues, dan rahasia produksi. Ini
   membuka W5 di rencana eksekusi yang tertunda menunggu pemilik.

3. **Simpan pekerjaan dengan commit pertama.** Repositori ini belum punya satu pun commit meski
   lebih dari dua ratus berkas sudah ter-*stage*. Ruang kerja tanpa riwayat adalah ruang kerja
   yang tidak dapat di-`revert` saat demo rusak.

4. **Jalankan `gitleaks` di CI yang punya Docker** untuk memastikan konfigurasi
   `.gitleaks.toml` benar-benar bekerja, bukan hanya terpasang.

5. **Perluas `TC-E2E-26` ke layar katalog selesai.** Kasus uji yang ada memverifikasi peristiwa
   "Foto tersimpan"; peristiwa "Katalog selesai" sudah diimplementasikan tetapi belum diuji
   end-to-end.

---

## 5. Catatan operasional penting

`pnpm run dev:worker` menumbuhkan rantai proses yang panjang. **Membunuh `workerd` saja membuat
induknya segera menumbuhkannya kembali** dengan PID baru pada port yang sama. Yang benar: cari
pemegang port, lalu hentikan seluruh pohon prosesnya (`taskkill /PID <induk> /T /F`).

Sesi ini juga menemukan `workerd` yatim dari sesi sebelumnya yang menahan port 8787, sehingga
Worker baru terpaksa pindah ke 8788 — dan probe ke 8787 gagal tanpa penjelasan. **Selalu periksa
port yang benar-benar didengarkan di log, jangan menganggap 8787.**

---

## 6. Yang tidak diubah

Tidak ada pengujian yang dilemahkan, tidak ada yang dihapus, tidak ada ambang cakupan yang
diturunkan, tidak ada kode galat baru, tidak ada perubahan skema basis data, tidak ada dependensi
baru, dan `docs/spec/API-CONTRACT.md` tidak disentuh.
