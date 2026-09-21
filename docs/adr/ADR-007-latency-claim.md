# ADR-007 — Definisi ulang klaim latensi di bawah 300ms

**Status** Diterima · **Tanggal** 15 September 2026
**Menyimpang dari proposal** Ya — koreksi klaim, bagian 1.3

## Konteks

Proposal bagian 1.3 menyatakan tujuan: "Mengimplementasikan arsitektur AI Gateway Router independen
guna menjaga latensi interaksi di bawah 300ms dan memangkas biaya komputasi/API hingga 70%."

Dua klaim ini bermasalah dan akan diuji juri.

### Masalah klaim 300ms

Tidak ada model generatif yang menghasilkan gambar berkualitas studio dalam 300 milidetik.
Transkripsi audio 30 detik juga tidak. Angka ini tidak dapat dipenuhi bila dibaca sebagai latensi
pipeline AI.

### Masalah klaim 70%

Tidak ada baseline yang dinyatakan. Dibandingkan dengan apa? Tanpa pembanding dan tanpa pengukuran,
angka ini tidak punya asal-usul. Aturan antislop R-17 melarang menampilkan angka tanpa rujukan yang
dapat ditunjuk.

## Keputusan

### Klaim 300ms dipersempit menjadi responsivitas antarmuka

Klaim baru, yang dapat diukur dan dipertahankan:

> **Setiap interaksi pengguna menerima umpan balik visual di bawah 300ms.**
> Pekerjaan AI berjalan asinkron dengan indikator progres.

Yang diukur:

| Peristiwa | Sasaran | Cara ukur |
|---|---|---|
| Tap sampai perubahan visual | < 100 ms | Penanda performa peramban |
| Interaction to Next Paint (INP) | < 200 ms | Core Web Vitals lapangan |
| Navigasi antar langkah | < 300 ms | Penanda navigasi |
| Tekan rekam sampai indikator aktif | < 100 ms | Penanda khusus |

Yang **tidak** diklaim 300ms, dan dinyatakan terbuka:

| Operasi | Waktu wajar |
|---|---|
| Transkripsi 30 detik audio | 3–10 detik |
| Generate copywriting | 5–15 detik |
| Generate gambar studio | 15–70 detik |
| Total satu katalog | Sasaran di bawah 3 menit |

### Klaim 70% diganti dengan perhitungan yang dapat ditunjuk

Alih-alih persentase tanpa asal, sajikan biaya nyata per katalog:

```
Biaya KATAVIS per katalog, dalam USD (tarif terpublikasi):
  ASR              Groq whisper-large-v3-turbo, kuota gratis     $0
  Copywriting      9router, sekitar 2.000 token                  BELUM DIUKUR (O6, Minggu 3)
  Gambar studio    Workers AI flux-2-klein-9b, $0,015 x 3        $0,045
  Penyimpanan      R2, kurang dari 5 MB per produk               $0 (dalam 10 GB gratis)
  ──────────────────────────────────────────────────────────────────────
  Subtotal terukur                                               $0,045
  Total                                                          menunggu O6
```

**Tiga aturan yang mengikat sebelum angka ini masuk slide:**

1. **Konversi rupiah wajib menyertakan kurs dan tanggalnya.** Angka rupiah tanpa kurs adalah angka
   tanpa sumber. Tulis "$0,045 (Rp750 pada kurs Rp16.700/USD, 15 September 2026)", bukan "Rp750".
2. **Komponen yang belum diukur tidak boleh dimasukkan ke total.** Biaya 9router terjawab pada
   Minggu 3 sebagai O6. Sampai itu, yang disebut hanyalah subtotal terukur.
3. **Kutipan harga pembanding wajib disertai tangkapan layar atau tautan penyedia jasa nyata.**

Pembanding konvensional belum dikumpulkan. Rentang seperti "jasa foto produk Rp50.000–150.000"
adalah perkiraan pasar yang belum diverifikasi, dan karena itu **tidak dicantumkan di sini**.
Bila tim mengumpulkan kutipan nyata, ia ditambahkan beserta sumbernya. Bila tidak, seluruh
perbandingan biaya dihapus dari slide.

Angka tanpa sumber lebih merugikan daripada tidak ada angka.

## Alasan

**Klaim yang dapat diuji mengalahkan klaim yang besar.** Juri teknis akan menanyakan cara mengukur
300ms. Jawaban "itu latensi antarmuka, ini grafik INP-nya" dapat dipertahankan. Jawaban "itu latensi
pipeline AI" akan runtuh dalam satu pertanyaan lanjutan.

**Klaim yang tidak dapat dipenuhi merusak kredibilitas seluruh presentasi.** Bila satu angka
terbukti dikarang, juri akan meragukan sisanya.

**Mengakui batas menunjukkan kematangan teknis.** Menyatakan "generate gambar butuh 15–70 detik,
karena itu kami rancang antarmuka asinkron dengan progres" lebih meyakinkan daripada menyembunyikannya.

## Konsekuensi

- Slide presentasi wajib diperbarui. Angka 300ms tetap muncul, tetapi dengan definisi yang tepat.
- Klaim 70% dihapus kecuali perhitungan pembandingnya lengkap dengan sumber.
- Antarmuka wajib menyediakan umpan balik langsung pada setiap tindakan, karena inilah yang kini
  diklaim. Ini menjadi persyaratan fungsional, bukan sekadar perbaikan pengalaman.
- Diuji di `docs/testing/TEST-PLAN.md` bagian performa (TC-PERF-01 sampai TC-PERF-03).

## Kalimat siap pakai untuk presentasi

> "Kami mengukur latensi pada dua tingkat yang berbeda. Antarmuka merespons di bawah 300 milidetik
> pada setiap interaksi — ini grafik INP kami. Pemrosesan AI membutuhkan 15 sampai 70 detik, dan
> karena itu kami merancang alurnya asinkron: pengrajin melihat progres nyata dan pekerjaannya
> tersimpan otomatis. Total dari mulai sampai katalog siap tinjau berada di bawah tiga menit."

Kalimat ini menjawab pertanyaan sebelum diajukan, dan menunjukkan angkanya berasal dari pengukuran.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| Pertahankan klaim apa adanya | Akan runtuh saat ditanya. Merusak kredibilitas seluruh presentasi. |
| Hapus seluruh klaim angka | Terlalu jauh. Angka yang dapat diukur adalah kekuatan, bukan kelemahan. |
| Klaim 300ms hanya untuk operasi yang di-cache | Benar secara teknis, tetapi menyesatkan. Termasuk klaim yang dibuat-buat menurut R-36. |
