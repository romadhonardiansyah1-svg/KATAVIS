# ADR-006 — Cloudflare D1 dan R2, bukan PostgreSQL dan Prisma

**Status** Diterima · **Tanggal** 15 September 2026
**Menyimpang dari proposal** Ya — bagian 4.1

## Konteks

Proposal bagian 4.1 menyebut "PostgreSQL (Prisma ORM) untuk metadata katalog dan Cloudflare R2 /
AWS S3 untuk penyimpanan aset media resolusi tinggi".

Kendala terukur:

| Fakta | Nilai |
|---|---|
| RAM bebas | 1,7 GB dari 15,6 GB |
| Sisa disk C: | 28,3 GB |
| Docker | terpasang |
| PostgreSQL dalam kontainer | ~300–500 MB menetap, ditambah overhead Docker |

Pemilik produk memilih "Cloudflare D1 + R2 sepenuhnya" dengan hotspot cadangan sebagai mitigasi
jaringan.

## Keputusan

D1 untuk data terstruktur, R2 untuk media. Tanpa PostgreSQL, tanpa Prisma, tanpa Docker pada jalur
data.

R2 memang sudah disebut proposal, jadi bagian itu tidak menyimpang.

## Alasan

**Anggaran memori.** PostgreSQL yang menetap mengambil dari 1,7 GB yang tersisa, sementara Chrome
untuk Studio Agent membutuhkan porsi besar. Menjalankan keduanya akan menyebabkan swap.

**D1 adalah SQLite, dan SQL-nya hampir sama.** Migrasi ke PostgreSQL kelak menuntut penyesuaian
tipe, bukan penulisan ulang. Skema di `docs/ARCHITECTURE.md` bagian 6 sengaja menghindari fitur
khusus SQLite.

**Satu vendor untuk seluruh lapisan edge.** Worker, D1, R2, dan Queues berada di satu akun, satu
perintah penerapan, satu tempat memeriksa kuota.

**Prisma tidak memberi nilai di sini.** Skemanya 11 tabel dengan relasi sederhana. SQL yang
diketik langsung lebih mudah dibaca, tanpa langkah generate, dan tanpa ukuran bundel tambahan yang
penting di Workers.

## Batas yang paling mengikat

| Batas | Nilai free | Dampak |
|---|---|---|
| **Kueri per invocation Worker** | **50 (Free)** vs 1000 (Paid) | Paling berbahaya. Pola N+1 akan menabrak batas ini. |
| Ukuran basis data | 500 MB | Cukup untuk teks; media di R2 |
| Baris dibaca | 5 juta/hari | Longgar |
| Baris ditulis | 100.000/hari | Longgar |
| Penyimpanan per akun | 5 GB | Cukup |
| R2 penyimpanan | 10 GB-bulan | Mengikat bila video disimpan. ADR-005 menghapus video, jadi longgar. |
| R2 egress | Gratis | Penting untuk katalog publik |

Batas 50 kueri per invocation adalah alasan mengapa `docs/testing/TEST-PLAN.md` memuat pengujian
khusus yang menghitung jumlah kueri per rute (TC-PERF-04). Batas ini tidak dapat diserahkan pada
disiplin; ia harus diuji.

## Konsekuensi

Positif:
- Nol proses yang menetap di mesin pengembangan.
- Miniflare menyediakan D1 dan R2 lokal untuk pengembangan tanpa internet.
- Egress R2 gratis membuat katalog publik tidak berbiaya bandwidth.

Negatif — dinyatakan jujur:
- **Demo bergantung penuh pada internet.** Pemilik produk menerima risiko ini dengan mitigasi
  hotspot cadangan. Ini tercatat sebagai risiko tertinggi di `docs/ops/RISK-REGISTER.md` R-01,
  dan Service Worker menyajikan lapis ketiga.
- Tidak ada relasi yang dipaksakan lintas basis data; integritas dijaga di lapisan aplikasi.
- D1 tidak memiliki tipe kaya PostgreSQL. Skema memakai TEXT berisi JSON untuk larik, dengan
  validasi Zod di batas aplikasi.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| PostgreSQL via Docker seperti proposal | Memori yang tidak tersedia, untuk imbalan yang tidak dibutuhkan pada skala ini. |
| SQLite lokal + sinkronisasi ke Cloudflare | Paling tahan gangguan jaringan, tetapi pemilik produk memilih cloud penuh. Tetap dicatat sebagai opsi pemulihan bila R-01 terpicu. |
| Prisma di atas D1 | Menambah langkah generate dan ukuran bundel untuk skema yang tidak menuntutnya. |
| Neon atau Supabase | PostgreSQL terkelola tanpa beban lokal, tetapi menambah vendor kedua dan latensi lintas jaringan dari Workers. |
