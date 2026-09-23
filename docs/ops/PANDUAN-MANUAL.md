# Panduan Kerja Manual — KATAVIS

**Tanggal:** 22 September 2026
**Untuk:** pemilik proyek (manusia)
**Sifat:** hanya memuat hal-hal yang **tidak dapat dikerjakan mesin**, ditambah urutan
menjalankan dan mengakses proyek dari laptop maupun HP.

Dokumen ini diurutkan sebagai daftar periksa. Bagian 1 sampai 3 adalah keputusan dan login
(keduanya butuh manusia). Bagian 4 sampai 6 adalah menjalankan dan mengakses. Bagian 7 adalah
daftar pekerjaan yang masih terbuka beserta alasannya.

---

## 1. Keputusan yang menunggu Anda

Enam keputusan. Tidak satu pun dapat dijawab mesin, karena masing-masing menuntut akun,
penilaian rasa, atau uang.

### K-1 · Penyedia TTS Bahasa Indonesia — **menghalangi F3 secara penuh**

| | |
|---|---|
| Rujukan | ADR-005 keputusan terbuka O4 |
| Akibat bila tidak diputuskan | `audioUrl` tetap `null`; katalog berbicara lewat teks berwaktu saja |

**Keadaan sekarang.** Naskah berwaktu (subtitle, jam, penyorotan kalimat) sudah bekerja penuh di
lima bahasa. Yang belum ada hanya suaranya. Pemutar sudah menjelaskan keadaannya sendiri kepada
pembeli: *"Suara tidak tersedia. Seluruh cerita tetap terbaca di bawah."*

**Yang perlu Anda lakukan.** Dengarkan keluaran nyata dari dua kandidat memakai **rekaman pengrajin
yang sesungguhnya**, bukan contoh pemasaran. Yang dinilai: pelafalan kata serapan, intonasi
kalimat tanya, dan ketahanan terhadap nama daerah.

**Kandidat.** TTS bawaan Workers AI (sudah terikat, tanpa langganan baru) versus penyedia
berbayar. Setelah diputuskan, yang berubah hanya satu baris — `audioUrl` di
`worker/catalog/narration.ts`. Naskah berwaktunya tidak perlu disentuh.

**Batas waktu.** Sebelum H-1 bila suara ingin masuk demo. Bila lewat, tidak apa-apa: fitur ini
sudah sah tanpa suara (F3-03 menuntutnya demikian).

---

### K-2 · Kuota Workers AI — **risiko R-06, terukur tapi belum diukur**

| | |
|---|---|
| Rujukan | RISK-REGISTER R-06 |
| Akibat bila tidak diputuskan | Latihan demo menghabiskan kuota sebelum tengah hari, demo di panggung jatuh ke cache |

**Keadaan sekarang.** Model yang dipakai (`flux-1-schnell`) dipilih karena **tersedia di katalog**,
bukan karena sudah diuji terhadap akun lomba. Sebelum sesi kemarin tidak ada satu pun kode yang
memanggil Workers AI, jadi tidak ada yang perlu diukur. Sekarang ada.

**Yang perlu Anda lakukan.**

1. Buka dasbor Cloudflare → Workers AI → catat sisa Neurons hari ini.
2. Jalankan **satu** generate gambar di `/create`, catat selisihnya.
3. Hitung: berapa generate yang tersedia sebelum kuota habis. Satu katalog butuh 1 gambar.
4. Bila angkanya di bawah ~15, aktifkan Workers Paid (~$5/bulan) **sekarang**, bukan saat latihan
   gagal.

**Catatan pengukuran.** Angka di `RISK-REGISTER` menyebut ~170 gambar/hari untuk
`flux-1-schnell`. Itu angka dokumentasi penyedia, bukan pengukuran pada akun Anda. Perlakukan
sebagai perkiraan sampai poin 2 di atas dikerjakan.

---

### K-3 · Slot presentasi 7 menit — **belum dikonfirmasi panitia**

| | |
|---|---|
| Rujukan | PRD pertanyaan terbuka Q2 |
| Akibat bila tidak diputuskan | Seluruh tabel waktu di `DEMO-RUNBOOK` salah skala |

**Yang perlu Anda lakukan.** Tanyakan ke panitia, lalu perbarui tabel "Alur demo — 7 menit" di
`docs/ops/DEMO-RUNBOOK.md`. Bila slot lebih pendek, yang dipotong lebih dulu adalah bagian
arsitektur dan angka (6:00–6:45), karena isinya dapat disampaikan saat tanya jawab.

---

### K-4 · Biaya teks 9router — **angka yang belum boleh disebut juri**

| | |
|---|---|
| Rujukan | ADR-007, ADR-005 O6 |
| Akibat bila tidak diputuskan | Jawaban "berapa biaya per katalog" harus dijawab sebagian |

**Keadaan sekarang.** Biaya gambar ($0,045) dan ASR ($0 dari kuota gratis) sudah terukur. Biaya
teks lewat 9router belum. `DEMO-RUNBOOK` sudah memuat aturan: **jangan menyebut total sebelum
lengkap.**

**Yang perlu Anda lakukan.** Periksa tarif 9router, hitung biaya satu generate copywriting, lalu
perbarui baris "Berapa biaya per katalog?" di `docs/ops/DEMO-RUNBOOK.md`. Bila menyebut rupiah,
sertakan kurs dan tanggalnya.

---

### K-5 · Penggunaan `flux-2-klein-9b` untuk hasil final

| | |
|---|---|
| Rujukan | RISK-REGISTER R-06 mitigasi 3 |

**Yang perlu Anda putuskan.** Apakah kualitas `flux-1-schnell` cukup untuk ditunjukkan ke juri,
atau hasil final memakai `flux-2-klein-9b` (~7 gambar/hari dari kuota gratis). Bila memilih yang
kedua, empat sampai lima gambar demo harus diproduksi **lebih dulu** dan masuk cache, karena
kuotanya tidak cukup untuk latihan berulang.

---

### K-6 · Repositori jarak jauh (remote)

| | |
|---|---|
| Rujukan | STATUS-DEMO-2026-09-21 bagian 4 poin 5 |

**Keadaan sekarang.** Tiga commit sudah ada di mesin ini. **Belum ada remote.** Satu cakram rusak
dan seluruh riwayat hilang bersama mesinnya.

**Yang perlu Anda lakukan.**

```bash
gh repo create katavis --private --source=. --remote=origin --push
```

Bila lebih suka tanpa `gh`, buat repositori kosong di GitHub lalu:

```bash
git remote add origin https://github.com/<akun>/katavis.git
git push -u origin HEAD
```

**Sebelum push, jalankan pemeriksaan rahasia** (K-6 dijalankan setelah login Wrangler, lihat
bagian 3):

```bash
git diff --cached | grep -nE "sk-|gsk_|AKIA|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY" || echo "BERSIH"
```

---

## 2. Login Gemini web — **satu kali, manual, di profil Chrome khusus**

| | |
|---|---|
| Rujukan | ADR-004, RISK-REGISTER R-04 |
| Berkas | `agent/.env`, `agent/chrome-profile/` |

### Peringatan yang tidak dapat dilewati

> Otomasi Gemini web **melanggar Google Terms of Service** bagian *"Don't abuse our services"*
> (*"bypassing our systems or protective measures"*). Sanksinya dapat mencakup **penghapusan
> SELURUH akun Google** — termasuk Gmail, Drive, dan Photos pada akun yang sama.
>
> **Gunakan akun Google TERPISAH yang tidak memuat data penting.**
> Jangan pernah memakai akun utama Anda atau anggota tim mana pun.

### Kenapa Chrome asli, bukan Chromium

Chromium bawaan Playwright **diblokir Google** dengan pesan *"This browser or app may not be
secure"*. Karena itu `CHROME_PATH` harus menunjuk ke `chrome.exe` yang sesungguhnya. Ini sudah
terpasang di `agent/.env`.

### Langkah-langkah

**2.1 · Periksa prasyarat**

```bash
cd "C:\Projet dian\KATAVIS"
ls agent/.env                          # harus ada
ls "C:\Program Files\Google\Chrome\Application\chrome.exe"   # harus ada
```

**2.2 · Pastikan `agent/.env` sudah terisi**

```bash
cat agent/.env
```

Yang wajib benar: `AGENT_SHARED_KEY` **sama persis** dengan yang ada di `.dev.vars`, dan
`WORKER_URL` menunjuk ke Worker yang hidup (`http://127.0.0.1:8787` saat lokal).

**2.3 · Nyalakan Worker lebih dulu**

Agen akan memanggil Worker. Worker harus hidup.

```bash
pnpm run dev:worker
```

**Perhatikan port yang benar-benar didengarkan di log.** Worker dapat pindah ke `:8788` bila
`workerd` yatim dari sesi sebelumnya masih menahan `:8787`. Bila itu terjadi, ubah `WORKER_URL` di
`agent/.env` agar cocok.

**2.4 · Buka Chrome sekali dengan profil agen**

```bash
pnpm run dev:agent
```

Pada percobaan pertama, agen membuka jendela Chrome dengan profil di `agent/chrome-profile/`.
Jendela ini **polos** — belum ada sesi Google di dalamnya.

**2.5 · Masuk manual ke Google**

Di jendela Chrome yang barusan terbuka:

1. Buka `https://accounts.google.com`
2. Masuk dengan **akun Google terpisah** (lihat peringatan di atas).
3. Bila Google meminta verifikasi tambahan, selesaikan — ini login manusia, bukan otomasi.
4. Buka `https://gemini.google.com/app`, pastikan halaman Gemini benar-benar terbuka dan dapat
   dipakai. Kirim satu pertanyaan percobaan bila perlu.
5. **Tutup jendela Chrome itu** dengan tombol tutup, bukan dengan `Ctrl+C` di terminal.

**2.6 · Jalankan agen lagi**

```bash
pnpm run dev:agent
```

Sekarang profilnya sudah memuat sesi. Agen membaca sesi itu dan mulai melaporkan denyut ke Worker.

**2.7 · Verifikasi bahwa sesi benar-benar terbaca**

Pemeriksaan kesehatan Worker **tidak menuntut autentikasi**, jadi tidak perlu rahasia:

```bash
curl -s http://127.0.0.1:8787/api/v1/health
```

**Hasil yang diharapkan:** `{"status":"ready"}`.

Sesudah itu, pastikan agen benar-benar melaporkan denyut — Worker menerimanya di
`POST /api/v1/agent/heartbeat` dan menyimpannya di `agent_heartbeats`. Bila agen tidak sehat, ia
mendaftarkan dirinya tidak sehat dan pekerjaan gambar langsung menuju Workers AI tanpa menunggu 45
detik — perilaku yang benar (TC-SA-02), tetapi jalur utamanya tidak terpakai.

Cara termudah memastikan agen hidup: nyalakan Worker **dan** agen, jalankan satu generate gambar,
lalu lihat terminal agen. Bila agen mengambil pekerjaannya, barisnya akan muncul di sana.

### Jangan lakukan

- Jangan pakai akun Google utama, dalam keadaan apa pun.
- Jangan tambahkan otomasi login. Sepuluh tempat di kode menyatakan login adalah tindakan manusia
  satu kali.
- Jangan jalankan agen terus-menerus. RAM bebas hanya 1,7 GB (RISK-REGISTER R-10).

---

## 3. Login Wrangler (Cloudflare) + penyediaan jarak jauh

| | |
|---|---|
| Rujukan | STATUS-DEMO-2026-09-22 bagian 5 poin 2 |
| Berkas | `wrangler.jsonc` (memuat placeholder) |

### Keadaan sekarang

`wrangler.jsonc` baris 16 masih memuat:

```jsonc
"database_id": "PLACEHOLDER_ISI_SETELAH_wrangler_d1_create",
```

Selama placeholder itu ada, `wrangler deploy` **akan gagal**. Ini pekerjaan satu kali.

### Langkah-langkah

**3.1 · Login**

```bash
npx wrangler login
```

Peramban terbuka. Setujui akses. Verifikasi:

```bash
npx wrangler whoami
```

Harus menampilkan email dan ID akun Cloudflare Anda.

**3.2 · Buat basis data D1**

```bash
npx wrangler d1 create katavis
```

Keluaran perintah ini memuat blok `[[d1_databases]]` dengan `database_id` yang sesungguhnya.
**Salin nilai itu** ke `wrangler.jsonc` baris 16, menggantikan placeholder.

**3.3 · Buat bucket R2**

```bash
npx wrangler r2 bucket create katavis-media
```

**3.4 · Buat antrian dan antrian surat mati**

```bash
npx wrangler queues create katavis-jobs
npx wrangler queues create katavis-jobs-dlq
```

`wrangler.jsonc` sudah mendeklarasikan keduanya. Langkah ini membuat wadahnya di Cloudflare.

**3.5 · Jalankan migrasi jarak jauh**

```bash
pnpm run db:migrate:remote
```

**3.6 · Pasang rahasia produksi**

Satu per satu. Setiap perintah akan meminta nilainya secara interaktif — **jangan** menempelkan
nilai di baris perintah, karena akan tersimpan di riwayat shell.

```bash
npx wrangler secret put GROQ_API_KEY        # https://console.groq.com/keys
npx wrangler secret put NINEROUTER_API_KEY
npx wrangler secret put NINEROUTER_BASE_URL
npx wrangler secret put JWT_SIGNING_KEY     # pakai nilai .dev.vars yang sudah ada
npx wrangler secret put AGENT_SHARED_KEY    # HARUS sama dengan agent/.env
npx wrangler secret put OTP_PROVIDER_KEY    # boleh dilewati bila belum ada penyedia SMS
```

> **`JWT_SIGNING_KEY` produksi harus berbeda dari lokal.** Bila sama dan kunci lokal bocor, sesi
> produksi dapat dipalsukan. Hasilkan yang baru:
> ```bash
> node -e "console.log(crypto.randomBytes(32).toString('base64'))"
> ```

**3.7 · Terapkan**

```bash
pnpm run deploy:worker
```

**3.8 · Isi `PUBLIC_BASE_URL` produksi**

Setelah deploy, Wrangler mencetak URL publik (`https://katavis.<subdomain>.workers.dev`). Tambahkan
ke `wrangler.jsonc` bagian `vars`, **tanpa garis miring di akhir**:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "DEMO_MODE": "false",
  "PUBLIC_BASE_URL": "https://katavis.<subdomain>.workers.dev",
  "GEMINI_TIMEOUT_MS": "45000",
  "AGENT_HEARTBEAT_TIMEOUT_MS": "30000"
}
```

Lalu terapkan ulang. Binding ini dipakai penyedia ASR di dalam konsumer antrian, yang tidak punya
`Request` untuk menurunkan origin darinya.

**3.9 · Verifikasi**

```bash
curl -s https://katavis.<subdomain>.workers.dev/api/v1/health
```

**Hasil yang diharapkan:** `{"status":"ready"}`.

---

## 4. Menjalankan proyek

### 4.1 · Laptop — pertama kali

```bash
cd "C:\Projet dian\KATAVIS"

pnpm install                                        # sekali saja
cp .env.example .dev.vars                           # lalu isi nilainya
pnpm run db:migrate:local                           # siapkan D1 lokal
pnpm run verify                                     # gerbang: harus keluar 0
```

**Perintah yang paling sering dipakai:**

| Perintah | Kegunaan |
|---|---|
| `pnpm run verify` | typecheck + lint + 664 uji unit + kontras + rujukan |
| `pnpm run dev` | Next.js di `:3000` |
| `pnpm run dev:worker` | Worker di `:8787` |
| `pnpm run dev:agent` | Studio Agent (Chrome) |
| `pnpm run test:integration` | workerd asli dengan D1 dan R2 |
| `pnpm run test:e2e` | Playwright, empat proyek peramban |

**Jalankan sebelum menyatakan pekerjaan selesai.** Bukan setelah ditanya.

### 4.2 · Laptop — urutan menyalakan

Tiga proses, **tiga terminal terpisah**. Urutannya tidak dapat ditukar: Worker harus hidup sebelum
agen, karena agen memanggil Worker.

```
Terminal 1   pnpm run dev:worker      →  tunggu "Ready on http://localhost:8787"
Terminal 2   pnpm run dev             →  tunggu "Ready on http://localhost:3000"
Terminal 3   pnpm run dev:agent       →  hanya bila butuh jalur Gemini
                                        (opsional; jalur Workers AI tetap bekerja)
```

**Perhatikan port di log, jangan menganggap `:8787`.** Lihat bagian 4.5.

### 4.3 · Membuka dari laptop

| Alamat | Isi |
|---|---|
| `http://localhost:3000` | Antarmuka utama |
| `http://localhost:3000/masuk` | Layar masuk OTP |
| `http://localhost:3000/create` | Alur enam langkah |
| `http://localhost:8787/api/v1/health` | Pemeriksaan kesehatan Worker |

### 4.4 · Membuka dari HP — **dua pilihan**

#### Pilihan A · Satu jaringan Wi-Fi (paling cepat, tanpa akun)

HP dan laptop harus tersambung ke Wi-Fi yang **sama**.

##### Jebakan yang harus diatasi lebih dulu: alamat API tertanam saat build

`app/create/api.ts` baris 22 membaca alamat Worker dari `NEXT_PUBLIC_API_BASE_URL` dengan
bawaan `http://localhost:8787`:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
```

Awalan `NEXT_PUBLIC_` berarti nilai itu **disisipkan ke bundel pada saat build**, bukan dibaca
saat berjalan. Akibatnya, membuka `http://10.173.2.171:3000` dari HP akan memuat antarmukanya
dengan benar, tetapi **setiap panggilan API menunjuk ke `localhost` milik HP itu sendiri** dan
gagal. Gejalanya: halaman terbuka, lalu berhenti pada layar masuk atau menampilkan
`NETWORK_OFFLINE`.

Ini bukan cacat — untuk pengembangan laptop-saja, bawaan itu memang yang diinginkan. Tetapi
**untuk akses dari HP, alamatnya harus diisi sebelum build.**

**Langkah 1 — cari alamat IP laptop.**

```bash
ipconfig | grep -A2 "IPv4"
```

Dari mesin ini, hasilnya: **`10.173.2.171`** (adaptor Wi-Fi). Abaikan `169.254.x.x` — itu alamat
tautan-lokal, tandanya adaptor tidak mendapat alamat sah.

**Langkah 2 — tentukan alamat Worker yang akan dipakai HP.**

| Cara menjalankan Worker | Nilai `NEXT_PUBLIC_API_BASE_URL` |
|---|---|
| `wrangler dev` lokal di laptop | `http://10.173.2.171:8787` |
| Worker sudah diterapkan ke Cloudflare | `https://katavis.<subdomain>.workers.dev` |

**Langkah 3 — buat berkas `.env.local`** di akar proyek (diabaikan git):

```
NEXT_PUBLIC_API_BASE_URL=http://10.173.2.171:8787
ALLOWED_ORIGINS=http://localhost:3000,http://10.173.2.171:3000
```

Baris kedua masuk ke `.dev.vars`, **bukan** `.env.local` — Worker yang membacanya. Tanpa itu,
`corsHeaders()` mengembalikan objek kosong untuk asal yang tidak terdaftar (TC-SEC-20), dan
peramban menolak setiap permintaan lintas asal.

**Langkah 4 — nyalakan ketiganya dengan alamat yang dapat dijangkau dari luar.**

Next.js secara bawaan hanya mendengarkan `localhost`. Tanpa `-H`, HP akan mendapat "tidak dapat
dijangkau" meskipun Wi-Fi-nya sama.

```
Terminal 1   pnpm run dev:worker --ip 0.0.0.0
Terminal 2   pnpm exec next dev -H 0.0.0.0 -p 3000
```

**Langkah 5 — buka dari HP.**

```
http://10.173.2.171:3000
```

**Langkah 6 — bila HP tetap tidak dapat menjangkau.**

Windows Defender Firewall memblokir port masuk. Izinkan **sekali** (butuh hak administrator):

```powershell
New-NetFirewallRule -DisplayName "KATAVIS dev 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "KATAVIS dev 8787" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow
```

**Bila IP laptop berubah** (Wi-Fi baru, hotspot), ulangi Langkah 1 sampai 3 lalu nyalakan ulang
`pnpm run dev`. Alamat `10.173.2.171` hanya berlaku untuk jaringan yang sedang dipakai sekarang.

**Bila hanya ingin cepat melihat antarmuka tanpa API** — misalnya memeriksa tata letak di layar
ponsel — Langkah 3 tidak diperlukan. Halaman akan tampil, hanya data-datanya yang kosong.

#### Pilihan B · Cloudflare Tunnel (lebih andal, butuh login Wrangler)

Dipakai bila Wi-Fi kampus atau venue mengisolasi antar-perangkat (*client isolation*), yang membuat
Pilihan A mustahil. Sekaligus cara terbaik menguji jalur HTTPS dari HP, karena TWA Android menuntut
HTTPS.

```bash
npx wrangler tunnel quick-start http://localhost:3000
```

Wrangler mencetak satu URL `https://<acak>.trycloudflare.com`. Buka URL itu dari HP di jaringan
mana pun. Tidak perlu mengubah `ALLOWED_ORIGINS` bila Worker juga di-tunnel-kan, dan tidak perlu
membuka port.

**Catatan.** Pilihan ini menuntut login Wrangler (bagian 3.1). Jalankan dulu langkah itu bila
belum.

### 4.5 · Jebakan yang sudah memakan korban

**`workerd` yatim menahan port.** `pnpm run dev:worker` menumbuhkan rantai proses panjang.
**Membunuh `workerd` saja membuat induknya menumbuhkannya kembali** dengan PID baru pada port yang
sama. Yang benar:

```bash
netstat -ano | grep ":8787"
taskkill /PID <induk> /T /F
```

**Ini bukan teori — sudah diperagakan pada 23 September 2026.** Urutan kejadiannya:

1. `workerd` PID 42592 menahan port 8787, tetapi induk `wrangler dev`-nya sudah mati.
2. Probe ke port itu mengembalikan **HTTP 000** — soketnya hidup, tetapi **tidak melayani apa pun**.
   Ini bentuk terburuknya: agen dan peramban menunggu selamanya tanpa galat yang menjelaskan.
3. `taskkill /PID 42592 /T /F` dijalankan. Berhasil — tetapi dalam hitungan detik **`workerd` baru
   (PID 34628) muncul di port yang sama**, ditumbuhkan induk `node.exe` PID 920.
4. Yang akhirnya bekerja: **`taskkill /PID 920 /T /F`** — membunuh **induknya**, bukan `workerd`-nya.

**Selalu periksa port di log**, jangan menganggap `:8787`. Worker yang pindah ke `:8788` membuat
probe ke `:8787` gagal tanpa penjelasan.

**`.dev.vars` tidak ikut ter-reload** pada sebagian perubahan. Nyalakan ulang Worker setelah
mengubahnya.

### 4.6 · Urutan mematikan yang benar

Agen **harus dimatikan lebih dulu**, lalu Worker. Bila dibalik, agen terus mencoba menghubungi
Worker yang sudah mati — dan pada jeda 2 detik, itu satu baris kegagalan setiap dua detik.

```
1. Ctrl+C  di terminal agen      (pnpm run dev:agent)
2. Ctrl+C  di terminal Next.js   (pnpm run dev)
3. Ctrl+C  di terminal Worker    (pnpm run dev:worker)
4. Verifikasi tidak ada yang tertinggal
```

Langkah 4 bukan formalitas. Kedua perintah ini harus mengembalikan **kosong**:

```bash
netstat -ano | grep -E ":(3000|8787|8788|9222).*LISTENING"
tasklist | grep -i workerd
```

Bila ada yang masih muncul, bunuh **induknya** (`taskkill /PID <induk> /T /F`), bukan proses
daunnya.

**Jangan tinggalkan Worker dan agen menyala semalaman.** Lihat R-16 di `RISK-REGISTER.md`:
agen menganggur menghasilkan ~2.040 Worker invocation dan ~3.840 kueri D1 per jam tanpa melakukan
pekerjaan apa pun.

---

## 5. Masuk ke aplikasi tanpa penyedia SMS

Penyedia SMS **belum terpasang**. Karena itu kode OTP dicetak ke log Worker — dan itu satu-satunya
cara masuk.

**5.1 · Pastikan `DEMO_MODE=true` di `.dev.vars`**, lalu nyalakan ulang Worker.

**5.2 · Minta kode.** Masuk ke `http://localhost:3000/masuk`, masukkan nomor, tekan **Kirim kode**.

Nomor yang diterima: `0812...`, `62812...`, `+62 812-...`, `(0812) 3456.789`.
Nomor yang **ditolak**: telepon rumah `021...` (tidak dapat menerima SMS), kode negara lain, dan
nomor yang terlalu pendek atau panjang.

**5.3 · Baca kode dari log Worker.**

```
[demo] Kode OTP untuk +6281234567890: 123456
```

**5.4 · Masukkan kodenya.**

### Batas yang perlu diketahui

- **3 permintaan per nomor per jam.** Batas ini terasa tepat saat demo berlangsung. Permintaan
  keempat mengembalikan `429 RATE_LIMITED`.
- **Access token berumur 15 menit.** Token penyegar kini tersimpan, jadi sesi dapat diperpanjang
  tanpa masuk ulang — tetapi bila keduanya habis, kembali ke langkah 5.2.
- **Masuk lebih baik dilakukan sebelum naik panggung.** Terminal berisi kode OTP harus diperbesar
  **sebelum** dibutuhkan, bukan saat mencarinya.

### Bila menguji dengan `curl`, jangan lupa `+62`

`POST /auth/otp/request` menuntut nomor dalam bentuk `+62...`. Mengirim `081234567890` menghasilkan
**401 `UNAUTHENTICATED`** dengan pesan *"Sesi Anda sudah berakhir"* — menyesatkan, tetapi benar:
kode galat untuk badan permintaan yang tidak sah memang itu pada seluruh rute `auth/*`.

```bash
# benar
curl -X POST http://127.0.0.1:8787/api/v1/auth/otp/request \
  -H "Content-Type: application/json" -d '{"phone":"+6281234567890"}'
```

**Pengguna sungguhan tidak akan menemui ini** — layar `/masuk` menormalkan `0812...`, `62812...`,
`+62 812-...`, dan `(0812) 3456.789` menjadi `+62...` sebelum mengirim. Yang menemui hanya
pemanggil langsung.

### Pencabutan akses berlaku seketika

Bila perlu menguji ulang: `POST /auth/logout-all` menaikkan `token_version`, dan **access maupun
refresh token yang beredar langsung mati**. Ini pengujian keamanan terpenting di sistem
(TC-I-04, TC-SEC-16) dan sudah diverifikasi terhadap Worker yang berjalan.

---

## 6. Ringkasan perangkat

| Perangkat | Cara | Alamat |
|---|---|---|
| Laptop | langsung | `http://localhost:3000` |
| Laptop | API Worker | `http://localhost:8787/api/v1/probes` |
| HP, Wi-Fi sama | Pilihan A | `http://10.173.2.171:3000` |
| HP, jaringan apa pun | Pilihan B | URL `trycloudflare.com` dari `wrangler tunnel` |
| HP, produksi | setelah deploy | `https://katavis.<subdomain>.workers.dev` |

**Untuk mendemokan alur dari HP**, Pilihan B lebih baik: HTTPS membuat Service Worker dan fitur
PWA bekerja, dan itu yang membuat "buka dari ponsel juri lewat QR" pada runbook dapat diperagakan
sebagaimana yang akan dilihat juri.

---

## 7. Sisa pekerjaan yang belum selesai — beserta alasannya

| # | Hal | Menghalangi demo? | Alasan belum dikerjakan |
|---|---|---|---|
| 1 | Penyedia TTS (K-1) | Tidak | Keputusan rasa, butuh pendengaran manusia |
| 2 | Kuota Workers AI (K-2) | **Berpotensi ya** | Butuh akses dasbor Cloudflare |
| 3 | `wrangler login` + penyediaan jarak jauh (bagian 3) | Ya, untuk jalur produksi | Butuh akun Cloudflare |
| 4 | Login Gemini sekali (bagian 2) | Tidak — Workers AI menutupinya | Butuh akun Google terpisah |
| 5 | `gitleaks` | Tidak | Docker tidak ada di mesin ini (kendala keras `AGENTS.md`) |
| 6 | Remote repositori (K-6) | Tidak | Butuh akun GitHub |
| 7 | Slot presentasi (K-3) | Tidak | Menunggu panitia |
| 8 | Biaya teks 9router (K-4) | Tidak | Menunggu tarif |
| 9 | `TC-E2E-26` untuk peristiwa "Katalog selesai" | Tidak | Peristiwa terimplementasi, belum diuji end-to-end |
| 10 | `Android Studio` / APK | Tidak | Dinyatakan terlarang oleh `AGENTS.md`; memakai TWA dari PWA |
| 11 | Jeda polling agen saat menganggur (R-16) | Tidak | Menyentuh kontrak 2 detik (`API-CONTRACT.md` baris 358); butuh keputusan, bukan perbaikan diam-diam |

**Nomor 2 dan 3 adalah satu-satunya yang benar-benar dapat menggagalkan demo.** Sisanya sudah
mempunyai jalur cadangan yang teruji. Nomor 11 adalah temuan baru dari pengamatan sesi 21–23
September dan tercatat sebagai R-16; ia menambah beban kuota dan kebisingan log, tetapi tidak
menggagalkan demo.

---

## 8. Urutan yang disarankan

1. **Login Wrangler** (bagian 3.1) — membuka nomor 3 dan jalan menuju nomor 2.
2. **Sediakan sumber daya jarak jauh** (bagian 3.2–3.5).
3. **Ukur kuota Workers AI** (K-2) — sekarang aksesnya sudah ada.
4. **Jalankan proyek di laptop dan HP** (bagian 4) — pastikan keduanya melihat aplikasi yang sama.
5. **Login Gemini sekali** (bagian 2) — hanya bila jalur Gemini ingin masuk demo.
6. **Masuk lewat OTP dan jalankan alur penuh tiga kali** (`DEMO-RUNBOOK`, bagian "Latihan terakhir").
7. **Putuskan TTS** (K-1) dan **biaya teks** (K-4) — keduanya hanya menambah kelengkapan jawaban.
8. **Push ke remote** (K-6) — sebelum menyentuh apa pun yang berisiko.

---

## 9. Berkas yang berkaitan

| Berkas | Isi |
|---|---|
| `docs/ops/DEMO-RUNBOOK.md` | Perintah hari-H, urutan panggung, prosedur saat gagal |
| `docs/ops/STATUS-DEMO-2026-09-22.md` | Sepuluh perubahan sesi terakhir |
| `docs/ops/RISK-REGISTER.md` | Sepuluh risiko aktif beserta mitigasinya |
| `docs/ops/MODEL-ROUTING.md` | Rantai penyedia dan alasan urutannya |
| `docs/adr/` | ALASAN di balik setiap teknologi — dibaca sebelum menyanggah keputusan |
| `agent/.env.example` | Konfigurasi Studio Agent, dengan peringatan ToS |
| `.env.example` | Nama variabel Worker, tanpa nilainya |
