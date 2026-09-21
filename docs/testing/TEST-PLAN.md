# Test Plan KATAVIS

**Versi** 1.0 · **Tanggal** 15 September 2026
**Cakupan** unit, integrasi, E2E, aksesibilitas, performa, keamanan

---

## 1. Dasar strategi

Pengujian di sini melayani satu tujuan terukur: **demo final tidak boleh gagal**, dan setiap klaim
yang disampaikan ke juri harus punya bukti yang bisa ditunjukkan.

Konsekuensinya, prioritas pengujian tidak merata. Ia mengikuti risiko:

| Area | Kalau gagal saat demo | Prioritas |
|---|---|---|
| Alur enam langkah membuat katalog | Demo berhenti di panggung | Tertinggi |
| Rantai fallback penyedia AI | Demo menggantung tanpa hasil | Tertinggi |
| Aksesibilitas | Klaim inti produk runtuh | Tertinggi |
| Pencabutan akses pendamping | Cacat keamanan yang terlihat | Tinggi |
| Batas 50 kueri D1 | Galat runtime yang sulit dilacak | Tinggi |
| Ekspor PDF dan feed | Fitur pelengkap gagal | Sedang |
| Tutorial interaktif | Tidak terlihat juri | Rendah |

## 2. Perkakas

| Lapis | Perkakas | Alasan |
|---|---|---|
| Unit | Vitest | Cepat, satu konfigurasi dengan Vite yang dipakai build |
| Integrasi Worker | `@cloudflare/vitest-pool-workers` | Menjalankan kode di runtime `workerd` asli, bukan tiruan Node |
| E2E | Playwright | Multi-peramban, punya integrasi axe, merekam jejak saat gagal |
| Aksesibilitas | `@axe-core/playwright` | Pengujian otomatis di dalam E2E yang sama |
| Skema | Zod | Validasi di batas aplikasi, dipakai sekaligus di pengujian |
| Kontras | `tools/contrast.py` | Memverifikasi angka di `DESIGN.md` |
| Performa | Lighthouse CI | Mengukur klaim di ADR-007 |
| Keamanan | `npm audit`, semgrep | Dependensi dan pola berisiko |
| Mutasi | Stryker | Hanya untuk modul `rbac` dan `jobs` |

Pengujian integrasi Worker memakai runtime `workerd` yang sebenarnya. Menirukan D1 dengan objek
palsu akan menyembunyikan justru masalah yang paling mungkin terjadi: batas 50 kueri per invocation.

## 3. Lapis 1 — Unit

Sasaran: logika murni tanpa I/O. Cepat, dijalankan setiap simpan berkas.

### Modul `rbac`

| ID | Kasus | Harapan |
|---|---|---|
| TC-U-RBAC-01 | Pengrajin mengakses produknya sendiri | Diizinkan |
| TC-U-RBAC-02 | Pengrajin mengakses produk pengrajin lain | Ditolak |
| TC-U-RBAC-03 | Pendamping aktif dengan izin `edit_draft` menyunting draf | Diizinkan |
| TC-U-RBAC-04 | Pendamping aktif tanpa izin `publish` menerbitkan | Ditolak |
| TC-U-RBAC-05 | Pendamping berstatus `revoked` mengakses | Ditolak |
| TC-U-RBAC-06 | Pendamping dengan `expires_at` terlampaui | Ditolak |
| TC-U-RBAC-07 | Pendamping menghapus produk | Ditolak — aksi merusak tidak pernah didelegasikan |
| TC-U-RBAC-08 | Admin meninjau produk berstatus `review` | Diizinkan |
| TC-U-RBAC-09 | Admin menyunting isi katalog pengrajin | Ditolak — admin mengurasi, bukan menulis ulang |
| TC-U-RBAC-10 | Pembeli mengakses produk `draft` | Ditolak |
| TC-U-RBAC-11 | Pembeli mengakses produk `published` | Diizinkan |
| TC-U-RBAC-12 | Peran tidak dikenal | Ditolak — default menolak, bukan mengizinkan |
| TC-U-RBAC-13 | Undangan pendamping berumur lebih dari 24 jam | Ditolak saat hendak diterima — berbeda dari TC-U-RBAC-06 yang menguji tautan aktif |

TC-U-RBAC-12 menguji sifat paling penting: fungsi izin harus menolak secara bawaan. Pemeriksaan
yang mengizinkan saat peran tidak dikenali adalah lubang keamanan.

### Modul `jobs`

| ID | Kasus | Harapan |
|---|---|---|
| TC-U-JOB-01 | Penyedia utama berhasil | Hasil dari utama, tanpa fallback |
| TC-U-JOB-02 | Penyedia utama melempar galat | Fallback dipanggil |
| TC-U-JOB-03 | Penyedia utama melewati 45 detik | Dibatalkan, fallback dipanggil |
| TC-U-JOB-04 | Utama dan fallback gagal | Lapis cache dipanggil |
| TC-U-JOB-05 | Ketiganya gagal | Galat terstruktur, bukan lemparan mentah |
| TC-U-JOB-06 | Pemetaan `error_code` ke pesan pengguna | Tidak ada istilah teknis dalam keluaran |
| TC-U-JOB-07 | Penyedia mengembalikan hasil setelah dibatalkan | Hasil diabaikan, tanpa kebocoran |
| TC-U-JOB-08 | Transisi status `queued`→`running`→`succeeded` | Urutan sah |
| TC-U-JOB-09 | Transisi `succeeded`→`running` | Ditolak |
| TC-U-JOB-10 | Kegagalan bahasa Jepang saat ID dan EN berhasil | Dua bahasa tersimpan, satu ditandai gagal |

TC-U-JOB-10 memverifikasi kriteria penerimaan F1 di PRD: kegagalan satu bahasa tidak menggagalkan
yang lain. Ini alasan `product_content` dipisah per bahasa.

### Modul `catalog` dan validasi

| ID | Kasus | Harapan |
|---|---|---|
| TC-U-CAT-01 | Durasi audio 9 detik | Ditolak dengan pesan yang menjelaskan batas |
| TC-U-CAT-02 | Durasi audio 61 detik | Ditolak dengan pesan yang menjelaskan batas |
| TC-U-CAT-03 | Durasi audio 30 detik | Diterima |
| TC-U-CAT-04 | Berkas 11 MB | Ditolak |
| TC-U-CAT-05 | MIME `image/svg+xml` | Ditolak — SVG dapat memuat skrip |
| TC-U-CAT-06 | Berkas berekstensi `.jpg` dengan isi HTML | Ditolak berdasar magic bytes, bukan ekstensi |
| TC-U-CAT-07 | Pembuatan slug dari nama berbahasa Indonesia | ASCII, unik, tanpa spasi |
| TC-U-CAT-08 | Tabrakan slug | Imbuhan pembeda ditambahkan |

TC-U-CAT-06 menguji kebiasaan yang sering terlewat: validasi berdasar ekstensi dapat ditembus.

### Cakupan

| Modul | Ambang baris | Alasan |
|---|---|---|
| `rbac` | 95% | Keamanan |
| `jobs` | 90% | Jalur kritis demo |
| `catalog`, `media` | 80% | |
| `export` | 70% | |
| Keseluruhan | 80% | Gerbang CI |

Skor mutasi Stryker minimal 70% untuk `rbac` dan `jobs`. Cakupan baris saja dapat dicapai tanpa
menguji apa pun secara bermakna; mutasi memeriksa apakah pengujiannya benar-benar menangkap galat.

## 4. Lapis 2 — Integrasi

Dijalankan di `workerd` dengan D1 dan R2 lokal dari Miniflare.

| ID | Kasus | Harapan |
|---|---|---|
| TC-I-01 | Buat produk lalu baca kembali | Data utuh |
| TC-I-02 | Hapus produk | Baris `product_content`, `media_assets`, `jobs` ikut terhapus |
| TC-I-03 | Dua permintaan menyunting draf yang sama bersamaan | Tidak ada penulisan hilang |
| TC-I-04 | Pencabutan akses pendamping | Sesi aktif pendamping langsung ditolak, bukan hanya status berubah |
| TC-I-05 | Unggah media lewat URL bertanda tangan | Objek tersimpan, kunci tercatat |
| TC-I-06 | URL bertanda tangan setelah kedaluwarsa | Ditolak |
| TC-I-07 | Akses R2 tanpa tanda tangan | Ditolak |
| TC-I-08 | Pekerjaan masuk antrian dan dikonsumsi | Status berubah, hasil tersimpan |
| TC-I-09 | Aksi pendamping tercatat di `activity_log` | `on_behalf_of` terisi |
| TC-I-10 | Aksi pengrajin sendiri | `on_behalf_of` kosong |
| TC-I-11 | Rekaman mentah setelah transkripsi berhasil | Objek R2 terhapus kecuali pengguna memilih menyimpan |
| TC-I-12 | Migrasi D1 dijalankan dua kali | Idempoten |
| TC-I-13 | Profil Accessibility Mode disimpan lalu sesi dimulai ulang | Pilihan profil pulih persis, termasuk gabungan profil |
| TC-I-14 | Merekam tanpa persetujuan pengiriman audio tersimpan | Permintaan ditolak di server |
| TC-I-15 | Menerbitkan tanpa persetujuan publikasi | Ditolak; status tetap `review` |

TC-I-04 adalah pengujian keamanan paling penting di lapis ini. `Fitur pendukung.pdf` halaman 5
menyatakan "Pengrajin dapat mencabut akses kapan saja". Pencabutan yang hanya mengubah baris basis
data sementara token lama masih sah bukanlah pencabutan.

## 5. Lapis 3 — E2E

Playwright, Chromium dan WebKit, pada viewport 360×800 (Android kelas menengah) dan 1280×800.

### Alur utama

| ID | Alur | Langkah kunci |
|---|---|---|
| TC-E2E-01 | Membuat katalog dari awal sampai terbit | Foto → rekam → tinjau transkrip → proses → periksa → terbitkan |
| TC-E2E-02 | Alur yang sama **tanpa menyentuh papan ketik untuk mengetik** | Membuktikan tujuan G1 di PRD |
| TC-E2E-03 | Alur yang sama **hanya dengan papan ketik**, tanpa tetikus | Tab, Enter, Escape |
| TC-E2E-04 | Pendamping menyunting draf pengrajin | Perubahan tersimpan, tercatat atas nama siapa |
| TC-E2E-05 | Pengrajin mencabut akses pendamping | Pendamping langsung kehilangan akses tanpa menyegarkan halaman |
| TC-E2E-06 | Pembeli membuka katalog publik | Talking-Catalog berjalan, subtitle tampil |
| TC-E2E-07 | Ekspor PDF | Berkas terunduh, memiliki tag struktur |
| TC-E2E-08 | Ekspor feed CSV | Kolom sesuai format Google Merchant Center |
| TC-E2E-09 | **Katalog terbit dalam lima bahasa** | ID, EN, JA, ZH, AR masing-masing dirender, terbaca, tanpa teks kosong atau placeholder. Mengukur G5 di PRD. |
| TC-E2E-23 | Auto Save pada interval 5 detik | Setelah mengetik lalu menunggu 6 detik tanpa aksi lain, draf tersimpan. Diverifikasi dari penanda waktu, bukan dari indikator UI. |
| TC-E2E-24 | Alur persetujuan sebelum terbit | Terbit tanpa mencentang persetujuan tidak mungkin; teks persetujuan terbaca screen reader |
| TC-E2E-25 | Guided Navigation enam langkah | Setiap langkah punya tepat satu aksi utama; mundur tidak kehilangan data; lompat langkah tidak mungkin |
| TC-E2E-26 | Notifikasi multimodal | Satu peristiwa memicu visual + audio + getar; mematikan salah satu kanal tidak menghilangkan informasi |

### Alur kegagalan — inilah yang menyelamatkan demo

| ID | Kondisi | Harapan |
|---|---|---|
| TC-E2E-10 | Studio Agent mati | Fallback ke Workers AI, pengguna tetap mendapat gambar |
| TC-E2E-11 | Studio Agent menggantung melewati 45 detik | Dibatalkan, fallback jalan, tidak ada layar membeku |
| TC-E2E-12 | Groq mengembalikan 429 | Fallback ke Workers AI Whisper |
| TC-E2E-13 | Seluruh penyedia gambar gagal | Pesan ramah + foto asli dipertahankan + tombol coba lagi |
| TC-E2E-14 | Jaringan putus saat merekam | Draf tersimpan, dapat dilanjutkan setelah tersambung |
| TC-E2E-15 | Jaringan putus saat pemrosesan | Progres dipulihkan, pekerjaan tidak hilang |
| TC-E2E-16 | Tab ditutup di tengah proses | Draf tersimpan, muncul saat dibuka lagi |
| TC-E2E-17 | ASR menghasilkan transkrip kacau | Pengrajin dapat mengoreksi di layar tinjau |
| TC-E2E-18 | Berkas 15 MB diunggah | Ditolak dengan pesan yang menjelaskan batas |

TC-E2E-13 memverifikasi kriteria di PRD: foto asli tidak pernah hilang. Kegagalan generate tidak
boleh menghapus karya pengguna.

### Pemeriksaan anti-slop pada pesan galat

| ID | Pemeriksaan |
|---|---|
| TC-E2E-20 | Tidak ada teks "Error", "Failed", "500", "null", "undefined" yang terlihat pengguna |
| TC-E2E-21 | Setiap pesan galat memuat langkah berikutnya |
| TC-E2E-22 | Setiap pesan galat menyatakan apakah pekerjaan pengguna aman |

Ini menegakkan ketentuan `Fitur pendukung.pdf` halaman 6–7 secara otomatis, bukan lewat tinjauan
manual yang bisa terlewat.

## 6. Lapis 4 — Aksesibilitas

Bagian ini menentukan apakah klaim inti produk benar. Ia tidak opsional.

### Otomatis

| ID | Pemeriksaan | Gerbang |
|---|---|---|
| TC-A11Y-01 | axe-core di seluruh rute | 0 pelanggaran serius/kritis |
| TC-A11Y-02 | Kontras seluruh pasangan token | Sesuai tabel `DESIGN.md`, dijalankan `tools/contrast.py` |
| TC-A11Y-03 | Ukuran target sentuh | Semua ≥56×56px |
| TC-A11Y-04 | Setiap gambar punya alt | Alt kosong hanya untuk gambar dekoratif |
| TC-A11Y-05 | Setiap input punya label terkait | Placeholder saja tidak dihitung |
| TC-A11Y-06 | Urutan heading | Tidak ada tingkat yang terlompati |
| TC-A11Y-07 | Fokus terlihat di seluruh elemen interaktif | Tidak ada `outline: none` tanpa pengganti |
| TC-A11Y-08 | `prefers-reduced-motion` dihormati | Seluruh animasi berhenti |
| TC-A11Y-09 | Halaman berfungsi pada zoom 200% | Tidak ada gulir horizontal |
| TC-A11Y-10 | Halaman berfungsi pada zoom 400% | Konten mengalir, tidak terpotong |
| TC-A11Y-11 | Tombol Accessibility Mode ada di seluruh rute | Ditemukan lewat peran ARIA di setiap halaman, bukan lewat axe-core |
| TC-A11Y-12 | Tombol TTS pada layar tinjau transkrip | Menekan tombol membacakan transkrip; berbeda dari screen reader pengguna |

### Manual — tidak dapat diotomatiskan

| ID | Pemeriksaan | Cara |
|---|---|---|
| TC-A11Y-20 | NVDA membaca seluruh alur | Windows, alur enam langkah dari awal |
| TC-A11Y-21 | **TalkBack pada perangkat Android fisik** | Wajib. ADR-002 mencatat ini sebagai kerugian TWA yang harus diverifikasi. |
| TC-A11Y-22 | Navigasi papan ketik penuh | Tanpa tetikus sama sekali |
| TC-A11Y-23 | Voice Navigation mengenali enam perintah | "buka produk saya", "buat katalog", "lanjut", "kembali", "simpan", "terbitkan" |
| TC-A11Y-24 | Subtitle tersinkron | Toleransi ±200 ms, diukur bingkai demi bingkai |
| TC-A11Y-25 | Setiap profil Accessibility Mode | Lima profil diuji terpisah dan digabung |
| TC-A11Y-26 | Katalog dapat dipahami tanpa suara | Matikan audio, seluruh informasi tetap tersampaikan |
| TC-A11Y-27 | Katalog dapat dipahami tanpa gambar | Matikan gambar, seluruh informasi tetap tersampaikan |
| TC-A11Y-28 | Subtitle adalah teks nyata | Pilih dan salin teks subtitle; bila tidak dapat disalin, ia piksel dan uji gagal |
| TC-A11Y-29 | Profil Motorik pada layar rekam | Batas 60 detik tetap berlaku sebagai batas teknis, tetapi tidak ada batas waktu interaksi lain |

TC-A11Y-21 adalah pengujian yang tidak boleh ditunda. ADR-002 memilih TWA dengan mengakui TalkBack
pada WebView lebih lemah daripada komponen native. Klaim itu wajib diuji pada perangkat nyata,
bukan diasumsikan aman.

### Batas jujur pengujian otomatis

axe-core menangkap sekitar sepertiga masalah aksesibilitas. Ia tidak dapat menilai apakah teks
alternatif bermakna, apakah urutan fokus masuk akal, atau apakah bahasa cukup sederhana bagi
pengguna kognitif.

Karena itu klaim untuk presentasi dinyatakan sebagai: **"0 pelanggaran axe-core serius, ditambah
verifikasi manual dengan NVDA dan TalkBack"** — bukan "sepenuhnya aksesibel". Klaim kedua tidak
dapat dibuktikan siapa pun.

## 7. Lapis 5 — Performa

Memverifikasi klaim yang didefinisikan ulang di ADR-007.

| ID | Metrik | Sasaran | Alat |
|---|---|---|---|
| TC-PERF-01 | INP | < 200 ms | Lighthouse CI |
| TC-PERF-02 | Tap sampai umpan balik visual | < 100 ms | Penanda performa peramban |
| TC-PERF-03 | Navigasi antar langkah | < 300 ms | Penanda navigasi |
| TC-PERF-04 | **Kueri D1 per invocation** | **< 25** | Penghitung khusus |
| TC-PERF-05 | LCP katalog publik pada 4G tersimulasi | < 2,5 detik | Lighthouse dengan throttling |
| TC-PERF-06 | CLS | < 0,1 | Lighthouse |
| TC-PERF-07 | Ukuran bundel JS awal | < 200 KB terkompresi | Analisis bundel |
| TC-PERF-08 | Waktu total satu katalog, p50 | < 3 menit | Timestamp `jobs` |
| TC-PERF-09 | Waktu total satu katalog, p95 | < 5 menit | Timestamp `jobs` |

**TC-PERF-04 adalah yang paling penting dan paling mudah terlewat.** D1 pada paket gratis hanya
mengizinkan **50 kueri per invocation Worker**, dibanding 1000 pada paket berbayar. Ambang pengujian
ditetapkan 25 agar ada ruang aman. Satu pola N+1 di dalam perulangan akan menembusnya, dan galatnya
hanya muncul di produksi.

Pengujian ini menghitung kueri nyata, bukan mengandalkan tinjauan kode.

## 8. Lapis 6 — Keamanan

| ID | Pemeriksaan | Harapan |
|---|---|---|
| TC-SEC-01 | Akses endpoint tanpa token | 401 |
| TC-SEC-02 | Token kedaluwarsa | 401 |
| TC-SEC-03 | Token dirusak tanda tangannya | 401 |
| TC-SEC-04 | Token pengguna A mengakses data pengguna B | 403 |
| TC-SEC-05 | Manipulasi peran di sisi klien | Diabaikan — otorisasi hanya di server |
| TC-SEC-06 | Injeksi SQL pada seluruh parameter | Tidak ada eksekusi; kueri berparameter |
| TC-SEC-07 | XSS pada nama produk dan cerita | Ter-escape saat dirender |
| TC-SEC-08 | Muatan XSS dalam teks alternatif | Ter-escape |
| TC-SEC-09 | Unggah SVG berisi skrip | Ditolak pada validasi |
| TC-SEC-10 | Path traversal pada kunci R2 | Ditolak |
| TC-SEC-11 | URL bertanda tangan dipakai ulang setelah kedaluwarsa | Ditolak |
| TC-SEC-12 | Pembatasan laju permintaan OTP | Dibatasi per nomor dan per IP |
| TC-SEC-13 | Tebak PIN berulang | Dikunci setelah 5 percobaan gagal |
| TC-SEC-14 | Enumerasi nomor HP lewat OTP | Respons seragam untuk nomor terdaftar dan tidak |
| TC-SEC-15 | Undangan pendamping dipakai dua kali | Ditolak pada pemakaian kedua |
| TC-SEC-16 | Token pendamping setelah pencabutan | Ditolak seketika |
| TC-SEC-17 | Rahasia dalam repositori | `gitleaks` tidak menemukan apa pun |
| TC-SEC-18 | Dependensi rentan | `npm audit` tanpa temuan tinggi/kritis |
| TC-SEC-19 | Header keamanan | CSP, X-Content-Type-Options, Referrer-Policy terpasang |
| TC-SEC-20 | CORS | Hanya asal yang diizinkan |
| TC-SEC-21 | Refresh token setelah 30 hari tidak aktif | Ditolak — menguji kebijakan sesi di PRD bagian 6 |

TC-SEC-14 layak diperhatikan: respons yang berbeda untuk nomor terdaftar dan tidak terdaftar
memungkinkan penyerang memetakan pengguna. Untuk platform yang melayani kelompok rentan, ini bukan
masalah kecil.

## 9. Pengujian khusus Studio Agent

Komponen ini paling rapuh menurut ADR-004, jadi ia mendapat perlakuan tersendiri.

| ID | Kasus | Harapan |
|---|---|---|
| TC-SA-01 | Pemeriksaan kesehatan saat mulai | Selector diverifikasi; bila gagal, agen mendaftar tidak sehat |
| TC-SA-02 | Agen tidak sehat | Pekerjaan langsung ke Workers AI tanpa menunggu 45 detik |
| TC-SA-03 | Selector pecah di tengah pekerjaan | Gagal cepat, tidak menggantung |
| TC-SA-04 | Sesi Chrome kehilangan status login | Terdeteksi, agen mendaftar tidak sehat, peringatan dicatat |
| TC-SA-05 | Dua pekerjaan bersamaan | Diantrikan, bukan dijalankan paralel di satu peramban |
| TC-SA-06 | Agen dimatikan di tengah pekerjaan | Pekerjaan kembali ke antrian, tidak hilang |
| TC-SA-07 | Gambar hasil tidak mengubah bentuk produk | Perbandingan perseptual dengan foto asli |

TC-SA-07 menegakkan kriteria penerimaan F2 di PRD: produk tidak boleh berubah bentuk, warna, atau
tekstur. Model yang mengubah produk berarti berbohong tentang barang yang dijual. Ini kriteria
gagal/lolos.

## 10. Latihan demo sebagai pengujian

Demo adalah artefak yang diuji, bukan sekadar presentasi.

| ID | Latihan | Frekuensi |
|---|---|---|
| TC-DEMO-01 | Alur penuh dari mesin bersih | Mingguan sejak Minggu 5 |
| TC-DEMO-02 | Alur penuh dengan WiFi dimatikan di tengah | Mingguan sejak Minggu 6 |
| TC-DEMO-03 | Alur penuh dengan Studio Agent sengaja dimatikan | Mingguan sejak Minggu 6 |
| TC-DEMO-04 | Alur penuh dalam batas waktu presentasi | Harian pada minggu terakhir |
| TC-DEMO-05 | Pemulihan setelah kegagalan di tengah demo | Minimal 3 kali |
| TC-DEMO-06 | Juri membuka katalog dari perangkat sendiri | Mingguan sejak Minggu 7 |

TC-DEMO-05 melatih hal yang paling sering diabaikan: apa yang dikatakan dan dilakukan presenter
ketika sesuatu gagal di depan juri. Kegagalan yang ditangani tenang lebih baik daripada demo mulus
yang tidak pernah diuji ketahanannya.

## 11. Gerbang CI

```
Pada setiap commit:
  lint + typecheck          harus lolos
  unit                      harus lolos, cakupan ≥80%
  batas impor antar modul   harus lolos (ADR-001)

Pada setiap pull request:
  integrasi                 harus lolos
  E2E jalur utama           harus lolos
  axe-core                  0 pelanggaran serius/kritis
  tools/contrast.py         seluruh pasangan sesuai tabel
  npm audit                 tanpa temuan tinggi/kritis
  gitleaks                  tanpa temuan

Mingguan:
  E2E lengkap termasuk alur kegagalan
  Lighthouse CI
  Stryker pada rbac dan jobs
  semgrep
```

## 12. Data uji

Semua data uji memakai produk kriya nyata dengan foto nyata. Tidak ada teks contoh atau gambar
pengganti abu-abu.

Alasannya bukan estetika: pipeline ini memproses foto dan suara, dan masukan palsu tidak akan
mengungkap masalah yang muncul pada masukan nyata. Foto gelap berlatar berantakan — persis kondisi
yang digambarkan proposal bagian 1.1 — adalah kasus uji, bukan kasus tepi.

Rekaman suara uji mencakup:
- Bahasa Indonesia baku
- Bahasa Indonesia beraksen Jawa
- Bahasa Indonesia beraksen Sunda
- Rekaman dengan derau latar
- Rekaman pelan atau tidak jelas

Tiga yang terakhir diperkirakan akan gagal sebagian. Itu justru yang diuji: apakah layar tinjau
transkrip (ADR-008) benar-benar menyelamatkan keadaan.

## 13. Yang secara sadar tidak diuji

Kejujuran soal batas cakupan sama pentingnya dengan cakupan itu sendiri.

| Tidak diuji | Alasan |
|---|---|
| Beban di atas 50 pengguna bersamaan | Tidak ada pengguna sebanyak itu sebelum final. Menguji beban yang tidak akan terjadi adalah waktu yang terbuang. |
| Kompatibilitas iOS Safari | Target adalah Android. Diuji sebatas tidak rusak parah. |
| Peramban lama | PWA menuntut peramban modern. |
| Kualitas keluaran LLM secara otomatis | Tidak ada metrik otomatis yang bermakna untuk kualitas copywriting. Dinilai manusia. |
| Akurasi WER ASR secara otomatis | Tidak ada korpus Bahasa Indonesia berlabel yang tersedia. Dinilai manual dari rekaman uji. |

## 14. Kriteria kelulusan sebelum final

Build dinyatakan siap bila seluruh baris berikut terpenuhi:

- [ ] Seluruh pengujian unit lolos, cakupan ≥80%
- [ ] **Skor mutasi `rbac` dan `jobs` ≥70%**
- [ ] Seluruh pengujian integrasi lolos
- [ ] TC-E2E-01 sampai TC-E2E-09 lolos
- [ ] Seluruh alur kegagalan TC-E2E-10 sampai TC-E2E-18 lolos
- [ ] **TC-E2E-20 sampai TC-E2E-22 lolos** (anti-slop pesan galat)
- [ ] **TC-E2E-23 sampai TC-E2E-26 lolos** (auto save, persetujuan, navigasi, notifikasi)
- [ ] 0 pelanggaran axe-core serius/kritis
- [ ] TC-A11Y-21 (TalkBack perangkat fisik) lolos
- [ ] **TC-I-14 dan TC-I-15 (persetujuan) lolos**
- [ ] TC-PERF-04 (kueri D1 < 25) lolos
- [ ] Seluruh pengujian keamanan lolos
- [ ] TC-DEMO-01 sampai TC-DEMO-04 lolos tiga kali berturut-turut
- [ ] Setiap angka pada slide presentasi punya sumber yang dapat ditunjuk
- [ ] Skrip pemulihan kegagalan saat demo sudah dilatih
