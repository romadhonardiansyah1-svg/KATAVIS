# ADR-004 — Gemini web sebagai lapis 1 oportunistik, Workers AI sebagai jalur produksi

**Status** Diterima · **Tanggal** 15 September 2026
**Menyimpang dari proposal** Ya — bagian 4.1
**Risiko diterima secara eksplisit oleh pemilik produk**

## Istilah yang dipakai konsisten di seluruh dokumen

Dua sumbu berbeda, dan mencampurnya menimbulkan kebingungan:

| Sumbu | Istilah | Arti |
|---|---|---|
| **Urutan runtime** | lapis 1, lapis 2, lapis 3 | Siapa dicoba lebih dulu |
| **Status dukungan** | jalur produksi, jalur eksperimental | Mana yang dijamin bekerja |

Gemini adalah **lapis 1** (dicoba lebih dulu) tetapi **jalur eksperimental** (tidak dijamin).
Workers AI adalah **lapis 2** (cadangan) tetapi **jalur produksi** (dijamin).

Keduanya konsisten: yang dicoba lebih dulu bukan yang paling diandalkan.

## Konteks

Proposal bagian 4.1 menyebut "Segment Anything Model (SAM) + Stable Diffusion Inpainting / Flux API
untuk render 3D studio". Fitur 3D Studio Mockup Enhancer bergantung padanya.

Kendala mutlak: GPU yang tersedia adalah Intel Arc iGPU dengan 2 GB VRAM **tanpa CUDA**. SAM dan
Stable Diffusion tidak dapat dijalankan. Ini bukan soal lambat — ia tidak berjalan.

Pemilik produk memiliki akun Gemini berlangganan dan meminta memanfaatkannya lewat otomasi browser,
dengan fallback ke Cloudflare bila gagal.

## Keputusan

Rantai tiga lapis di balik satu antarmuka `ImageProvider`:

1. **GeminiWebProvider** — Studio Agent di laptop, Chrome asli dengan profil yang sudah login
   manual, dikendalikan lewat CDP. Batas waktu keras 45 detik.
2. **WorkersAIProvider** — `@cf/black-forest-labs/flux-2-klein-9b`. Selalu siap.
3. **CachedProvider** — aset yang diproduksi sebelum hari-H. Jaring terakhir.

Kegagalan atau kelewatan batas waktu pada lapis 1 memindahkan pekerjaan ke lapis 2 secara otomatis,
tanpa campur tangan manusia.

## Alasan memilih lapis 1 meski berisiko

Pemilik produk telah membaca bukti risiko dan tetap memilih jalur ini. Alasan yang dinyatakan:
memanfaatkan langganan yang sudah dibayar dan mengejar kualitas gambar tertinggi.

Keputusan ini dihormati, dengan syarat arsitektur dirancang agar demo **tidak pernah bergantung
padanya**. Itulah sebab lapis 2 dan 3 ada, dan sebab batas waktu ditetapkan keras.

## Risiko yang diterima — dinyatakan lengkap

### Pelanggaran Terms of Service

Google Terms of Service, berlaku 30 Juli 2026, bagian *"Don't abuse our services"* melarang:
- "spamming, hacking, or **bypassing our systems or protective measures**"
- "**hiding or misrepresenting who you are** in order to violate these terms"
- "using **automated means** to access content from any of our services in violation of the
  machine-readable instructions on our web pages"

Otomasi anti-deteksi melakukan poin pertama dan kedua secara desain.

### Sanksi yang mungkin

Bagian *"Suspending or terminating your access"* memberi Google hak menangguhkan akses "**or delete
your Google Account**". Yang berisiko bukan hanya Gemini, melainkan Gmail, Drive, dan Photos pada
akun yang sama.

**Mitigasi wajib:** gunakan akun Google terpisah yang tidak memuat data penting, bukan akun utama
anggota tim.

### Tidak ada perkakas yang terbukti aman untuk Google

| Perkakas | Status | Terhadap Google |
|---|---|---|
| undetected-chromedriver | Commit terakhir 2025-07-05 | Tidak terpelihara |
| Playwright Chromium bawaan | Aktif | **Terbukti diblokir** — "This browser or app may not be secure" |
| Camoufox | Aktif | **Ada laporan terdeteksi** (camoufox#463). Isu #536 dan #555 menunjukkan Camoufox justru lebih mencurigakan daripada Firefox biasa |
| patchright | Paling aktif | Daftar bypass memuat Cloudflare, Kasada, Akamai, Datadome, Fingerprint.com — **Google tidak ada** |

Pencarian GitHub untuk proyek otomasi `gemini.google.com` mengembalikan **nol hasil**. Bandingkan
dengan ekosistem besar seputar ChatGPT. Ini konsisten dengan UI yang sering berubah, penegakan
aktif, atau keduanya.

### Kerapuhan selector

`gemini.google.com` adalah aplikasi Angular dengan nama kelas CSS yang diobfuskasi. Kelas semacam
itu berubah setiap penerapan. Selector akan pecah, dan pertanyaannya kapan, bukan apakah.

## Rancangan yang membatasi kerusakan

**Camoufox tidak dipakai.** Ada bukti terdeteksi Google, dan basis Firefox menambah entropi sidik
jari yang justru menjadi penanda.

**Tanpa otomasi proses masuk.** Login dilakukan manusia satu kali. Otomasi hanya menggerakkan sesi
yang sudah terautentikasi. Ini menghilangkan permukaan deteksi yang paling berat.

**Chrome asli, bukan Chromium bawaan Playwright.** Dijalankan lewat subprocess dengan
`--remote-debugging-port` dan `--user-data-dir`, lalu dihubungkan dengan `connectOverCDP`.
Chromium bawaan Playwright terbukti diblokir Google.

**Batas waktu 45 detik, bukan percobaan ulang tanpa batas.** Satu percobaan, lalu menyerah.

**Pemantauan kesehatan.** Studio Agent memeriksa selector saat mulai. Bila gagal, ia mendaftarkan
diri sebagai tidak sehat dan pekerjaan langsung menuju lapis 2 tanpa menunggu 45 detik.

## Konsekuensi

Positif:
- Kualitas gambar Gemini bila berhasil.
- Memanfaatkan langganan yang sudah dibayar.
- Demo tidak pernah bergantung padanya.

Negatif:
- Risiko penghapusan akun Google yang dipakai.
- Selector akan pecah dan menuntut pemeliharaan.
- Studio Agent hanya berjalan saat laptop hidup dan Chrome siap. Ia bukan komponen produksi.
- **Untuk presentasi:** menyebut Gemini sebagai tulang punggung akan sulit dipertahankan bila juri
  menggali. Jawaban yang dapat dipertahankan adalah Cloudflare Workers AI sebagai jalur produksi,
  dengan Gemini sebagai jalur eksperimental.

## Perbandingan biaya yang jujur

| Jalur | Biaya | Sumber | Risiko |
|---|---|---|---|
| Workers AI `flux-2-klein-9b` | $0,015/MP + $0,002/MP gambar masukan | docs Cloudflare Workers AI, model `flux-2-klein-9b` | Nol |
| Workers AI `flux-1-schnell` | 4,8 neuron/tile + 9,6/langkah | docs Workers AI pricing | Nol |
| Gemini API `gemini-2.5-flash-image` | $0,039/gambar 1024² | docs Gemini API pricing | Nol |
| Gemini API `gemini-3.1-flash-lite-image` | $0,0336/gambar 1K, **tanpa free tier** | docs Gemini API pricing | Nol |
| Gemini web otomasi | "Gratis" dari langganan | — | Akun, ToS, selector |

**Konversi ke rupiah belum dilakukan.** Kurs berubah, dan angka rupiah tanpa tanggal kurs adalah
angka tanpa sumber. Sebelum masuk slide, kurs pada tanggal presentasi dicatat bersama angkanya.

**Estimasi jatah gratis harian belum diverifikasi.** Angka "~7 gambar `flux-2-klein-9b`" dan
"~170 gambar `flux-1-schnell`" per hari diturunkan dari tarif neuron terhadap kuota 10.000
Neurons/hari, tetapi tarif neuron per gambar untuk ukuran keluaran yang kami pakai belum diukur.

Ini penting karena angka tersebut menjadi dasar R-06 di risk register dan seluruh strategi cache
aset demo. **Diukur pada Minggu 1** bersama uji tembak lainnya; bila meleset jauh, R-06 dikalibrasi
ulang.

## Pemicu peninjauan ulang

Keputusan ini ditinjau ulang bila salah satu terjadi:
- Akun yang dipakai ditangguhkan.
- Selector pecah lebih dari dua kali dalam satu minggu.
- Pengukuran menunjukkan waktu generate Gemini melampaui 45 detik secara konsisten.

Dalam ketiga kasus tersebut, Gemini dipindahkan ke jalur produksi aset sebelum hari-H, dan jalur
langsung dimatikan lewat feature flag.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| SAM + Stable Diffusion lokal seperti proposal | Tanpa CUDA. Tidak dapat dijalankan. |
| Camoufox | Ada bukti terdeteksi Google; menambah entropi sidik jari. |
| Penghapusan latar + penempelan klasik | Gagal pada pencahayaan, bayangan kontak, dan pantulan — justru ciri utama "studio mewah" yang menjadi nilai jual fitur ini. |
| Hanya Workers AI tanpa Gemini | Paling aman, tetapi pemilik produk memilih memanfaatkan langganan yang ada. |
