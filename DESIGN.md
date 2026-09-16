# DESIGN.md — Arah Visual KATAVIS

Dokumen ini adalah sumber arah desain. Antislop (R-37) menolak membangun UI tanpa file ini.
Antislop adalah filter; dokumen inilah yang menentukan identitas.

---

## 1. Siapa yang memakai ini

Pengrajin difabel dan pendamping SLB. Bukan desainer, bukan marketer, bukan pengguna SaaS.
Sebagian tunanetra atau low vision. Sebagian kesulitan motorik halus. Sebagian membaca lambat.
Perangkat mereka: Android kelas menengah ke bawah, layar 5–6 inci, dipakai sambil berdiri di
ruang kerja yang berdebu, kadang dengan satu tangan.

Konsekuensi desain yang tidak bisa ditawar:

- Tap target minimum 56×56 px, bukan 44. Ukuran 44 px adalah batas minimum WCAG untuk pengguna
  umum; pengguna dengan tremor atau kontrol motorik terbatas membutuhkan lebih.
- Tidak ada interaksi yang hanya bisa dilakukan dengan gestur presisi (drag halus, pinch, long-press
  tanpa alternatif).
- Setiap layar punya satu aksi utama. Kalau ada dua tombol setara, desainnya salah.
- Teks tubuh minimum 18 px. Bukan 14, bukan 16.

## 2. Tiga dial liveliness

| Dial | Nilai | Alasan |
|---|---|---|
| **ENERGY** | **2 (Balanced)** | Nilai 1 membuat platform terasa seperti situs birokrasi — melemahkan produk kriya yang justru bernilai artistik. Nilai 3 mengorbankan keterbacaan untuk pengguna low vision. Dua adalah satu-satunya yang jujur. |
| **RHYTHM** | **1 (Uniform)** | Layout yang berubah-ubah antarbagian memaksa pengguna kognitif mempelajari ulang setiap halaman. Keseragaman di sini adalah fitur aksesibilitas, bukan kemalasan. |
| **MOTION** | **1 (Hover/state saja)** | Motion dipakai hanya untuk umpan balik state. Tidak ada scroll-reveal, parallax, atau koreografi. `prefers-reduced-motion` dihormati mutlak. |

Dial ini berlaku dari layar pertama sampai terakhir. Tidak ada halaman "spesial" yang menaikkan
ENERGY ke 3 demi terlihat mengesankan.

**Pengecualian tunggal:** halaman katalog publik (yang dilihat pembeli, bukan pengrajin) boleh
RHYTHM 2. Audiensnya berbeda dan kebutuhan aksesibilitasnya berbeda. Ini dicatat sebagai keputusan
sadar, bukan inkonsistensi.

## 3. Palet — diturunkan dari material, bukan dari selera

Warna diambil dari material kriya nyata. Setiap nilai punya asal-usul yang bisa ditunjuk.

| Token | Hex | Asal | Dipakai untuk |
|---|---|---|---|
| `clay-900` | `#2E1F17` | Tanah liat gerabah Kasongan setelah dibakar | Teks utama, latar gelap |
| `clay-700` | `#5A3E2B` | Kulit samak nabati sebelum dipoles | Teks sekunder, border tegas |
| `clay-200` | `#E8DCCF` | Kertas daluang | Latar permukaan terangkat |
| `clay-50` | `#FAF6F0` | Kapas mentah | Latar halaman |
| `indigo-800` | `#1F3A5F` | Indigofera tinctoria, celupan batik ke-7 | Aksi utama, tautan |
| `indigo-600` | `#2E5A8A` | Indigo celupan ke-3 | Hover, cincin fokus, border — **bukan teks** |
| `rattan-500` | `#B8834A` | Rotan manau kering | Aksen, sorotan, badge status |
| `moss-700` | `#3D5A3D` | Pewarna daun jati muda | Status berhasil |
| `rust-700` | `#8B3A2F` | Pewarna mengkudu | Status gagal, aksi merusak |

### Yang dilarang keras

- Gradient ungu→biru, pink→oranye, atau kombinasi apa pun yang tidak berasal dari material di atas.
- Warna neon, saturasi di atas 70% untuk area luas.
- Dark mode yang sekadar membalik warna. Kalau dark mode dikirim, ia diturunkan ulang dari material
  yang sama dan diuji kontrasnya sendiri (R-34: setiap tema yang dikirim harus benar-benar bekerja).

### Kontras — target AAA, bukan AA

Proposal menjanjikan WCAG 2.1 AAA. Itu berarti rasio **7:1** untuk teks normal dan **4.5:1** untuk
teks besar.

Tabel di bawah dihitung dengan rumus luminansi relatif WCAG 2.1, bukan diperkirakan. Skripnya ada
di `tools/contrast.py` dan dijalankan di CI.

| Teks | Latar | Rasio terukur | Status |
|---|---|---|---|
| `clay-900` | `clay-50` | **14,73:1** | AAA |
| `clay-900` | `clay-200` | **11,75:1** | AAA |
| `clay-200` | `clay-900` | **11,75:1** | AAA |
| `clay-50` | `clay-900` | **14,73:1** | AAA |
| `indigo-800` | `clay-50` | **10,67:1** | AAA |
| `clay-50` | `indigo-800` | **10,67:1** | AAA |
| `indigo-800` | `clay-200` | **8,51:1** | AAA |
| `clay-700` | `clay-200` | **7,21:1** | AAA |
| `clay-700` | `clay-50` | **9,04:1** | AAA |
| `moss-700` | `clay-50` | **7,15:1** | AAA |
| `rust-700` | `clay-50` | **7,11:1** | AAA |

### Pasangan yang TIDAK lolos AAA — dilarang untuk teks normal

| Teks | Latar | Rasio | Boleh dipakai untuk |
|---|---|---|---|
| `indigo-600` | `clay-50` | **6,62:1** | Cincin fokus, border, latar tombol. **Bukan teks normal.** |
| `moss-700` | `clay-200` | **5,71:1** | Ikon, teks besar ≥24px |
| `rust-700` | `clay-200` | **5,67:1** | Ikon, teks besar ≥24px |
| `rattan-500` | `clay-900` | **4,82:1** | Teks besar di atas latar gelap |
| `rattan-500` | `clay-50` | **3,06:1** | Border dan fill saja. **Tidak pernah untuk teks.** |

Temuan penting: `indigo-600` semula direncanakan sebagai warna hover untuk teks tautan, tetapi
6,62:1 berada di bawah ambang AAA 7:1. Ia diturunkan perannya menjadi elemen non-teks. Hover pada
tautan memakai garis bawah dan `indigo-800`, bukan perubahan warna menjadi `indigo-600`.

Angka di tabel ini wajib diverifikasi ulang oleh axe-core di CI sebelum diklaim di presentasi
(TC-A11Y-01). Angka yang belum lewat pengujian otomatis tidak masuk slide.

## 4. Tipografi

| Peran | Typeface | Alasan |
|---|---|---|
| Antarmuka | **Inter** | Tinggi x besar, angka tabular, dan huruf yang mudah dibedakan (I/l/1). Dirancang untuk layar kecil. |
| Narasi katalog | **Lora** | Serif dengan kontras rendah. Dipakai hanya untuk cerita pengrajin, di mana teks panjang dan nada personal. |

Dua typeface, bukan tiga. Lora muncul hanya di satu tempat: blok cerita produk. Kalau ia muncul di
tombol atau navigasi, itu bug.

Skala (rem, basis 16px):

```
display   2.25rem / 1.2   600   hanya judul halaman
heading   1.5rem  / 1.3   600
subhead   1.25rem / 1.4   500
body      1.125rem/ 1.6   400   <- 18px, minimum
small     1rem    / 1.5   400   <- 16px, batas bawah mutlak
```

Tidak ada ukuran di bawah 16px di seluruh produk. Termasuk caption, footnote, dan label input.

## 5. Bentuk, bayangan, spasi

- **Border radius:** `8px` untuk semua permukaan, `4px` untuk input, `999px` hanya untuk badge status.
  Tiga nilai, tidak lebih.
- **Bayangan:** satu nilai saja — `0 1px 3px rgba(46,31,23,0.12)`. Dipakai untuk menandai permukaan
  yang benar-benar terangkat (modal, dropdown). Kartu statis tidak memakai bayangan; ia dipisahkan
  dengan border `1px solid clay-200`.
- **Spasi:** kelipatan 4px. Skala: 4, 8, 12, 16, 24, 32, 48, 64.
- **Glassmorphism, neumorphism, glow: tidak dipakai.** Keduanya menurunkan kontras, dan produk ini
  menargetkan AAA.

## 6. Foto produk adalah pahlawannya

Ini platform untuk menjual kerajinan. Elemen visual paling penting di layar mana pun adalah foto
produk buatan pengrajin — bukan ilustrasi, bukan ikon, bukan header dekoratif.

Aturan:

- Tidak ada ilustrasi stok, tidak ada blob abstrak, tidak ada bentuk 3D mengambang.
- Ikon hanya untuk aksi fungsional, dan selalu berdampingan dengan label teks. Ikon tanpa teks
  dilarang — pengguna kognitif dan screen reader sama-sama dirugikan.
- Foto ditampilkan pada rasio aslinya di dalam kontainer `aspect-[4/5]` dengan `object-contain` dan
  latar `clay-200`. Produk kriya punya proporsi tidak beraturan; memaksa crop persegi memotong
  karyanya.

## 7. Nada tulisan

Bahasa Indonesia sehari-hari. Bukan bahasa korporat, bukan bahasa teknis.

| Jangan | Pakai |
|---|---|
| "Optimalkan potensi bisnis Anda" | "Jual kerajinan Anda ke luar negeri" |
| "Get Started" | "Mulai buat katalog" |
| "Terjadi kesalahan sistem" | "Foto belum berhasil diproses. Foto Anda tetap tersimpan." |
| "Upload berhasil" | "Foto tersimpan" |
| "Empowering artisans through AI" | tidak dipakai sama sekali |

Setiap pesan error menyebut tiga hal: apa yang terjadi, apakah pekerjaan pengguna aman, dan apa
langkah berikutnya. Kode error teknis tidak pernah tampil ke pengrajin; ia dicatat di log untuk
developer.

CTA selalu kata kerja + objek. "Mulai buat katalog", "Rekam cerita", "Terbitkan katalog".
Tidak pernah "Lanjut" atau "Submit" berdiri sendiri tanpa konteks.

## 8. Aksesibilitas sebagai bagian desain, bukan lapisan tambahan

- Fokus keyboard terlihat jelas: outline `3px solid indigo-600` dengan offset `2px`. Tidak pernah
  `outline: none` tanpa pengganti yang lebih terlihat.
- Setiap state interaktif punya tampilan berbeda: default, hover, focus, active, disabled, loading.
  Enam state, bukan tiga.
- Status tidak pernah disampaikan lewat warna saja. Berhasil = ikon centang + teks + warna.
  Gagal = ikon + teks + warna.
- Semua animasi dimatikan di bawah `prefers-reduced-motion: reduce`.
- Urutan fokus mengikuti urutan visual. Tidak ada `tabindex` positif.

## 9. Yang membuat KATAVIS berbeda secara visual

Pembeda yang bisa dilihat juri dalam tiga detik, dan tidak dimiliki platform katalog lain:

1. **Alur satu-langkah-satu-layar.** Layar mana pun hanya menuntut satu keputusan. Ini kebalikan
   dari dashboard UMKM biasa yang menampilkan 12 menu sekaligus.
2. **Cerita pengrajin ditempatkan di atas spesifikasi produk.** Di marketplace lain, deskripsi
   personal disembunyikan di bawah. Di sini ia adalah nilai jual utama produk kriya, jadi ia yang
   pertama dibaca.
3. **Palet dari material asli.** Warna yang dipakai bisa ditunjuk asal-usulnya ke bahan kriya
   Nusantara. Ini bukan tema yang dipilih dari palet generator.

## 10. Larangan yang mengikat

Daftar ini mengikat pada build. Melanggarnya berarti membatalkan klaim anti-slop.

- Gradient ungu–biru di mana pun.
- Bento grid.
- Hero dengan bentuk 3D mengambang atau blob gradien.
- Titik status berkedip yang tidak menandai apa pun.
- Kartu fitur berjajar tiga dengan ikon di atas judul di atas satu kalimat.
- Angka statistik tanpa sumber (R-17: setiap angka wajib punya rujukan).
- Testimoni yang dikarang (R-18).
- Screenshot produk yang dibuat-buat untuk slide.
- Garis aksen berwarna di sisi kiri kartu.
- Jendela terminal palsu sebagai dekorasi.

## 11. Ketika arah ini bertabrakan dengan antislop

Kalau ada elemen dalam dokumen ini yang menabrak aturan antislop, elemen itu disebut namanya,
aturannya disebut nomornya, dan keputusannya dicatat satu baris di `docs/design/overrides.md`.
Tidak ada yang diam-diam dilanggar dan tidak ada yang diam-diam ditimpa.
