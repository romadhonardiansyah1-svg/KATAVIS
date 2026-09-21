# Roadmap KATAVIS

**Versi** 1.0 · **Tanggal** 15 September 2026
**Rentang** 8 minggu, dengan cadangan pada minggu terakhir

---

## Metode kerja

**SDLC: Iteratif-inkremental dengan gerbang mingguan, bukan Waterfall dan bukan Scrum penuh.**

Alasannya berasal dari kondisi nyata, bukan preferensi metodologi:

| Kondisi | Konsekuensi metode |
|---|---|
| Satu pengembang utama | Ritual Scrum (daily, retro, planning poker) tidak punya peserta. Yang tersisa hanyalah biaya. |
| Tenggat mati dan tidak dapat digeser | Waterfall berisiko: kegagalan baru terlihat di fase pengujian, saat waktu habis. |
| Penilaian berupa demo langsung | Setiap minggu harus menghasilkan sesuatu yang dapat didemokan. |
| Banyak hal belum terukur | Butuh siklus pendek untuk mengubah rencana berdasar pengukuran. |

Yang diambil dari tiap pendekatan:
- **Dari iteratif:** siklus satu minggu, setiap siklus menghasilkan build yang jalan.
- **Dari spec-driven:** PRD dan arsitektur ditulis lebih dulu, karena keputusan teknis di sini
  saling mengunci dan mahal bila diubah belakangan.
- **Dari TDD:** logika `rbac` dan `jobs` ditulis dengan pengujian lebih dulu, karena keduanya jalur
  kritis yang galatnya sulit terlihat.
- **Dari risk-driven:** hal paling berisiko dikerjakan paling awal, bukan yang paling mudah.

Prinsip yang mengikat: **hal paling berisiko dikerjakan lebih dulu.** Rantai fallback penyedia AI
dibangun sebelum antarmuka dipercantik, karena kegagalan di sana membunuh demo sedangkan antarmuka
yang belum rapi tidak.

## Gerbang mingguan

Setiap minggu berakhir dengan jawaban atas tiga pertanyaan:

1. Apakah build masih dapat didemokan dari awal sampai akhir?
2. Apakah pengujian minggu ini lolos?
3. Apakah ada asumsi yang gugur oleh pengukuran minggu ini?

Bila pertanyaan pertama dijawab tidak, pekerjaan minggu berikutnya adalah memperbaikinya, bukan
menambah fitur.

---

## Minggu 1 — Fondasi dan pembuktian jalur tersulit

**Tujuan:** membuktikan bagian yang paling mungkin gagal, sebelum waktu habis untuk memperbaikinya.

- Inisialisasi repositori, Next.js 15, Worker, Wrangler, CI
- Migrasi D1 dan penyiapan R2
- Autentikasi OTP dan sesi
- **Uji tembak Groq Whisper dengan rekaman Bahasa Indonesia beraksen**
- **Uji tembak Workers AI `flux-2-klein-9b` untuk penggantian latar** — sekaligus mengukur
  neuron nyata per gambar (O5), yang menjadi dasar R-06
- **Uji tembak otomasi Gemini web: ukur waktu nyata dan kerapuhan selector** (O2)

Gerbang: ketiga uji tembak menghasilkan angka nyata yang tercatat. O2 dan O5 terjawab.

Tiga uji tembak ini menentukan apakah rencana dapat dijalankan. Bila Gemini nyatanya butuh lebih
dari 45 detik, ADR-004 ditinjau ulang minggu ini, bukan Minggu 7.

## Minggu 2 — Rantai penyedia dan pekerjaan asinkron

**Tujuan:** rantai fallback bekerja sebelum ada antarmuka yang memakainya.

- Antarmuka `ImageProvider`, `TranscriptionProvider`, `TextProvider`
- Cloudflare Queues dengan producer dan consumer
- Studio Agent: pull consumer, kendali Chrome lewat CDP, pemeriksaan kesehatan
- Siklus hidup pekerjaan: status, percobaan ulang, batas waktu
- Unit test `jobs` — TC-U-JOB-01 sampai TC-U-JOB-10

Gerbang: mematikan Studio Agent tidak menghentikan pipeline. Diuji, bukan diasumsikan.

## Minggu 3 — Voice-to-Story end to end

**Tujuan:** fitur utama pertama berjalan penuh.

- Perekaman audio di PWA
- Pipeline ASR dengan fallback
- **Layar tinjau transkrip** (ADR-008)
- Generate copywriting lewat 9router — sekaligus memilih model per tugas (O1)
- Penyimpanan per bahasa, ID dan EN
- Pengukuran akurasi ASR dengan lima jenis rekaman uji
- **Pengukuran biaya token 9router per katalog** (O6), dasar klaim biaya di ADR-007

Gerbang: rekaman 30 detik menghasilkan katalog teks yang dapat dibaca. Angka akurasi dan biaya
tercatat. O1 dan O6 terjawab.

## Minggu 4 — Studio Mockup dan aksesibilitas inti

**Tujuan:** fitur utama kedua, dan fondasi aksesibilitas yang menjadi nilai pembeda.

- Unggah foto lewat URL bertanda tangan
- Pipeline generate gambar dengan rantai tiga lapis
- Pustaka prompt latar studio
- Accessibility Mode dengan lima profil
- Token desain dari `docs/design/DESIGN-SYSTEM.md`
- **Uji dengar keluaran TTS Bahasa Indonesia** (O4) — Web Speech API dibandingkan layanan cloud
- **Uji TalkBack pada perangkat Android fisik** — TC-A11Y-21

Gerbang: axe-core 0 pelanggaran serius pada rute yang sudah ada. TalkBack diuji nyata. O4 terjawab.

TalkBack diuji di minggu ini, bukan menjelang final, karena ADR-002 mencatatnya sebagai kerugian
yang harus diverifikasi. Bila hasilnya buruk, masih ada empat minggu untuk bereaksi.

## Minggu 5 — Guided Navigation dan ketahanan

**Tujuan:** alur enam langkah utuh, dan sistem bertahan saat hal buruk terjadi.

- Alur enam langkah: Foto → Cerita → Transkrip → Proses → Periksa → Terbit
- Auto Save setiap 5 detik
- Error Assistance dengan pemetaan `error_code` ke pesan ramah
- Notifikasi multimodal: visual, audio, getar
- Service Worker dan antrian draf luring
- **Pengukuran volume D1 nyata per produk** (O3) — apakah 500 MB cukup
- E2E jalur utama — TC-E2E-01 sampai TC-E2E-03

Gerbang: alur penuh selesai tanpa mengetik satu karakter pun (TC-E2E-02), dan selesai hanya dengan
papan ketik (TC-E2E-03).

## Minggu 6 — Pendamping, Talking-Catalog, dan latihan demo pertama

**Tujuan:** fitur yang paling relevan dengan pengguna sasaran, dan latihan pertama di kondisi buruk.

- Undangan pendamping, RBAC, pencabutan seketika
- Activity log dengan `on_behalf_of`
- Talking-Catalog: avatar 2D, TTS, subtitle tersinkron
- Halaman katalog publik
- **Latihan demo pertama dengan WiFi dimatikan** — TC-DEMO-02
- **Latihan demo dengan Studio Agent dimatikan** — TC-DEMO-03

Gerbang: demo bertahan pada kedua kondisi kegagalan.

**Titik potong.** Bila gerbang minggu ini tidak tercapai, F4 (Global Listing & Export Hub)
diturunkan menjadi ekspor PDF saja tanpa feed marketplace. Keputusan ini ditetapkan sekarang agar
tidak dinegosiasikan saat panik.

## Minggu 7 — Export Hub, TWA, dan pengujian menyeluruh

**Tujuan:** melengkapi fitur dan menutup lapisan pengujian.

- Ekspor PDF dengan tag struktur
- Feed CSV format Google Merchant Center
- Bahasa Jepang, Mandarin, Arab on-demand
- Bubblewrap: APK bertanda tangan
- Seluruh pengujian keamanan — TC-SEC-01 sampai TC-SEC-20
- Lighthouse CI dan TC-PERF-04

Gerbang: APK terpasang di perangkat nyata, seluruh pengujian keamanan lolos.

## Minggu 8 — Pengerasan, materi presentasi, dan cadangan

**Tujuan:** tidak ada fitur baru. Hanya memperbaiki, melatih, dan menyiapkan.

- Perbaikan temuan dari seluruh pengujian
- Verifikasi setiap angka pada slide terhadap sumbernya
- Delivery Gate antislop pada seluruh antarmuka
- **Latihan demo harian dalam batas waktu** — TC-DEMO-04
- **Latihan pemulihan kegagalan di tengah demo** — TC-DEMO-05, minimal tiga kali
- Rekaman video cadangan alur penuh
- Runbook demo final

Gerbang: TC-DEMO-01 sampai TC-DEMO-04 lolos tiga kali berturut-turut.

Minggu ini sengaja tidak memuat fitur. Minggu tanpa cadangan adalah rencana yang mengasumsikan
tidak ada yang meleset, dan asumsi itu selalu salah.

---

## Urutan prioritas bila waktu habis

Ditetapkan sekarang, bukan saat panik. Dipotong dari bawah.

| Prioritas | Item | Potong bila |
|---|---|---|
| 1 | Alur enam langkah membuat katalog | Tidak pernah |
| 2 | Voice-to-Story | Tidak pernah |
| 3 | Studio Mockup | Tidak pernah |
| 4 | Accessibility Mode | Tidak pernah — ini nilai pembeda |
| 5 | Rantai fallback | Tidak pernah — ini penyelamat demo |
| 6 | Talking-Catalog | Turunkan jadi TTS + subtitle tanpa avatar |
| 7 | Pendamping + RBAC | Turunkan jadi tampilan saja tanpa penyuntingan |
| 8 | Ekspor PDF | Turunkan jadi tata letak sederhana |
| 9 | Feed marketplace | Potong penuh |
| 10 | Bahasa JA, ZH, AR | Potong, sisakan ID dan EN |
| 11 | Voice Navigation | Potong, sisakan tiga perintah |
| 12 | Tutorial interaktif | Potong penuh |
| 13 | APK TWA | Potong, sajikan PWA saja |

Empat teratas tidak pernah dipotong karena keempatnya adalah alasan produk ini ada. Memotongnya
berarti mendemokan produk yang berbeda dari yang diajukan.

## Ketergantungan antar pekerjaan

```
Minggu 1 (uji tembak)
    └─▶ Minggu 2 (rantai penyedia)
            ├─▶ Minggu 3 (Voice-to-Story)
            │       └─▶ Minggu 5 (alur enam langkah)
            └─▶ Minggu 4 (Studio Mockup)
                    └─▶ Minggu 5

Minggu 4 (token desain + a11y)
    └─▶ Minggu 5, 6, 7 (seluruh antarmuka)

Minggu 5 (alur utuh)
    └─▶ Minggu 6 (latihan demo)
            └─▶ Minggu 8 (pengerasan)
```

Jalur kritisnya: uji tembak → rantai penyedia → alur enam langkah → latihan demo. Keterlambatan di
mana pun pada rantai ini menggeser seluruh sisanya.

## Yang diukur setiap minggu

| Metrik | Sumber |
|---|---|
| Waktu total satu katalog, p50 dan p95 | Timestamp `jobs` |
| Tingkat keberhasilan tiap penyedia | `jobs.provider` dan `jobs.status` |
| Pelanggaran axe-core | CI |
| Kueri D1 per invocation, maksimum | TC-PERF-04 |
| Cakupan pengujian | CI |
| Pemakaian Neurons harian | Dasbor Cloudflare |

Angka-angka ini yang masuk presentasi. Angka yang tidak diukur tidak disebut.
