# Spesifikasi Fitur KATAVIS

Turunan dari `docs/PRD.md`. Dokumen ini menetapkan perilaku yang dapat diuji.
Setiap kriteria penerimaan memiliki ID kasus uji di `docs/testing/TEST-PLAN.md`.

---

## F1 â€” Voice-to-Story Generator

### Cerita pengguna

> Sebagai pengrajin yang kesulitan menulis, saya ingin menceritakan produk saya dengan suara,
> agar saya punya deskripsi jualan tanpa harus mengetik.

### Alur

```
1. Layar rekam
   - Satu tombol bundar 96px di tengah layar
   - Label "Tekan dan ceritakan produk Anda"
   - Contoh pertanyaan pemandu: "Terbuat dari apa? Berapa lama membuatnya?
     Apa yang membuatnya istimewa?"

2. Merekam
   - Indikator gelombang suara bergerak mengikuti amplitudo nyata
   - Penghitung waktu naik
   - Tombol berhenti berukuran sama
   - Peringatan visual dan audio pada detik ke-50

3. Selesai merekam
   - Pemutar untuk mendengarkan ulang
   - "Rekam ulang" atau "Lanjutkan"

4. Layar tinjau transkrip        <- ADR-008
   - Transkrip dalam kotak teks besar yang dapat disunting
   - Tombol pembacaan TTS untuk pengguna yang tidak membaca layar
   - "Rekam ulang" atau "Sudah benar, lanjutkan"

5. Pemrosesan
   - Progres nyata per tahap, bukan animasi tanpa arti
   - "Menyusun cerita... 40%"
```

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| F1-01 | Rekaman 10â€“60 detik diterima | TC-U-CAT-01 sampai 03 |
| F1-02 | Di luar rentang ditolak dengan pesan yang menyebut batasnya | TC-U-CAT-01, 02 |
| F1-03 | Transkrip tampil sebelum LLM dan dapat disunting | TC-E2E-17 |
| F1-04 | Transkrip dapat dibacakan TTS | TC-A11Y-12 |
| F1-05 | Keluaran memuat nama produk, cerita 80â€“150 kata, 3â€“6 spesifikasi, 1 caption, 5 kata kunci | TC-E2E-01 |
| F1-06 | Seluruh keluaran dapat disunting sebelum terbit | TC-E2E-01 |
| F1-07 | Kegagalan satu bahasa tidak menggagalkan bahasa lain | TC-U-JOB-10 |
| F1-08 | Alur selesai tanpa mengetik satu karakter pun | TC-E2E-02 |
| F1-09 | Fallback ASR bekerja saat Groq mengembalikan 429 | TC-E2E-12 |
| F1-10 | Rekaman mentah dihapus setelah transkripsi berhasil | TC-I-11 |

### Prompt LLM â€” struktur

Prompt memaksa keluaran JSON tervalidasi Zod. Keluaran yang tidak sesuai skema ditolak dan diulang
sekali, bukan diterima apa adanya.

```
Peran      : penulis katalog produk kerajinan tangan Indonesia
Masukan    : transkrip cerita pengrajin + atribut visual dari foto
Batasan    : - Jangan menambahkan fakta yang tidak ada di transkrip
             - Jangan menyebut bahan atau ukuran yang tidak disebutkan pengrajin
             - Nada personal, bukan bahasa pemasaran korporat
             - Hindari kata: revolusioner, terbaik, premium, eksklusif
Keluaran   : JSON sesuai skema
```

Batasan "jangan menambahkan fakta" adalah yang terpenting. LLM yang mengarang bahan atau ukuran
akan menghasilkan katalog yang salah tentang barang nyata, dan pengrajin yang menanggung akibatnya.

---

## F2 â€” 3D Studio Mockup Enhancer

### Cerita pengguna

> Sebagai pengrajin tanpa kamera bagus, saya ingin foto produk saya terlihat profesional,
> agar pembeli tertarik melihatnya.

### Alur

```
1. Ambil atau pilih foto
   - Kamera langsung atau dari galeri
   - Panduan: "Letakkan produk di tempat terang, latar polos"

2. Pratinjau
   - Foto asli ditampilkan
   - "Ganti foto" atau "Buat foto studio"

3. Pilih suasana
   - Tiga pilihan dengan pratinjau: Marmer Terang, Kayu Hangat, Latar Gelap
   - Ikon disertai label teks

4. Pemrosesan
   - Progres nyata
   - Foto asli tetap terlihat selama proses

5. Hasil
   - Perbandingan berdampingan: asli dan hasil
   - "Pakai hasil ini" atau "Pakai foto asli" atau "Coba suasana lain"
```

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| F2-01 | Menerima JPEG, PNG, WebP sampai 10 MB | TC-U-CAT-04 |
| F2-02 | SVG ditolak | TC-U-CAT-05, TC-SEC-09 |
| F2-03 | Validasi berdasar magic bytes, bukan ekstensi | TC-U-CAT-06 |
| F2-04 | Menghasilkan minimal 3 varian latar | TC-E2E-01 |
| F2-05 | **Produk tidak berubah bentuk, warna, atau tekstur** | TC-SA-07 |
| F2-06 | Pengrajin dapat menolak hasil | TC-E2E-01 |
| F2-07 | Foto asli tidak pernah ditimpa | TC-E2E-13 |
| F2-08 | Fallback Gemini ke Workers AI dalam 45 detik | TC-E2E-11 |
| F2-09 | Kegagalan seluruh penyedia mempertahankan foto asli | TC-E2E-13 |

F2-05 adalah kriteria gagal/lolos, bukan preferensi. Diverifikasi dengan perbandingan perseptual
antara foto asli dan hasil. Ambang kemiripan struktur ditetapkan setelah pengukuran Minggu 1.

### Prompt generate gambar

```
Tempatkan produk ini persis seperti aslinya pada {suasana}.
Pencahayaan studio lembut dari kiri atas, bayangan kontak yang wajar,
kedalaman bidang dangkal.
JANGAN mengubah bentuk, warna, tekstur, atau proporsi produk.
```

Kalimat terakhir wajib ada dalam setiap prompt. Ia menegakkan F2-05 di tingkat masukan model,
bukan hanya di tingkat pemeriksaan keluaran.

---

## F3 â€” Talking-Catalog & AI Avatar

### Cerita pengguna

> Sebagai pembeli, saya ingin mendengar cerita di balik produk,
> agar saya memahami nilainya sebelum membeli.

### Perilaku

```
Halaman katalog publik memuat:
  - Foto studio produk sebagai elemen utama
  - Avatar 2D berukuran sedang di sisi cerita
  - Tombol "Dengarkan cerita" sebagai aksi utama
  - Subtitle muncul menyorot kalimat yang sedang dibacakan
  - Kendali: putar, jeda, ulang dari awal
```

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| F3-01 | Subtitle tersinkron, toleransi Â±200 ms | TC-A11Y-24 |
| F3-02 | Dapat dijeda, dilanjutkan, diulang | TC-E2E-06 |
| F3-03 | Berfungsi penuh tanpa suara | TC-A11Y-26 |
| F3-04 | Berfungsi penuh tanpa gambar | TC-A11Y-27 |
| F3-05 | Kendali dapat dijangkau papan ketik | TC-A11Y-22 |
| F3-06 | Animasi berhenti di bawah `prefers-reduced-motion` | TC-A11Y-08 |
| F3-07 | Subtitle adalah teks nyata, bukan piksel dalam video | TC-A11Y-28 |

F3-03 dan F3-04 menguji hal yang sama dari dua arah: informasi tidak boleh bergantung pada satu
kanal indra. Ini yang membedakan fitur ini dari video promosi biasa.

---

## F4 â€” Global Listing & Export Hub

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| F4-01 | PDF memiliki tag struktur | TC-E2E-07 |
| F4-02 | Gambar dalam PDF memiliki teks alternatif | TC-E2E-07 |
| F4-03 | Halaman publik LCP < 2,5 detik pada 4G | TC-PERF-05 |
| F4-04 | Feed CSV sesuai kolom Google Merchant Center | TC-E2E-08 |
| F4-05 | Setiap ekspor mencantumkan nama pengrajin | TC-E2E-07, 08 |

---

## S1 â€” Accessibility Mode

### Perilaku

Satu tombol permanen di pojok layar, dapat dijangkau dari halaman mana pun. Menekan tombol membuka
lima pilihan profil yang dapat digabung.

| Profil | Perubahan token | Perubahan perilaku |
|---|---|---|
| Visual | Teks tubuh 20px, target 64px | TTS aktif, teks alternatif dibacakan |
| Pendengaran | â€” | Subtitle aktif, seluruh audio mendapat padanan visual, getar aktif |
| Motorik | Target 72px, jarak 16px | Tanpa batas waktu interaksi, konfirmasi ganda untuk aksi merusak |
| Kognitif | — | Satu aksi per layar dipaksakan, bahasa disederhanakan, progres selalu terlihat |
| Bantuan suara | — | Voice Navigation aktif |

### Batas rekam 60 detik pada profil Motorik dan Kognitif

Kedua profil menghapus **batas waktu interaksi** — tidak ada layar yang menutup sendiri, tidak ada
hitung mundur yang membatalkan tindakan, tidak ada sesi yang berakhir saat pengguna berpikir.

Batas 60 detik pada perekaman **bukan batas waktu interaksi**. Ia batas teknis penyedia ASR dan
batas mutu: rekaman lebih panjang menurunkan ketepatan transkripsi dan memperpanjang waktu proses.

Perilaku pada kedua profil:
- Peringatan detik ke-50 tetap muncul, tetapi tidak menghentikan rekaman secara mendadak.
- Saat mencapai 60 detik, rekaman disimpan — tidak dibuang. Pengrajin dapat melanjutkan cerita
  dalam rekaman kedua yang digabungkan.
- Tidak ada hitung mundur yang menimbulkan tekanan; yang ditampilkan waktu berjalan naik.

### Kontras pada profil Visual

Palet bawaan sudah memenuhi AAA pada seluruh pasangan yang dipakai. Karena itu profil Visual
**tidak mengganti warna** — ia menaikkan ukuran teks dan target.

Ini keputusan sadar: mode kontras tinggi terpisah akan menghasilkan palet kedua yang harus diukur
dan diuji sendiri. Menaikkan kontras dari 14,73:1 tidak memberi manfaat terukur bagi siapa pun.

Konsekuensinya, S1-05 menguji bahwa perubahan ukuran tidak merusak kontras yang sudah ada, bukan
bahwa ada palet kedua.

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| S1-01 | Tombol dapat dijangkau dari seluruh halaman | TC-A11Y-11 |
| S1-02 | Profil dapat digabung | TC-A11Y-25 |
| S1-03 | Pilihan tersimpan antar sesi | TC-I-13 |
| S1-04 | Setiap profil diuji terpisah dan digabung | TC-A11Y-25 |
| S1-05 | Kontras tetap memenuhi tabel pada seluruh profil | TC-A11Y-02 |
| S1-06 | Profil Motorik tidak menghapus batas rekam 60 detik | TC-A11Y-29 |
| S1-07 | Rekaman yang mencapai 60 detik disimpan, bukan dibuang | TC-A11Y-29 |

---

## S2 — Guided Navigation

### Cerita pengguna

> Sebagai pengrajin yang belum terbiasa dengan aplikasi, saya ingin dituntun satu langkah demi
> satu langkah, agar saya tidak perlu memahami seluruh sistem sekaligus.

### Enam langkah

```
1. Foto Produk       "Arahkan kamera ke produk Anda."
2. Rekam Cerita      "Tekan tombol dan ceritakan produk Anda."
3. Periksa Transkrip "Apakah ini yang Anda ceritakan?"        <- ADR-008
4. Sistem Memproses  "KATAVIS sedang membuat katalog Anda."
5. Periksa Hasil     "Apakah katalog sudah sesuai?"
6. Terbitkan         "Katalog siap dilihat pembeli."
```

Langkah 1, 2, 4, 5, 6 diambil dari `Fitur pendukung.pdf` halaman 2–3, termasuk kalimat panduannya.
Langkah 3 ditambahkan ADR-008.

### Aturan yang mengikat

- **Satu aksi utama per layar.** Bila ada dua tombol dengan bobot visual setara, desainnya salah.
- Indikator langkah selalu terlihat: "Langkah 2 dari 6".
- Mundur ke langkah sebelumnya tidak menghapus pekerjaan.
- Melompati langkah tidak mungkin, termasuk lewat manipulasi URL.
- Setiap langkah punya judul yang menjelaskan apa yang harus dilakukan, bukan nama fitur.

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| S2-01 | Enam langkah dalam urutan tetap | TC-E2E-25 |
| S2-02 | Setiap layar punya tepat satu aksi utama | TC-E2E-25 |
| S2-03 | Mundur tidak menghilangkan data | TC-E2E-25 |
| S2-04 | Melompati langkah lewat URL ditolak | TC-E2E-25 |
| S2-05 | Indikator posisi langkah terlihat di setiap layar | TC-E2E-25 |
| S2-06 | Alur selesai tanpa mengetik | TC-E2E-02 |

---

## S6 — Screen Reader dan Text-to-Speech

### Dua hal berbeda yang sering dicampur

| | Screen reader | TTS in-app |
|---|---|---|
| Siapa menjalankan | NVDA, TalkBack, VoiceOver milik pengguna | Tombol di dalam KATAVIS |
| Membaca apa | Seluruh antarmuka | Isi tertentu: transkrip, cerita katalog |
| Tanggung jawab kami | Struktur ARIA yang benar | Menyediakan tombol dan suaranya |

Keduanya wajib bekerja, dan keduanya diuji terpisah.

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| S6-01 | NVDA membaca seluruh alur enam langkah | TC-A11Y-20 |
| S6-02 | TalkBack pada perangkat Android fisik | TC-A11Y-21 |
| S6-03 | Tombol TTS membacakan transkrip | TC-A11Y-12 |
| S6-04 | Perubahan status diumumkan lewat `aria-live` | TC-A11Y-01 |
| S6-05 | Urutan heading tanpa tingkat terlompati | TC-A11Y-06 |
| S6-06 | Urutan fokus mengikuti urutan visual | TC-A11Y-22 |

S6-04 penting untuk langkah 4: pemrosesan berjalan 60 detik, dan pengguna screen reader harus
mendengar kemajuannya, bukan menunggu dalam senyap.

---

## S10 — Notifikasi Multimodal

### Perilaku

Setiap peristiwa penting disampaikan lewat tiga kanal sekaligus. Mematikan satu kanal tidak
menghilangkan informasi.

| Peristiwa | Visual | Audio | Getar |
|---|---|---|---|
| Foto tersimpan | Ikon centang + "Foto tersimpan" | Nada pendek | 1 getar singkat |
| Katalog selesai | Banner + "Katalog Anda sudah selesai" | "Katalog Anda sudah selesai" | 2 getar |
| Kesalahan | Ikon peringatan + pesan + langkah berikutnya | Nada berbeda dari keberhasilan | 3 getar pendek |

### Aturan

- Nada keberhasilan dan kegagalan **wajib berbeda**. Nada yang sama membuat pengguna tunanetra
  tidak dapat membedakan hasil.
- Getar memakai Vibration API. Bila perangkat tidak mendukung, dua kanal lain tetap jalan dan
  tidak ada galat yang muncul.
- Notifikasi visual bertahan sampai dibaca, tidak hilang sendiri setelah beberapa detik. Pengguna
  yang membaca lambat tidak boleh kehilangan informasi.

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| S10-01 | Satu peristiwa memicu tiga kanal | TC-E2E-26 |
| S10-02 | Nada berhasil dan gagal berbeda | TC-E2E-26 |
| S10-03 | Perangkat tanpa Vibration API tidak menimbulkan galat | TC-E2E-26 |
| S10-04 | Notifikasi visual tidak hilang sendiri | TC-E2E-26 |
| S10-05 | Warna bukan satu-satunya pembawa informasi | TC-A11Y-01 |

---

## Persetujuan pengguna

Dua persetujuan terpisah, keduanya wajib dan keduanya diuji.

| Persetujuan | Kapan diminta | Isi |
|---|---|---|
| Pengiriman audio | Sebelum perekaman pertama | Suara dikirim ke layanan transkripsi pihak ketiga; rekaman mentah dihapus setelah berhasil |
| Publikasi | Sebelum langkah 6 | Katalog akan dapat dilihat siapa pun; nama pengrajin ikut tampil |

Keduanya memakai kotak centang yang mati secara bawaan. Persetujuan yang dicentang otomatis bukan
persetujuan.

| ID | Kriteria | Uji |
|---|---|---|
| CON-01 | Merekam tanpa persetujuan audio ditolak di server | TC-I-14 |
| CON-02 | Menerbitkan tanpa persetujuan publikasi ditolak di server | TC-I-15 |
| CON-03 | Teks persetujuan terbaca screen reader | TC-E2E-24 |
| CON-04 | Kotak centang mati secara bawaan | TC-E2E-24 |

---

## S3 â€” Caregiver Access dan RBAC

### Matriks izin

| Tindakan | Pengrajin | Pendamping | Admin | Pembeli |
|---|---|---|---|---|
| Lihat produk sendiri | Ya | Bila diizinkan | Ya | Tidak |
| Buat draf | Ya | Bila diizinkan | Tidak | Tidak |
| Sunting draf | Ya | Bila diizinkan | Tidak | Tidak |
| Unggah media | Ya | Bila diizinkan | Tidak | Tidak |
| Ajukan tinjauan | Ya | Bila diizinkan | Tidak | Tidak |
| **Terbitkan** | **Ya** | **Tidak** | Tidak | Tidak |
| **Hapus produk** | **Ya** | **Tidak** | Tidak | Tidak |
| Kurasi produk | Tidak | Tidak | Ya | Tidak |
| Sunting isi katalog | Ya | Bila diizinkan | **Tidak** | Tidak |
| Lihat katalog terbit | Ya | Ya | Ya | Ya |

Dua baris yang tebal menegakkan prinsip dari `Fitur pendukung.pdf` halaman 5: pendamping membantu
tanpa mengambil alih. Menerbitkan dan menghapus adalah keputusan pemilik karya.

Admin tidak dapat menyunting isi katalog. Ia mengurasi â€” menerima atau menolak â€” bukan menulis ulang
cerita pengrajin.

### Alur undangan

```
1. Pengrajin membuka "Pendamping saya"
2. "Undang pendamping" â†’ masukkan nomor HP
3. Pilih izin dengan kotak centang, semuanya mati secara bawaan
4. Undangan dikirim, berlaku 24 jam
5. Pendamping menerima, tautan terbentuk dengan status aktif
6. Pengrajin melihat: "Pendamping: {nama} â€” Terhubung"
7. "Cabut akses" tersedia setiap saat
```

Seluruh izin mati secara bawaan. Pengrajin menyalakan yang dibutuhkan, bukan mematikan yang tidak.

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| S3-01 | Izin mati secara bawaan | TC-U-RBAC-03, 04 |
| S3-02 | Pencabutan berlaku seketika pada sesi aktif | TC-I-04, TC-SEC-16, TC-E2E-05 |
| S3-03 | Undangan kedaluwarsa 24 jam | TC-U-RBAC-13 |
| S3-04 | Undangan tidak dapat dipakai dua kali | TC-SEC-15 |
| S3-05 | Aksi pendamping tercatat dengan `on_behalf_of` | TC-I-09 |
| S3-06 | Pendamping tidak dapat menerbitkan atau menghapus | TC-U-RBAC-04, 07 |

S3-02 adalah yang paling penting. Pencabutan yang hanya mengubah baris basis data sementara token
lama masih sah bukanlah pencabutan.

---

## S5 â€” Auto Save dan Error Assistance

### Auto Save

```
Pemicu     : setiap 5 detik bila ada perubahan, dan pada setiap perpindahan langkah
Penyimpanan: IndexedDB lokal, lalu disinkronkan ke D1
Indikator  : "Tersimpan" dengan penanda waktu, bukan animasi berputar
Pemulihan  : saat membuka aplikasi, draf yang belum selesai ditawarkan untuk dilanjutkan
```

### Error Assistance

Setiap `error_code` dipetakan ke pesan yang memuat tiga hal: apa yang terjadi, apakah pekerjaan
aman, dan langkah berikutnya.

| `error_code` | Pesan ke pengrajin |
|---|---|
| `IMAGE_GENERATE_FAILED` | "Foto studio belum berhasil dibuat. Foto asli Anda tetap tersimpan. [Coba Lagi] [Pakai Foto Asli]" |
| `ASR_NO_SPEECH` | "Suara belum terdengar jelas. Silakan rekam lagi di tempat yang lebih tenang. [Rekam Ulang]" |
| `ASR_TOO_SHORT` | "Rekaman terlalu pendek. Ceritakan sedikit lebih panjang, sekitar 30 detik. [Rekam Ulang]" |
| `NETWORK_OFFLINE` | "Tidak ada koneksi internet. Pekerjaan Anda tersimpan dan akan dilanjutkan otomatis." |
| `FILE_TOO_LARGE` | "Foto terlalu besar. Maksimal 10 MB. [Pilih Foto Lain]" |
| `QUOTA_EXCEEDED` | "Sistem sedang sibuk. Pekerjaan Anda tersimpan, coba lagi beberapa menit lagi." |

### Kriteria penerimaan

| ID | Kriteria | Uji |
|---|---|---|
| S5-01 | Draf tersimpan setiap 5 detik | TC-E2E-23 |
| S5-02 | Draf pulih setelah tab ditutup | TC-E2E-16 |
| S5-03 | Tidak ada istilah teknis terlihat pengguna | TC-E2E-20 |
| S5-04 | Setiap pesan galat memuat langkah berikutnya | TC-E2E-21 |
| S5-05 | Setiap pesan galat menyatakan apakah pekerjaan aman | TC-E2E-22 |

---

## S4 â€” Voice Navigation

| Perintah | Tindakan |
|---|---|
| "buka produk saya" | Ke daftar produk |
| "buat katalog" | Mulai alur baru |
| "lanjut" | Langkah berikutnya |
| "kembali" | Langkah sebelumnya |
| "simpan" | Simpan draf |
| "terbitkan" | Buka konfirmasi terbit |

"Terbitkan" membuka konfirmasi, tidak langsung menerbitkan. Aksi yang tidak dapat dibatalkan tidak
pernah dipicu satu perintah suara yang bisa salah dengar.

| ID | Kriteria | Uji |
|---|---|---|
| S4-01 | Enam perintah dikenali | TC-A11Y-23 |
| S4-02 | Perintah tidak dikenal memberi umpan balik, bukan diam | TC-A11Y-23 |
| S4-03 | "Terbitkan" membuka konfirmasi | TC-E2E-01 |
