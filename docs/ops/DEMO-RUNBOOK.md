# Demo Runbook — Final APHACKATON 2026

Dokumen operasional untuk hari-H. Dibaca saat panik, jadi ditulis singkat dan berurutan.

---

## H-1: Persiapan

### Perangkat keras

- [ ] Laptop terisi penuh, pengisi daya dibawa
- [ ] Ponsel untuk hotspot, kuota diperiksa, baterai penuh
- [ ] Ponsel Android kedua dengan APK terpasang untuk ditunjukkan
- [ ] Kabel HDMI dan adaptor USB-C ke HDMI
- [ ] Produk kriya fisik untuk didemokan langsung
- [ ] Pencahayaan sederhana untuk memotret produk di panggung

### Perangkat lunak

- [ ] `git pull` dan build produksi berhasil
- [ ] Worker dan Pages sudah diterapkan, URL publik dibuka dan berfungsi
- [ ] Studio Agent dijalankan, pemeriksaan kesehatan lolos
- [ ] Chrome dengan profil Gemini sudah login, sesi diverifikasi
- [ ] Cache aset demo terisi — buka setiap halaman demo sekali
- [ ] `DEMO_MODE` diperiksa. (`GEMINI_ENABLED` tidak ada lagi: bendera itu tidak pernah dibaca kode mana pun, dan jalur GeminiWeb dijaga denyut Studio Agent — lihat catatannya di `worker/index.ts`.)
- [ ] Sisa kuota Workers AI diperiksa di dasbor Cloudflare
- [ ] Kuota Groq diperiksa

### Cadangan

- [ ] Rekaman video alur penuh tersimpan **di laptop**, bukan di cloud
- [ ] Tangkapan layar setiap langkah tersimpan lokal
- [ ] Slide presentasi tersimpan sebagai PDF lokal
- [ ] QR ke katalog publik dicetak di kertas

### Latihan terakhir

- [ ] Alur penuh dijalankan tiga kali berturut-turut tanpa gagal
- [ ] Satu kali dengan WiFi sengaja dimatikan di tengah
- [ ] Satu kali dengan Studio Agent sengaja dimatikan
- [ ] Waktu bicara diukur dan sesuai slot

## H-0: Sebelum naik panggung

Urutan ini dijalankan 30 menit sebelum giliran.

1. Sambungkan ke WiFi venue. **Uji dengan membuka URL publik**, bukan hanya melihat ikon WiFi.
2. Bila lambat atau gagal, pindah ke hotspot ponsel sekarang, bukan nanti saat di panggung.
3. Jalankan Studio Agent. Tunggu pemeriksaan kesehatan hijau.
4. Buka seluruh halaman demo sekali untuk memanaskan cache.
5. **Masuk sekali dan pastikan sesinya masih hidup.** Buka `/`, lalu `/masuk`. Bila sudah diarahkan
   ke `/create`, sesinya masih sah dan Anda tidak perlu memasukkan kode apa pun.
6. Tutup semua aplikasi lain. Sisakan Chrome dan terminal.
7. Matikan notifikasi sistem.
8. Atur skala tampilan ke 125% agar terbaca dari kursi juri.
9. Siapkan produk fisik di meja.

### Kalau harus masuk di panggung

Kode OTP hanya muncul di log Worker, dan itu memang satu-satunya cara — penyedia SMS belum
terpasang. Agar tidak mencarinya di depan juri:

1. Buka ponsel pada nomor demo, tekan **Kirim kode**.
2. Kode tercetak di terminal Worker sebagai `[demo] Kode OTP untuk +62...: 123456`.
3. Perbesar terminal itu **sebelum** naik panggung, bukan saat mencarinya.

Bila `/masuk` menolak nomor, periksa bentuknya: layar itu menerima `0812...`, `+62 812-...`, dan
`(0812) 3456.789`, tetapi menolak telepon rumah (`021...`) karena tidak dapat menerima SMS.

**Masuk lebih baik dilakukan sebelum panggung.** Setiap masuk memakai satu dari tiga permintaan
per nomor per jam, dan batas itu terasa tepat saat demo berlangsung.

## Alur demo — 7 menit (asumsi)

> **Slot 7 menit belum dikonfirmasi panitia.** Ini pertanyaan terbuka Q2 di `docs/PRD.md` dengan
> tenggat Minggu 4. Bila slot sebenarnya berbeda, skala ulang seluruh tabel di bawah dan latih
> ulang TC-DEMO-04. Bagian yang dipotong lebih dulu bila slot lebih pendek: arsitektur dan angka
> (6:00–6:45), karena isinya dapat disampaikan saat sesi tanya jawab.

| Menit | Bagian | Yang ditunjukkan |
|---|---|---|
| 0:00–0:45 | Masalah | Tiga hambatan dari proposal bagian 1.1. Tunjukkan foto produk asli yang gelap dan berlatar berantakan. |
| 0:45–1:15 | Pengguna | Siapa pengrajin difabel dan pendamping SLB. Tanpa angka yang tidak terverifikasi. |
| 1:15–4:30 | **Demo langsung** | Alur enam langkah dari awal sampai katalog terbit |
| 4:30–5:15 | Aksesibilitas | Aktifkan Accessibility Mode profil Visual. Nyalakan screen reader. Tunjukkan navigasi suara. |
| 5:15–6:00 | Hasil | Katalog publik dibuka dari ponsel juri lewat QR. Talking-Catalog berjalan. |
| 6:00–6:45 | Arsitektur dan angka | INP, waktu total, biaya per katalog. Setiap angka dari pengukuran. |
| 6:45–7:00 | Penutup | Posisi produk, peta jalan |

### Bagian demo langsung, langkah demi langkah

```
1. Ambil produk fisik, foto dengan ponsel        ~20 detik
2. Tekan tombol rekam, ceritakan produk           ~35 detik
   → Bahasa Indonesia baku. Bukan bahasa daerah.
3. Layar tinjau transkrip muncul                  ~15 detik
   → Bila ada kesalahan, PERBAIKI DI DEPAN JURI.
     Ini bukan kegagalan; ini fitur. Katakan demikian.
4. Sistem memproses, progres terlihat        ~60 detik jalur normal
                                             ~70 detik bila fallback aktif
   → Isi waktu ini dengan menjelaskan arsitektur fallback.
     Siapkan materi untuk 70 detik, bukan 60. Bila Gemini melewati
     batas 45 detik, hasil baru muncul pada detik ke-70.
     Jangan diam menunggu.
5. Periksa hasil: foto studio, cerita, spesifikasi ~30 detik
6. Terbitkan                                       ~10 detik
```

**Langkah 3 adalah kesempatan, bukan risiko.** Bila ASR salah dengar, perbaiki sambil berkata:
"Ini yang kami rancang khusus. Model ASR mana pun akan salah pada nama daerah, jadi pengrajin selalu
memegang kendali sebelum ceritanya masuk ke AI." Itu mengubah kelemahan menjadi keputusan desain
yang terlihat matang.

**Langkah 4 jangan diisi diam.** Enam puluh detik menatap indikator progres terasa lama. Isi dengan
penjelasan rantai tiga lapis penyedia.

## Prosedur saat gagal

### Gagal: internet putus

1. Jangan panik dan jangan menjelaskan panjang. Katakan: "Jaringan venue terputus, saya pindah ke
   koneksi cadangan."
2. Aktifkan hotspot ponsel. Sudah tersimpan di daftar jaringan, cukup satu klik.
3. Bila tetap gagal dalam 15 detik, aktifkan `DEMO_MODE`. Halaman menampilkan penanda data cache.
4. Katakan terus terang: "Ini data yang sudah di-cache. Alurnya sama, pemrosesan AI-nya tidak
   berjalan sekarang."

Jangan pernah berpura-pura data cache adalah hasil langsung. Bila juri menyadarinya, kerugiannya
jauh lebih besar daripada mengakuinya.

### Gagal: generate gambar tidak selesai

Tidak perlu tindakan. Fallback berjalan otomatis dalam 45 detik. Isi waktu dengan menjelaskan
bahwa inilah rantai fallback yang barusan disebut.

Bila ketiga lapis gagal, sistem menampilkan foto asli dengan pesan ramah. Katakan: "Generate gagal,
dan sistem mempertahankan foto asli pengrajin. Karya pengguna tidak pernah hilang karena kegagalan
kami."

### Gagal: ASR tidak menangkap suara

1. Layar tinjau transkrip akan menampilkan hasil yang salah atau kosong.
2. Ketik ulang secara manual di layar itu. Butuh sepuluh detik.
3. Katakan: "Ruangan ini berisik. Pengrajin selalu bisa memperbaiki di sini."

### Gagal: aplikasi macet total

1. Muat ulang halaman. Draf tersimpan otomatis setiap lima detik, jadi pekerjaan tidak hilang.
2. Bila tetap macet, buka rekaman video cadangan.
3. Katakan: "Saya putar rekaman alur ini sambil menjelaskan, lalu kita lanjut ke bagian berikutnya."

Batas waktu: **jangan menghabiskan lebih dari 45 detik memperbaiki apa pun di panggung.** Setelah
itu, pindah ke cadangan. Waktu presentasi lebih berharga daripada demo langsung yang dipaksakan.

## Pertanyaan juri yang harus disiapkan

| Pertanyaan | Jawaban |
|---|---|
| "Layanan AI apa yang dipakai?" | Cloudflare Workers AI untuk gambar, Groq Whisper untuk transkripsi, 9router untuk teks. Sebutkan jalur produksi, bukan jalur eksperimental. |
| "Bagaimana mengukur latensi 300ms?" | Gunakan kalimat yang disiapkan di ADR-007. Tunjukkan grafik INP. |
| "Kenapa tidak pakai SAM dan Stable Diffusion seperti proposal?" | GPU yang tersedia tanpa CUDA. Tunjukkan ADR-004. Menyimpang karena kendala terukur, bukan karena tidak dikerjakan. |
| "Apakah benar-benar WCAG AAA?" | AA menyeluruh, AAA pada kontras dan ukuran target. Tunjukkan laporan axe-core dan tabel kontras terukur. |
| "Bagaimana kalau pengrajin tidak bisa membaca sama sekali?" | Accessibility Mode profil Visual, TTS, dan Voice Navigation. Demokan langsung bila waktu cukup. |
| "Berapa biaya per katalog?" | **Hanya sebutkan komponen yang sudah terukur.** Gambar $0,045 (3 × $0,015), ASR $0 dari kuota gratis. Bila menyebut rupiah, sertakan kurs dan tanggalnya. Biaya teks 9router baru boleh disebut setelah O6 terjawab. Jangan menyebut total sebelum lengkap — lihat ADR-007. |
| "Apa bedanya dengan Canva atau marketplace?" | Ketiga pembeda di `DESIGN.md` bagian 9, ditambah bahwa keduanya tidak dapat dioperasikan pengguna tunanetra. |
| "Bagaimana model bisnisnya?" | Jujur bahwa ini di luar lingkup rilis, dan sebutkan arah yang dipertimbangkan. Jangan mengarang angka proyeksi. |

## Setelah demo

- [ ] Catat pertanyaan juri yang tidak terjawab dengan baik
- [ ] Catat bagian mana yang gagal dan sebabnya
- [ ] Simpan log `jobs` untuk analisis
- [ ] Matikan Studio Agent
- [ ] Kembalikan `DEMO_MODE` ke `"false"`

`DEMO_MODE` adalah satu-satunya sakelar yang tersisa, dan yang dilakukannya hanya dua: mencetak
kode OTP ke log Worker, dan menampilkan penanda data cache saat jaringan gagal. Jalur GeminiWeb
**tidak** punya sakelar — ia dijaga denyut Studio Agent, jadi mematikan agennya sudah cukup dan
memang itu cara yang benar. Lihat catatan di `worker/index.ts` bagian `Env`.
