# Rencana kesiapan demo KATAVIS — 25 September 2026

## Sasaran malam ini

Demo harus memperlihatkan satu pengrajin membuat katalog dari foto dan cerita, meninjau hasil AI, menerbitkan, lalu membuka tautan pembeli. Keberhasilan build saja tidak cukup. Setiap klaim demo harus didukung uji yang benar-benar dijalankan; layanan AI eksternal dan perangkat bantu fisik dilaporkan terpisah bila tidak dapat diuji.

## Urutan eksekusi

1. **P0 — selamatkan alur isi katalog.** Telusuri input transkrip, antrean pekerjaan teks, penyedia/fallback, penyimpanan konten, dan tampilan review. Reproduksi mengapa foto berhasil tetapi nama, cerita, spesifikasi, caption, atau kata kunci tidak muncul. Perbaiki akar masalah dan beri regresi pada jalur yang gagal.
2. **P0 — kualitas foto.** Telusuri prompt dari pilihan gaya, foto dan cerita sampai Studio Agent. Ganti prompt generik/statis dengan instruksi yang memakai fakta produk yang tersedia, menjaga bentuk asli, dan melarang atribut produk yang tidak diketahui. Pastikan fallback dan opsi prompt manual tetap berfungsi. Uji prompt serta satu pekerjaan nyata jika koneksi layanan tersedia.
3. **P0 — aksesibilitas operasional.** Audit satu alur penuh dengan keyboard dan pemeriksaan axe di layar ponsel: label, urutan fokus, ukuran target 56 px, teks minimal 18 px, status yang diumumkan, alternatif rekaman/transkrip, kesalahan yang dapat dipulihkan, serta `prefers-reduced-motion`. Perbaiki hambatan yang menghentikan penggunaan.
4. **P1 — visual dan navigasi.** Rapikan hierarki, foto produk, tipografi, jarak, aksi utama, dan keadaan kosong/memuat/gagal pada layar masuk, langkah pembuatan, review, terbit, dan katalog publik. Gunakan identitas material kriya, warna/token yang sudah ditetapkan `DESIGN.md`; jangan mengganti token tanpa persetujuan. Gerak hanya menguatkan perubahan status dan harus nonaktif pada reduced motion.
5. **P0 — gladi bersih.** Jalankan alur browser dari awal sampai tautan publik pada viewport Android dan desktop, integrasi Worker/D1/R2, `pnpm run verify`, serta build. Catat kegagalan dan batasi klaim. Siapkan urutan demo dan jalur pemulihan bila layanan AI mati.

## Bukti penerimaan

- Pekerjaan teks menghasilkan dan menyimpan nama, cerita, spesifikasi, caption, dan kata kunci yang dapat ditinjau atau disunting; kegagalan memberi fallback yang jujur.
- Prompt foto memakai konteks produk yang tersedia dan keluaran tidak mengubah identitas kerajinan; foto asli tetap aman.
- Pengguna dapat menyelesaikan langkah utama dengan keyboard dan sentuhan besar; status penting terbaca pembaca layar dan layout tetap dapat digunakan pada layar kecil/zoom.
- Tautan katalog terbit membuka halaman pembeli, bukan JSON API; ekspor manual jelas bagi pengguna.
- Hasil uji nyata, batas yang belum diuji, dan langkah demo ditulis setelah implementasi.

## Batas perubahan

Pertahankan perubahan lokal yang sudah ada. Jangan mengubah kontrak API, skema D1, dependensi, kode galat, aturan lint, atau token `DESIGN.md` tanpa persetujuan khusus. Kunci API tidak dimasukkan ke repositori atau log.

## Hasil eksekusi yang terverifikasi

- Alur browser Android dengan Worker, D1/R2, Groq, dan Gemini Web nyata lulus dari masuk OTP lokal, unggah foto, tulis cerita, buat konten/foto, tinjau caption dan kata kunci, terbitkan, sampai membuka halaman pembeli (`e2e/live-demo.spec.ts`). Jalur ini memakai pilihan **tulis cerita**, sehingga tidak membuktikan mikrofon dan ASR fisik.
- Gladi bersih tambahan dengan berkas suara WAV sintetis juga lulus dari masuk, unggah foto, unggah suara, transkripsi Groq nyata, tinjau transkrip, pembuatan katalog, terbit, sampai halaman pembeli. Uji ini dijalankan lewat browser Chromium lokal; berkas suara dibuat dengan penyintesis suara Windows, sehingga belum membuktikan mikrofon atau suara pengrajin sebenarnya.
- Pekerjaan Gemini Web nyata menghasilkan foto PNG baru; foto asli tetap ada dan hanya foto studio menjadi utama. Pekerjaan teks nyata menghasilkan nama, cerita, empat spesifikasi, caption, dan kata kunci. Hasil kualitas visual pada foto produk sungguhan tetap harus dinilai manusia.
- `pnpm run verify`, integrasi Worker/D1/R2, build, serta browser Android dan desktop telah dijalankan. Lihat hasil perintah terbaru pada catatan sesi/terminal; pengujian katalog publik live dengan Worker juga lulus.
- Ketika gambar gagal tetapi teks selesai, alur menawarkan **Lanjut dengan foto asli**. Foto asli pertama otomatis menjadi utama. Pekerjaan gagal dapat diulang tanpa membuat ulang tahap yang sudah sukses.
- Pekerjaan ASR dari langkah rekaman sebelumnya semula membuat halaman proses melewatkan permintaan teks/foto. Sekarang hanya pekerjaan teks/foto yang menentukan apakah katalog sudah diminta, serta kemajuan dan status di layar proses. Regresi pada ASR sukses dan ASR gagal yang diganti cerita tertulis lulus pada Android dan desktop. Pengujian ulang layar pembuatan dan fallback: 52 lulus, 6 dilewati karena memerlukan Worker langsung; `pnpm run verify`: 692 unit test, lint, typecheck, kontras, dan rujukan lulus; `pnpm run test:integration`: 103 lulus (ada peringatan penutupan proses Vitest yang lambat); build produksi lulus.
- Tautan yang diterbitkan membuka katalog publik KATAVIS. Tombol paket siap posting mengunduh foto dan menyalin caption untuk dikirim manual ke marketplace/media sosial; aplikasi tidak memposting ke akun pihak ketiga.

## Sisa risiko sebelum panggung

1. Uji satu produk fisik dan satu rekaman mikrofon nyata pada perangkat yang akan dibawa. ASR dari berkas suara sintetis sudah lulus, tetapi suara pengrajin, izin mikrofon, dan kualitas prompt gambar dari foto produk asli belum dibuktikan.
2. Uji TalkBack/pembaca layar dan Voice Access fisik bersama pengguna sasaran bila tersedia. Pemeriksaan axe, keyboard, zoom, target 56 px, dan reduced motion otomatis lulus, tetapi tidak menggantikan uji perangkat bantu nyata. Voice Navigation bawaan aplikasi belum tersedia; pilihannya dinonaktifkan secara jujur.
3. Tentukan apakah demo memakai laptop lokal atau URL yang dapat diakses ponsel juri. Penerapan publik dan jaringan ponsel tidak diuji di sesi ini. Audio narasi pada katalog pembeli juga belum tersedia; teks dan subtitle berjalan.
4. Kunci NeedMCP yang sempat dibagikan dalam percakapan perlu dirotasi. Kunci itu tidak ditaruh dalam kode atau dokumen proyek.
5. Pemilihan berkas audio saat ini menganggap durasinya 30 detik tanpa membaca metadata. Batas 10–60 detik diuji pada perekaman mikrofon, tetapi belum ditegakkan untuk berkas yang dipilih. Gunakan berkas demo berdurasi sesuai batas; validasi durasi berkas dan sisi server masih pekerjaan lanjutan.
