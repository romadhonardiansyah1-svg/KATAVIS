# Status Demo — 22 September 2026

Sesi lanjutan dari `STATUS-DEMO-2026-09-21.md`. Dokumen itu tetap berlaku sebagai catatan
keadaan sebelum sesi ini; yang di bawah adalah apa yang berubah sesudahnya.

Dua belas perubahan, seluruhnya diperiksa dengan `pnpm run verify` yang keluar `0`.

---

## 1. Ringkasan

| # | Perubahan | Jenis | Berkas |
|---|---|---|---|
| 1 | Consumer antrian hidup | Fitur belum selesai | `worker/jobs/consumer.ts` |
| 2 | Tujuh penyedia AI konkret | Fitur belum selesai | `worker/jobs/providers-impl.ts` |
| 3 | Akses D1 untuk consumer | Fitur belum selesai | `worker/jobs/d1-queue.ts` |
| 4 | Muatan pekerjaan terdefinisi | Fitur belum selesai | `worker/jobs/payload.ts` |
| 5 | Layar masuk OTP | Fitur belum selesai | `app/masuk/` |
| 6 | Sesi menyimpan token penyegar | Perbaikan | `lib/session.ts` |
| 7 | Layar awal menjaga sesi | Perbaikan | `app/page.tsx` |
| 8 | Pekerjaan diserahkan ke antrian | Perbaikan | `worker/index.ts` |
| 9 | `PUBLIC_BASE_URL` di `Env` | Perbaikan | `worker/index.ts` |
| 10 | Baris `DEMO-RUNBOOK` yang salah | Perbaikan | `docs/ops/DEMO-RUNBOOK.md` |
| 11 | Bendera mati terakhir dibersihkan | Perbaikan | `.env.example`, `docs/ops/RISK-REGISTER.md` |
| 12 | Panduan kerja manual | Dokumentasi | `docs/ops/PANDUAN-MANUAL.md` |
| 13 | R-16: beban agen menganggur | Dokumentasi | `docs/ops/RISK-REGISTER.md` |

Angka sesudahnya: **664 uji unit** (dari 616), **153 ID kasus uji** (dari 142), nol duplikat,
kontras 16 pasangan LOLOS, `check_refs.py` LOLOS.

---

## 2. Yang belum selesai, diselesaikan

### 2.1 Consumer antrian hidup

**Keadaan sebelumnya.** `async queue(_batch, _env) { }` — sebuah stub kosong dengan komentar
`// Konsumen pekerjaan AI.` Akibatnya jelas dan langsung terasa di demo: `POST
/products/:id/generate` menulis baris `jobs` dengan status `queued`, dan **tidak ada apa pun
yang pernah mengubahnya**. Layar proses berputar selamanya pada nol persen. Yang menyelamatkan
hanya Studio Agent, dan itu pun hanya untuk pekerjaan gambar.

**Sesudahnya.** Consumer membaca pesan, memuat konteks pekerjaan dalam **satu kueri**, menandai
`running`, menjalankan rantai penyedia, lalu menulis hasilnya dalam **satu batch**.

Tiga keputusan yang membentuknya:

1. **Setiap pekerjaan diakui sendiri-sendiri.** Satu batch sering memuat empat pekerjaan dari
   satu katalog. Satu yang melempar tidak boleh menjatuhkan tiga lainnya — pada demo, itu
   selisih antara satu katalog selesai dan tidak ada katalog sama sekali.
2. **Hanya `retry` yang menunda pengakuan.** Semuanya diakui, supaya antrian tidak berputar
   pada pekerjaan yang tidak akan pernah berhasil. Pekerjaan tanpa foto akan gagal dengan cara
   yang sama pada percobaan kelima.
3. **Kode katalog, bukan pesan penyedia.** Yang ditulis ke `jobs.error_code` hanyalah kode dari
   `lib/errors.ts`. `diagnostic` dari penyedia berhenti di log (AGENTS.md aturan 2).

### 2.2 Tujuh penyedia AI konkret

`providers.ts` mendefinisikan bentuknya sejak awal; yang tidak ada adalah isinya.
`grep "implements ImageProvider"` mengembalikan nol hasil.

| Rantai | Lapis | Penyedia |
|---|---|---|
| Gambar | 1 | **tidak ada di Worker** — Studio Agent, dijaga denyut |
| | 2 | Workers AI `flux-1-schnell` |
| | 3 | Cache — aset pra-produksi dari R2 |
| ASR | 1 | Groq `whisper-large-v3-turbo` |
| | 2 | Workers AI `whisper-large-v3-turbo` |
| Teks | 1 | 9router |
| | 2 | Workers AI `llama-3.3-70b-instruct-fp8-fast` |

**Yang sengaja tidak ada: `GeminiWebProvider`.** Jalur itu tidak dipanggil dari Worker melainkan
dari Studio Agent di laptop, lewat antrian dan `POST /agent/jobs/claim`. Worker tidak pernah
membuka Chrome. `buildChain` melewati penyedia yang tidak terdaftar alih-alih menggagalkan
rantai — jadi tanpa agen, rantai gambar dimulai dari Workers AI tanpa menunggu 45 detik, dan itu
memang perilaku yang diinginkan (TC-SA-02).

**Batas waktu lapis cadangan** ditetapkan masing-masing implementasi, bukan di `providers.ts` —
berkas itu sendiri menyatakan "lapis lain belum diukur, jadi angkanya ditetapkan masing-masing
implementasi, bukan dikarang di sini". Nilainya: gambar 30 detik, ASR 20 detik, teks 20 detik,
cache 5 detik.

### 2.3 Akses D1 untuk consumer

Tiga hal yang membentuk `d1-queue.ts`:

1. **Satu kueri per pekerjaan.** Batas D1 paket gratis 50 kueri per invocation, dan satu batch
   dapat memuat lima pekerjaan. Seluruh konteks — nama produk, kunci foto asli, kunci audio,
   transkrip, aset cache — diambil dalam satu `JOIN` dengan subkueri.
2. **Tulis hanya bila statusnya masih `running`.** Dua konsumen yang menerima pekerjaan sama
   tidak boleh sama-sama menganggap dirinya berhasil.
3. **`product_content` ditulis dengan `ON CONFLICT ... DO UPDATE`.** Percobaan ulang tidak boleh
   menghasilkan dua baris untuk satu bahasa.

### 2.4 Muatan pekerjaan terdefinisi

`payload.ts` mendefinisikan bentuk kolom `jobs.payload` sekali. Kalimat penegak F2-05 —
*"JANGAN mengubah bentuk, warna, tekstur, atau proporsi produk"* — tinggal di sini, satu kali.
`agent/worker.js` sudah menyatakan dirinya **tidak** menambahkan kalimat itu karena "yang
berlaku sesungguhnya adalah yang dikirim server"; sekarang server benar-benar mengirimnya.

---

## 3. Cacat yang diperbaiki

### 3.1 Tidak ada cara untuk masuk sama sekali

**Ini yang paling menghalangi demo.** `lib/session.ts` menyatakannya sendiri: *"Hanya menyimpan
token akses yang sudah diterbitkan layar masuk. Layar itu belum ada."* `e2e/support/flow.ts`
menyuntikkan token ke `localStorage["katavis.accessToken"]` justru karena tidak ada jalan lain.

Akibatnya: seluruh enam langkah gagal pada permintaan pertamanya dengan `UNAUTHENTICATED`, dan
pesannya *"Sesi Anda sudah berakhir. Silakan masuk lagi."* menunjuk ke pintu yang tidak ada.

**Sesudahnya.** `/masuk` — dua langkah, tanpa kata sandi, memakai endpoint yang sudah ada dan
sudah bekerja.

Diperiksa terhadap Worker yang berjalan:

```
POST /auth/otp/request   → 200  {"expiresAt":...,"resendAfter":...}
POST /auth/otp/verify    → 200  accessToken + refreshToken + user
POST /auth/otp/verify (kode salah) → 401 UNAUTHENTICATED, pesan ramah
GET  /products (token)   → 200  {"items":[],"nextCursor":null}
GET  /consent  (token)   → 200
GET  /products (tanpa)   → 401 UNAUTHENTICATED
```

Penyaringan nomor telepon ada di `app/masuk/phone.ts` dan diuji di 17 kasus: menerima
`0812...`, `62812...`, `+62 812-...`, `(0812) 3456.789`; menolak telepon rumah `021...`,
kode negara lain, dan nomor yang terlalu pendek atau panjang.

**Yang tidak ada di layar ini, dan itu disengaja:** tidak ada pemeriksaan izin, tidak ada animasi
selain umpan balik keadaan (MOTION bernilai 1), dan tidak ada pesan galat yang tidak berasal dari
`ERROR_CATALOG`.

### 3.2 Token penyegar tidak pernah tersimpan

`writeRefreshToken` tidak ada; `POST /auth/otp/verify` mengembalikan dua token dan klien hanya
menyimpan satu. Access token berumur 15 menit, jadi sesi demo mana pun berakhir di tengah alur
dan tidak ada cara memperpanjangnya tanpa masuk ulang lewat OTP — yang dibatasi tiga permintaan
per nomor per jam.

Diperbaiki di `lib/session.ts`, dengan kunci terpisah. `clearAccessToken` sekarang menghapus
keduanya: menyisakan refresh token setelah keluar berarti perangkat itu masih dapat memperoleh
akses baru, dan pada perangkat yang dipakai bergantian di SLB itu bukan detail.

### 3.3 Layar awal tidak menjaga sesi

`app/page.tsx` menawarkan tombol "Buat katalog baru" tanpa memeriksa apa pun. Pengrajin yang
belum masuk mengikuti satu-satunya tombol di layar, lalu gagal pada langkah pertama dengan pesan
yang menyuruhnya "masuk lagi" — sementara layar masuknya belum ada, dan sekarang ada tetapi tidak
pernah ditawarkan.

Sesudahnya, layar awal menawarkan tepat satu hal saat belum masuk: tombol "Masuk".

### 3.4 Pekerjaan tidak pernah sampai ke antrian

`POST /products/:id/generate` dan `POST /products/:id/audio` menulis baris `jobs` tetapi tidak
mengirim apa pun ke antrian. Consumer yang baru dibangun tidak akan pernah menerima pesan tanpa
ini.

Urutannya penting dan tidak dapat ditukar: **barisnya ditulis lebih dulu, pesannya dikirim
kemudian.** Konsumen yang menerima pesan sebelum barisnya ada akan mencari, tidak menemukan,
melewatinya, dan mengakui pesannya — pekerjaan itu lalu tidak pernah dikerjakan siapa pun.

Kegagalan mengirim tidak menggagalkan permintaan. Barisnya sudah ada, dan
`POST /products/:id/jobs/:jobId/retry` adalah jalan keluarnya.

### 3.5 `PUBLIC_BASE_URL` tidak ada di `Env`

Penyedia ASR mengambil berkas audionya sendiri lewat `fetch`, dan consumer antrian tidak punya
`Request` yang dapat dijadikan asal. Tanpa binding ini, penyedia menerima URL yang tidak
menunjuk apa pun dan gagal pada lapis pertama. Sekarang nilainya dibawa eksplisit; bila kosong,
gagalnya terlihat di log alih-alih diam.

### 3.6 Baris runbook yang menyuruh menekan sakelar mati

`DEMO-RUNBOOK.md` baris 157 masih berbunyi *"Nonaktifkan feature flag Gemini"*, sementara lima
tempat lain di repositori sudah mencatat bahwa bendera itu dihapus pada 21 September karena tidak
pernah dibaca satu baris pun kode.

Ini kelas kesalahan yang sudah diperingatkan dokumennya sendiri: *"Mitigasi yang diperpercaya
tetapi tidak terhubung ke apa pun lebih berbahaya daripada tidak ada mitigasi."* Baris itu
diganti dengan satu-satunya sakelar yang benar-benar ada (`DEMO_MODE`), ditambah penjelasan
mengapa jalur Gemini tidak punya sakelar — ia dijaga denyut agen.

### 3.7 Dua sisa bendera mati, di berkas yang luput dari penyapuan pertama

Penyapuan 21 September menghapus `GEMINI_ENABLED` dari kode, `wrangler.jsonc`, `.dev.vars`,
`DEMO-RUNBOOK`, `DEMO-VIDEO-GUIDE`, dan `RISK-REGISTER`. Pemeriksaan hari ini menemukan **dua
tempat yang terlewat**, dan keduanya berkas yang justru paling sering dibuka operator:

1. **`.env.example` baris 29–32.** Masih mendeklarasikan
   `# --- Feature flag --- GEMINI_ENABLED=false`, lengkap dengan komentar yang menyuruh
   mematikannya. Ini berkas yang disalin menjadi `.dev.vars` oleh setiap anggota tim yang baru
   menyiapkan mesin — jadi bendera mati itu akan **tumbuh kembali** pada setiap penyiapan baru.
2. **`RISK-REGISTER.md` R-04 baris 75.** R-02 sudah dikoreksi, tetapi R-04 tidak:
   *"Bila terpicu: matikan jalur Gemini lewat feature flag."* Dua risiko yang berbeda memuat
   mitigasi yang sama, dan hanya satu yang dibetulkan.

Keduanya diperbaiki. Blok di `.env.example` diganti dengan `PUBLIC_BASE_URL` — binding yang
**benar-benar dibaca** (`worker/jobs/providers-impl.ts`, lewat `worker/index.ts` baris 1736) dan
sebelumnya tidak terdokumentasi di berkas contoh mana pun. R-04 kini menyebut cara yang bekerja:
hentikan proses agennya.

**Pelajaran yang dicatat di sini secara sengaja:** menghapus bendera mati bukan pekerjaan satu kali
sapu. Yang membuatnya berbahaya adalah penyebutannya di dokumen operator, dan dokumen operator
adalah berkas yang paling jarang dibaca mesin — jadi paling mudah luput.

### 3.8 `NEXT_PUBLIC_API_BASE_URL` tidak terdokumentasi, dan menjebak di HP

Ditemukan saat menyusun panduan manual. `app/create/api.ts` baris 22:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
```

Awalan `NEXT_PUBLIC_` menyisipkan nilai itu **saat build**, bukan saat berjalan. Untuk pengembangan
laptop-saja bawaan itu benar. Untuk akses dari HP, ia menghasilkan kegagalan yang menyesatkan:
halaman terbuka sempurna, lalu berhenti — karena setiap panggilan API menunjuk ke `localhost` milik
ponsel itu sendiri.

Tidak ada yang salah dengan kodenya; yang kurang adalah dokumentasinya. Dijelaskan di
`PANDUAN-MANUAL.md` bagian 4.4, termasuk berkas `.env.local` yang diperlukan dan interaksinya
dengan `ALLOWED_ORIGINS` (TC-SEC-20 — asal yang tidak terdaftar tidak mendapat header CORS sama
sekali, jadi HP akan ditolak meski alamatnya sudah benar).

---

## 4. Dokumentasi operasional

Runbook juga ditambah dua bagian, karena alurnya kini benar-benar dimulai dari layar masuk:

- **H-0 langkah 5** — masuk sekali sebelum naik panggung dan pastikan sesinya masih hidup.
  Pengrajin yang sudah punya sesi tidak melihat layar masuk sama sekali.
- **"Kalau harus masuk di panggung"** — kode OTP hanya muncul di log Worker, dan itu satu-satunya
  cara karena penyedia SMS belum terpasang. Terminal harus diperbesar **sebelum** naik panggung.
  Ditambah peringatan bahwa setiap masuk memakai satu dari tiga permintaan per nomor per jam.

---

## 5. Panduan kerja manual

`docs/ops/PANDUAN-MANUAL.md` — dokumen baru, dan **satu-satunya yang ditujukan untuk manusia
sebagai pembaca utama**, bukan mesin.

Alasannya sederhana: sembilan dokumen di `docs/ops/` menjawab *apa yang terjadi* dan *apa
risikonya*, tetapi tidak ada satu pun yang menjawab *apa yang harus saya kerjakan, dengan urutan
apa, dan apa perintahnya*. Informasinya berserak di enam berkas.

Isinya: enam keputusan yang menunggu pemilik (K-1 sampai K-6), login Gemini langkah demi langkah
dengan peringatan ToS, login Wrangler sampai penyediaan jarak jauh, menjalankan proyek, mengakses
dari laptop dan dari HP lewat dua pilihan, masuk lewat OTP tanpa penyedia SMS, tabel sisa
pekerjaan beserta alasan tiap butir belum dikerjakan, dan urutan yang disarankan.

**Yang paling berguna darinya kemungkinan bagian 7.** Daftar itu membedakan dengan tegas mana yang
**dapat menggagalkan demo** dan mana yang hanya menambah kelengkapan. Hanya dua butir yang masuk
kategori pertama: kuota Workers AI dan penyediaan Cloudflare jarak jauh. Delapan sisanya sudah
punya jalur cadangan yang teruji.

---

## 6. Pengamatan lapangan — 23 September 2026

Bukan perubahan kode. Ini catatan dari membaca log Worker yang berjalan **33 jam 48 menit**, dan
temuannya cukup penting untuk tidak hilang bersama berkas log.

### 6.1 Agen menganggur memanggil 1.800 kali per jam

Log mencatat **310 `POST /agent/jobs/claim`**, **43 heartbeat**, **nol** penyelesaian pekerjaan,
dan **nol** katalog dibuat. Agen tidak mengerjakan apa pun selama 33 jam — tetapi terus memanggil.

Dua konstanta yang masing-masing benar sendiri: `IDLE_POLL_MS = 2_000` (`agent/index.js`) dan
`HEARTBEAT_INTERVAL_MS = 15_000` (`agent/heartbeat.js`). Digabungkan, agen menganggur menghasilkan
**2.040 Worker invocation dan ~3.840 kueri D1 per jam**.

Setiap claim menjalankan **dua** kueri D1 — `d1LatestHeartbeat` lalu `d1ClaimImageJobs` — **meski
antriannya kosong** (`worker/index.ts` baris 1430 dan 1438).

**Ini bukan risiko kehabisan kuota.** Batas D1 adalah 50 kueri per *invocation*, bukan per hari,
dan 2 kueri jauh di bawahnya. Yang nyata adalah **kebisingan log**: 16.320 baris `claim 200 OK`
dalam delapan jam mengubur baris yang penting, dan kode OTP dicetak di antaranya.

Tercatat sebagai **R-16** di `RISK-REGISTER.md`. Tidak diperbaiki sekarang karena menyentuh
perilaku yang sudah diuji dan tercantum sebagai kontrak (TC-SA-05, `API-CONTRACT.md` baris 358) —
perubahannya harus disengaja.

### 6.2 `workerd` yatim, diperagakan langsung

Yang selama ini tertulis sebagai peringatan di dokumen, kali ini terjadi dan diikuti sampai tuntas:

1. `workerd` PID 42592 menahan port 8787, induk `wrangler dev`-nya sudah mati.
2. Probe ke port itu mengembalikan **HTTP 000** — soket hidup, **tidak melayani apa pun**. Bentuk
   terburuk: menunggu tanpa galat yang menjelaskan sebabnya.
3. `taskkill /PID 42592 /T /F` berhasil — dan dalam hitungan detik **`workerd` baru (PID 34628)
   muncul di port yang sama**, ditumbuhkan induk `node.exe` PID 920.
4. Yang bekerja: **`taskkill /PID 920 /T /F`** — membunuh induknya, bukan `workerd`-nya.

Prosedur lengkapnya kini di `PANDUAN-MANUAL.md` bagian 4.5 dan 4.6, termasuk urutan mematikan yang
benar (agen lebih dulu, Worker terakhir) dan perintah verifikasi bahwa tidak ada yang tertinggal.

### 6.3 Bagian yang ditinggalkan utuh

Server Next.js di port 3000 (PID 43392) **sengaja tidak dimatikan** — ia sehat, melayani HTTP 200,
dan bukan yatim. Worker dan agen dimatikan karena keduanya memanggil satu sama lain dalam loop.

**Tangkapan layar tidak dibuat, jadi tidak ada berkas yang ditambahkan.** Pengamatan ini seluruhnya
dari log yang sudah ada.

### 6.4 Verifikasi alur masuk terhadap Worker yang sungguh berjalan

Dijalankan pada Worker terpisah di port **8799** (bukan 8787 milik sesi lain), dengan log
ditangkap, supaya tidak mengganggu apa pun yang sedang berjalan. Seluruhnya lulus.

| Langkah | Hasil |
|---|---|
| `POST /auth/otp/request` (`+6281299990002`) | 200 |
| Kode dibaca dari log (`[DEMO OTP] KODE OTP UNTUK ...: 532215`) | — |
| `POST /auth/otp/verify` dengan kode benar | 200, `accessToken` + `refreshToken` |
| Kode **salah** | 401 `UNAUTHENTICATED` |
| `GET /products`, `/consent`, `/caregivers` dengan token | 200 / 200 / 200 |
| Rute yang sama **tanpa** token | 401 |
| Rute `agent/*` **tanpa** kunci | 403 `FORBIDDEN` |
| Jalur tidak dikenal | 404 `NOT_FOUND` |
| `POST /auth/refresh` | 200, access token **berbeda** dari sebelumnya |
| Permintaan OTP ke-4 untuk nomor yang sama | 429 `RATE_LIMITED` |

**Pencabutan akses — pengujian keamanan terpenting, dan ia lulus:**

| Langkah | Hasil |
|---|---|
| Token sah sebelum pencabutan | 200 |
| `POST /auth/logout-all` | 200, `tokenVersion` naik 0 → 1 |
| Access token **yang sama** sesudahnya | **401** |
| Refresh token **yang sama** sesudahnya | **401** |

Pencabutan berlaku seketika, dan access maupun refresh token mati bersama-sama — persis yang
dituntut `AGENTS.md` aturan 4 dan TC-I-04/TC-SEC-16. Invarian `workSafe: true` juga terbukti:
setiap galat menyatakan pekerjaan pengguna tetap tersimpan.

`worker/auth/middleware.integration.test.ts` dijalankan terpisah terhadap D1 sungguhan: **4 lulus**,
termasuk kasus `token_version` yang sudah tidak cocok dan pengguna yang tidak ada di D1.

### 6.5 Satu hal yang bukan cacat, tetapi mudah disalahartikan

Memanggil `POST /auth/otp/request` dengan `"phone":"081234567890"` mengembalikan
**401 `UNAUTHENTICATED`** dengan pesan *"Sesi Anda sudah berakhir"* — padahal rutenya publik.

Itu benar, dan bukan cacat: `PhoneSchema` menuntut awalan `+62`, dan kode galat untuk badan
permintaan yang tidak sah memang `UNAUTHENTICATED` pada seluruh rute `auth/*` — pola yang konsisten
di 15 tempat (lihat `grep -n "!parsed.success" worker/index.ts`). `ERROR_CATALOG` tidak punya kode
untuk validasi, dan menambahkannya menuntut perubahan `API-CONTRACT.md` §12 lebih dulu — sesuatu
yang harus ditanyakan, bukan dikerjakan sendiri.

**Pengguna sungguhan tidak akan pernah menemui ini.** `app/masuk/phone.ts` menormalkan
`0812...`, `62812...`, `+62 812-...`, dan `(0812) 3456.789` menjadi `+62812...` sebelum dikirim.
Yang menemui hanya pemanggil langsung seperti `curl`.

---

## 7. Yang masih terbuka

Tidak berubah dari dokumen sebelumnya, tetapi kini dengan satu tambahan:

1. **Penyedia TTS Bahasa Indonesia (O4, ADR-005).** `audioUrl` masih `null`. Pekerjaan `tts`
   sekarang ditandai gagal dengan `INTERNAL_ERROR` dan alasannya tercatat di log — lebih jujur
   daripada mengarang suara yang belum diputuskan.
2. **`wrangler login` dan penyediaan jarak jauh.** D1, R2, Queues, rahasia produksi.
3. **Login sekali-jalan Gemini** di profil Chrome Studio Agent. Manusia, satu kali.
4. **`gitleaks`** belum pernah benar-benar dijalankan (Docker tidak ada di mesin ini).
5. **Kuota Workers AI belum diukur untuk model yang dipilih.** `flux-1-schnell` dipilih karena
   tersedia di katalog, bukan karena sudah diuji terhadap akun lomba. Periksa sisa kuota di H-1
   dan siapkan jalur cache.

Nomor 5 adalah satu-satunya yang baru, dan ia lahir dari pekerjaan sesi ini: sebelumnya tidak ada
yang memanggil Workers AI sama sekali, jadi tidak ada yang perlu diukur.
