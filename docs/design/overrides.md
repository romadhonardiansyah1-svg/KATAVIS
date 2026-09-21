# Design Overrides

Dirujuk oleh `DESIGN.md` bagian 11.

Bila arah desain di `DESIGN.md` menabrak aturan antislop, benturannya dicatat di sini: elemen apa,
aturan nomor berapa, keputusan pemilik produk, dan tanggalnya. Tidak ada yang diam-diam dilanggar
dan tidak ada yang diam-diam ditimpa.

Aturan R-37 hanya mewajibkan pertanyaan untuk **pola slop yang bernama**, bukan untuk pilihan gaya
yang memang hak pemilik produk. Palet berani atau typeface tidak lazim adalah identitas, bukan slop.

| Tanggal | Elemen | Aturan | Keputusan | Alasan |
|---|---|---|---|---|
| — | — | — | — | Belum ada benturan tercatat |

## Pengecualian sadar terhadap skala sendiri

Berbeda dari tabel di atas, bagian ini mencatat penyimpangan dari aturan internal KATAVIS, bukan
dari antislop.

| Item | Aturan yang dilanggar | Alasan |
|---|---|---|
| `--touch-record: 96px` | Skala spasi 4–64px di `DESIGN.md` bagian 5 | Tombol rekam adalah satu-satunya elemen interaktif di layarnya dan harus ditemukan tanpa melihat presisi |
| Katalog publik RHYTHM 2 | Dial RHYTHM 1 di `DESIGN.md` bagian 2 | Audiensnya pembeli, bukan pengrajin; kebutuhan aksesibilitasnya berbeda. Sudah dicatat sebagai pengecualian tunggal di `DESIGN.md`. |

## Pertanyaan terbuka yang belum diputuskan

Bukan keputusan, melainkan benturan yang ditemukan saat membangun F3 dan **belum** diputuskan
pemilik produk. Tidak satu pun diambil sendiri, karena `AGENTS.md` menuntut bertanya alih-alih
menebak.

| # | Pertanyaan | Kenapa tidak diputuskan sendiri | Keadaan sekarang |
|---|---|---|---|
| OV-1 | Apakah larangan "garis aksen berwarna di sisi kiri kartu" (`DESIGN.md` baris 202) berlaku juga untuk penanda status aktif di sisi muka **baris daftar**, atau hanya untuk kartu? | Larangannya tertulis tanpa syarat. Menafsirkannya sendiri berarti memutuskan cakupan larangan yang menjadi klaim anti-slop lomba, dan itu keputusan pemilik produk. | Dihindari sepenuhnya. Kalimat subtitle yang aktif ditandai latar, bobot garis penuh, dan penanda teks — tanpa garis aksen berwarna. |
| OV-2 | Pada mode tanpa suara, apakah durasi baca yang diperkirakan (0,014 karakter/ms, lihat `components/catalog/timeline.ts`) perlu ditinjau kecepatan baca pengguna kognitif? | Menyentuh langsung profil Kognitif, dan belum ada pengukuran. Angkanya saat ini hanya penjaga agar subtitle tetap bergerak saat suara tidak ada. | Dipakai apa adanya, dengan `endMs` sebagai lantai bila naskah sudah punya waktu. |
| OV-3 | Apakah dua syarat model yang wajib atas `TalkingCatalog` (semuanya opsional) dapat dihilangkan begitu prop pertama yang wajib ditambahkan? | Menjadikannya wajib sekarang menambah permukaan API tanpa konsumen nyata, sementara `AGENTS.md` melarang abstraksi spekulatif. | Dibiarkan; komponennya belum dirakit ke halaman, dan `app/catalog/[slug]/page.tsx` belum dijalankan. |

