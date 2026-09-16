# PRD â€” KATAVIS

**Versi** 1.0 Â· **Tanggal** 15 September 2026 Â· **Status** Disetujui untuk build
**Tim** Digiboom â€” Ferdian Tri Rahmansyah (ketua), Romadhon Ardiansyah, Irsyad Prasista Ramadhani
**Konteks** APTIKOM Hackathon (APHACKATON) 2026 â€” lolos final

---

## 1. Ringkasan

KATAVIS mengubah foto produk mentah dan rekaman suara 30 detik menjadi katalog digital siap jual.
Target penggunanya pengrajin difabel dan pendamping SLB yang tidak bisa memotret produk secara
profesional, tidak terbiasa menulis copywriting, dan terhalang bahasa untuk menjangkau pasar ekspor.

Dokumen ini adalah turunan dari dua sumber: `PROPOSAL DIGIBOOM_KATAVIS_APHACKATON 2026.pdf`
(14 halaman) dan `Fitur pendukung.pdf` (9 halaman). Di beberapa titik dokumen ini **mengoreksi**
proposal karena klaim di sana tidak dapat dipenuhi oleh perangkat yang tersedia. Setiap koreksi
ditandai dan diberi alasan.

## 2. Masalah

Dari proposal, bagian 1.1 â€” tiga hambatan struktural pengrajin difabel:

1. **Keterbatasan aset visual.** Tidak ada kamera profesional atau studio mini. Foto yang diunggah
   gelap, berlatar seadanya.
2. **Hambatan artikulasi copywriting.** Menulis deskripsi persuasif menuntut literasi pemasaran
   digital, sementara nilai jual produk kriya justru ada pada kisah personal pembuatnya.
3. **Barrier bahasa pasar ekspor.** Pasar luar negeri membayar premi untuk kriya bernilai sosial,
   tetapi pengrajin tidak bisa menyusun materi promosi multibahasa.

Ditambah dari `Fitur pendukung.pdf` â€” hambatan yang lebih mendasar: sebagian pengguna tunanetra,
tunarungu, memiliki keterbatasan motorik, atau kognitif. Platform katalog biasa tidak dapat mereka
operasikan sama sekali.

### Data yang dipakai dan batasnya

Proposal menyebut "lebih dari 22,9 juta jiwa" penyandang disabilitas dan "TPAK di bawah 45%",
bersumber dari BPS dan Kemnaker.

**Peringatan untuk presentasi:** angka ini dikutip dari proposal, bukan diverifikasi ulang oleh tim
teknis. Sebelum tampil di slide final, tautan sumber primer BPS wajib dibuka dan angkanya dicocokkan.
Aturan antislop R-17 melarang menampilkan angka tanpa rujukan yang bisa ditunjuk. Kalau angka tidak
bisa diverifikasi, ia dihapus dari slide â€” bukan dibiarkan.

## 3. Pengguna

| Aktor | Siapa | Kebutuhan inti | Hambatan |
|---|---|---|---|
| **Pengrajin** | Penyandang disabilitas fisik/daksa, rungu-wicara, atau intelektual ringan. Lulusan SLB atau binaan yayasan. | Menjual karyanya tanpa bergantung orang lain | Tidak bisa memotret profesional, tidak bisa menulis promosi, sebagian tidak bisa membaca layar |
| **Pendamping** | Guru SLB, keluarga, relawan yayasan | Membantu tanpa mengambil alih akun | Butuh akses terbatas yang bisa dicabut kapan saja |
| **Pembeli** | Konsumen dalam & luar negeri | Memahami nilai produk sebelum membeli | Tidak mengenal pengrajin, tidak tahu cerita di balik produk |
| **Admin/Kurator** | Pengelola platform atau mitra aggregator | Menjaga mutu katalog yang terbit | Tidak bisa memeriksa satu per satu secara manual |

### Yang secara sadar TIDAK kami rancang untuk

- Pengrajin tanpa smartphone sama sekali.
- Pengguna tunanetra total tanpa pendamping pada tahap onboarding pertama. Alur pendaftaran awal
  masih mengasumsikan ada bantuan sekali di awal. Ini keterbatasan jujur, bukan fitur.
- Transaksi pembayaran. Lihat bagian 7.

## 4. Tujuan dan ukuran keberhasilan

### Tujuan produk

| # | Tujuan | Ukuran | Cara mengukur |
|---|---|---|---|
| G1 | Pengrajin bisa menghasilkan katalog tanpa mengetik | 0 karakter ketikan wajib dari input awal sampai katalog terbit | Uji alur dengan keyboard dinonaktifkan |
| G2 | Waktu dari mulai sampai katalog siap tinjau | p50 di bawah 3 menit | Timestamp `job.created_at` â†’ `job.completed_at` |
| G3 | Antarmuka dapat dioperasikan pengguna dengan gangguan penglihatan | 0 pelanggaran axe-core serius/kritis di seluruh rute | CI gate |
| G4 | Pendamping dapat membantu tanpa akses penuh | Pengrajin dapat mencabut akses, dan pencabutan berlaku seketika | Uji integrasi |
| G5 | Katalog tersedia dalam bahasa pasar ekspor | ID + EN penuh; JA, ZH, AR on-demand | Uji E2E per bahasa |

### Koreksi terhadap klaim proposal

Tiga klaim di proposal tidak dapat dipenuhi apa adanya dan **wajib direvisi sebelum presentasi**:

| Klaim proposal | Masalah | Revisi yang jujur |
|---|---|---|
| "menjaga latensi interaksi di bawah 300ms" | Tidak mungkin untuk inferensi gambar/video. Generate gambar butuh belasan detik. | Batasi klaim pada **respons antarmuka**: tap sampai umpan balik visual < 300ms. Pekerjaan AI berjalan asinkron dengan indikator progres. Ini klaim yang bisa diukur dan dipertahankan. |
| "memangkas biaya komputasi/API hingga 70%" | Tidak ada baseline yang diukur. Angka ini tidak punya asal. | Ganti dengan angka nyata: biaya per katalog dihitung dari tarif terpublikasi, dibandingkan tarif jasa foto produk + copywriter. Sertakan perhitungannya. Kalau tidak sempat diukur, hapus klaimnya. |
| "WCAG 2.1 AAA" | AAA sangat ketat; beberapa kriteria (mis. 1.4.6 kontras 7:1, 2.4.9 tujuan tautan) sulit dipenuhi menyeluruh. | Pertahankan target AAA untuk **kontras dan ukuran target**, nyatakan **AA menyeluruh + AAA pada kriteria terpilih**, dan lampirkan laporan axe-core sebagai bukti. Klaim berbasis bukti mengalahkan klaim besar tanpa bukti. |

### Bukan tujuan

- Menjadi marketplace. Tidak ada keranjang, checkout, atau pembayaran di rilis ini.
- Menggantikan peran pendamping. Platform mengurangi ketergantungan, tidak menghapusnya.
- Melatih model AI sendiri.

## 5. Ruang lingkup

### 5.1 Fitur utama â€” dibangun penuh

Nama fitur dipertahankan persis seperti proposal. Teknologi di baliknya berubah; alasannya di ADR.

#### F1 â€” Voice-to-Story Generator `[WAJIB DEMO]`

Pengrajin menekan satu tombol besar, bercerita 30 detik tentang produknya. Sistem mentranskripsi,
lalu menyusun nama produk, cerita, spesifikasi teknis, copywriting media sosial, dan kata kunci SEO.

**Mengapa ini fitur inti:** ia menyelesaikan hambatan #2 dan #3 sekaligus, paling murah dijalankan,
dan paling terasa sebagai AI saat didemokan.

Kriteria penerimaan:
- Rekaman 10â€“60 detik diterima; di luar itu ditolak dengan pesan yang menjelaskan alasannya.
- Transkrip Bahasa Indonesia tampil sebelum pemrosesan LLM, dan **dapat dikoreksi pengrajin**.
  Ini penting: ASR akan salah pada nama daerah dan istilah kriya.
- Output berisi minimal: nama produk, cerita 80â€“150 kata, 3â€“6 spesifikasi, 1 caption media sosial,
  5 kata kunci.
- Semua output dapat disunting sebelum terbit.
- Kegagalan pada satu bahasa tidak menggagalkan bahasa lain.

#### F2 â€” 3D Studio Mockup Enhancer `[WAJIB DEMO]`

Foto produk mentah ditempatkan pada latar studio yang tampak profesional, dengan pencahayaan dan
bayangan kontak yang wajar.

Kriteria penerimaan:
- Menerima JPEG/PNG/WebP sampai 10 MB.
- Menghasilkan minimal 3 varian latar dari pustaka gaya yang telah ditentukan.
- **Produk tidak boleh berubah bentuk, warna, atau tekstur.** Ini kriteria gagal/lolos, bukan
  preferensi. Model yang mengubah produk berarti berbohong tentang barang yang dijual.
- Pengrajin dapat menolak hasil dan mempertahankan foto asli.
- Foto asli selalu disimpan dan tidak pernah ditimpa.

#### F3 â€” Talking-Catalog & AI Avatar `[DEMO â€” teknologi diganti]`

Katalog yang menarasikan dirinya: suara, teks berjalan, dan avatar 2D yang menandai bagian yang
sedang dibacakan.

**Koreksi terhadap proposal:** SadTalker dan LivePortrait membutuhkan CUDA. GPU yang tersedia adalah
Intel Arc iGPU 2 GB tanpa CUDA. Keduanya tidak dapat dijalankan. Lihat `docs/adr/ADR-005-avatar-engine.md`.

Gantinya: avatar 2D berbasis SVG dengan gerak mulut yang digerakkan amplitudo audio, ditambah TTS
dan subtitle tersinkronisasi. Ini bukan penurunan kualitas semata â€” untuk pengguna tunarungu,
subtitle yang akurat lebih bernilai daripada wajah realistis yang berbicara.

Kriteria penerimaan:
- Subtitle tersinkron dengan audio, toleransi Â±200 ms.
- Dapat dijeda, dilanjutkan, dan diulang dari awal.
- Bekerja penuh tanpa suara (subtitle saja) dan tanpa gambar (audio saja).
- Kontrol putar dapat dijangkau keyboard.

#### F4 â€” Global Listing & Export Hub `[DEMO]`

Ekspor katalog ke PDF, halaman web publik, dan berkas feed marketplace.

Kriteria penerimaan:
- PDF memiliki tag struktur dan teks alternatif pada gambar (PDF/UA dasar).
- Halaman publik memuat < 2,5 detik LCP pada koneksi 4G tersimulasi.
- Feed CSV mengikuti format kolom Google Merchant Center.
- Setiap ekspor mencantumkan nama pengrajin.

### 5.2 Fitur pendukung â€” dari `Fitur pendukung.pdf`

Sumber menominasikan 15 fitur dan menandai 5 sebagai paling bernilai. Kami mengikuti prioritas itu.

| # | Fitur | Prioritas | Keputusan |
|---|---|---|---|
| S1 | Accessibility Mode | Wajib | Satu tombol, lima profil: visual, pendengaran, motorik, kognitif, bantuan suara. Memilih profil mengubah ukuran teks, kontras, ukuran tombol, dan pembacaan otomatis sekaligus. |
| S2 | Guided Navigation | Wajib | **Enam langkah:** Foto â†’ Cerita â†’ **Transkrip** â†’ Proses â†’ Periksa â†’ Terbit. Sumber mengusulkan lima; langkah Transkrip ditambahkan oleh ADR-008. Satu layar satu keputusan. |
| S3 | Caregiver Access + RBAC | Wajib | Pendamping diundang, aksesnya terbatas dan dapat dicabut seketika oleh pengrajin. |
| S4 | Voice Navigation | Wajib | Perintah: "buka produk saya", "buat katalog", "lanjut", "kembali", "simpan", "terbitkan". |
| S5 | Auto Save + Error Assistance | Wajib | Draf tersimpan otomatis setiap 5 detik. Pesan error menyebut apa yang terjadi, apakah data aman, dan langkah berikutnya. |
| S6 | Screen Reader & TTS | Wajib | Struktur ARIA benar di seluruh rute; TTS untuk membacakan katalog. |
| S7 | Subtitle & Visual Indicator | Wajib | Melekat pada F3. Status tidak pernah disampaikan lewat warna saja. |
| S8 | High Contrast & Font Adjustment | Wajib | Font Adjustment masuk profil Visual di S1. **Tidak ada mode kontras tinggi terpisah** — palet bawaan sudah AAA pada seluruh pasangan terukur, sehingga menaikkan kontras dari 14,73:1 tidak memberi manfaat terukur. Alasan lengkap di `docs/spec/FEATURE-SPECS.md` bagian S1. |
| S9 | Large Button / Easy Touch | Wajib | Target minimum 56Ã—56 px di seluruh produk. |
| S10 | Notifikasi Multimodal | Wajib | Visual + audio + getar bila perangkat mendukung. |
| S11 | Keamanan Akun | Wajib | Lihat bagian 6. |
| S12 | Offline / Low Connectivity | Sedang | Draf tersimpan lokal, disinkronkan saat koneksi kembali. |
| S13 | Tutorial Interaktif | Sedang | Dibangun setelah alur inti stabil. |
| S14 | Activity Log | Sedang | Dicatat sejak awal, antarmukanya menyusul. |
| S15 | Role & Permission | Wajib | Menyatu dengan S3. |

### 5.3 Di luar lingkup rilis ini

| Item | Alasan |
|---|---|
| Payment Gateway (QRIS/Midtrans/Stripe) | Butuh verifikasi badan usaha. Diganti tombol "Hubungi Pengrajin" via WhatsApp. Dijelaskan sebagai peta jalan saat presentasi. |
| Order & Transaction Service | Mengikuti keputusan di atas. |
| Sinkronisasi marketplace dua arah | Rilis ini hanya menghasilkan berkas feed, tidak menulis balik ke marketplace. |
| Aplikasi native Kotlin | Proposal menyebut PWA. Android dikirim sebagai TWA dari PWA yang sama. Lihat `docs/adr/ADR-002-android-twa.md`. |

## 6. Keamanan dan privasi

Platform ini menyimpan rekaman suara dan foto milik kelompok rentan. Itu menaikkan standar,
bukan menurunkannya.

| Kontrol | Keputusan |
|---|---|
| Autentikasi | Nomor HP + OTP. PIN 6 digit sebagai alternatif untuk pengguna dengan keterbatasan kognitif, sesuai usulan `Fitur pendukung.pdf` hal. 6. |
| Sesi | Token berumur pendek + refresh token. Habis masa setelah 30 hari tidak aktif. |
| Otorisasi | RBAC: pengrajin, pendamping, admin, pembeli. Setiap pemeriksaan dilakukan di sisi server. |
| Akses pendamping | Berbasis undangan, kadaluarsa otomatis, dan dapat dicabut seketika. Pencabutan membatalkan token aktif, bukan sekadar menandai baris di basis data. |
| Media | Objek privat. Akses lewat URL bertanda tangan berumur pendek. Tidak ada bucket publik. |
| Data suara | Rekaman mentah dihapus setelah transkripsi berhasil, kecuali pengrajin memilih menyimpannya. |
| Log aktivitas | Mencatat siapa mengubah apa dan kapan, khususnya aksi pendamping. |
| Rahasia | Tidak ada kunci API di repositori. Semua lewat Wrangler secrets dan `.env` lokal yang diabaikan git. |
| Persetujuan | Pengrajin menyetujui secara eksplisit sebelum karyanya diterbitkan publik. |

## 7. Asumsi dan ketergantungan

| # | Asumsi | Kalau salah |
|---|---|---|
| A1 | WiFi venue final tersedia dan stabil | Demo utama gagal. Mitigasi: hotspot cadangan + cache aset demo. Lihat risk register R-01. |
| A2 | Akun Cloudflare free mencukupi untuk beban demo | Beralih ke Workers Paid (~$5/bulan) |
| A3 | Kuota gratis Groq mencukupi untuk ASR | Fallback ke Cloudflare Workers AI Whisper |
| A4 | Akun Gemini berlangganan tetap aktif dan tidak diblokir | Fallback otomatis ke Cloudflare Workers AI. Lihat `docs/adr/ADR-004-image-provider.md`. |
| A5 | Panitia mengizinkan perubahan teknologi selama fitur tetap | Sudah dikonfirmasi pemilik produk |

## 8. Pertanyaan terbuka

| # | Pertanyaan | Penanggung jawab | Dibutuhkan sebelum |
|---|---|---|---|
| Q1 | Apa rubrik penilaian juri final? | Ketua tim | Minggu 2 â€” memengaruhi prioritas |
| Q2 | Berapa lama slot demo? | Ketua tim | Minggu 4 â€” menentukan skrip demo |
| Q3 | Apakah angka BPS di proposal dapat diverifikasi ke sumber primer? | Romadhon | Sebelum slide final dikunci |
| Q4 | Apakah ada pengrajin difabel nyata yang bisa menguji alur? | Tim | Minggu 6 â€” pengujian usability |
| Q5 | Berapa ukuran PDF maksimal yang wajar untuk diunduh pembeli? | Tim | Minggu 5 |

## 9. Rujukan

- `PROPOSAL DIGIBOOM_KATAVIS_APHACKATON 2026.pdf` â€” dokumen sumber utama
- `Fitur pendukung.pdf` â€” sumber fitur aksesibilitas
- `DESIGN.md` â€” arah visual yang mengikat
- `docs/ARCHITECTURE.md` â€” rancangan sistem
- `docs/adr/` â€” catatan keputusan teknis
- `docs/testing/TEST-PLAN.md` â€” strategi pengujian
- `docs/ops/RISK-REGISTER.md` â€” risiko dan mitigasi
