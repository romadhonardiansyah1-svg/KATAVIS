# Rencana implementasi: audit dan pemulihan alur utama

## Tujuan dan batas

Pastikan pengrajin dapat memulai draf, menambahkan foto, merekam atau meninjau transkrip, memproses konten, meninjau hasil, menerbitkan katalog, lalu membuka halaman publik. Utamakan penghambat alur ini dan pertahankan perubahan lokal yang sudah ada. Kontrak API, skema basis data, dependensi, kode galat, dan token desain tidak diubah tanpa persetujuan.

## Tahap kerja

1. **Baseline dan reproduksi.** Catat status Git dan perubahan lokal; jalankan pemeriksaan yang relevan; jalankan pengujian alur utama di peramban serta integrasi Worker. Simpan kegagalan yang dapat diulang beserta langkah dan keluaran nyata.
2. **Lacak akar masalah.** Ikuti data dari UI ke kontrak API, router Worker, D1/R2, dan pekerjaan AI. Bedakan cacat produk dari cacat fixture pengujian atau layanan eksternal yang tidak tersedia.
3. **Perbaikan bertahap.** Untuk setiap penghambat prioritas tinggi: tambahkan reproduksi/regresi yang bermakna, buat perubahan terkecil, lalu ulangi skenario yang sama. Jangan memperluas perubahan ke fitur yang tidak terkait.
4. **Verifikasi alur penuh.** Uji dari awal sampai katalog publik pada viewport utama; jalankan pengujian integrasi yang memakai Worker/D1/R2 nyata dan jalur kegagalan utama. Jalankan `pnpm run verify`, pemeriksaan build, dan tinjau diff akhir.
5. **Laporan.** Pisahkan masalah yang terverifikasi selesai, yang masih gagal, dan yang belum dapat diuji (misalnya penyedia AI eksternal atau perangkat fisik). Sertakan perintah serta hasilnya.

## Kriteria selesai

Alur utama lulus uji peramban dari awal sampai terbit dan halaman publik dapat dibuka; perilaku server yang terkait lulus uji integrasi; `pnpm run verify` lulus; tidak ada perubahan di luar lingkup tanpa alasan. Jika suatu tahap belum dapat dibuktikan, laporkan statusnya sebagai belum terverifikasi.
