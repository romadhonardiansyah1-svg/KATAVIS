# Panduan Pembuatan Video Demo — KATAVIS

**Versi** 1.0 · **Tanggal** 21 September 2026
**Untuk** APTIKOM Hackathon (APHACKATON) 2026 — babak final
**Hubungan dengan dokumen lain** Pelengkap `docs/ops/DEMO-RUNBOOK.md`. Runbook mengatur demo
langsung di panggung; dokumen ini mengatur **video** yang direkam sebelumnya.

---

## 1. Mengapa video demo berbeda dari demo langsung

Ini keputusan yang membentuk seluruh panduan, jadi dinyatakan lebih dulu.

`DEMO-RUNBOOK.md` bagian *Prosedur saat gagal* menempatkan rekaman video sebagai jalan terakhir
(R-01 lapis 4). Tetapi video demo yang direkam sengaja punya nilai lain: ia punya **lebih banyak
kelebihan daripada demo langsung** dalam hal penyampaian, dan **satu kelemahan besar** yang harus
dikompensasi.

| Aspek | Demo langsung | Video demo |
|---|---|---|
| Kendali waktu | Tidak ada. Proses 70 detik tidak bisa dipercepat. | Penuh. Bagian menunggu dipercepat *time-lapse*. |
| Risiko gagal di depan juri | Tinggi (R-01, R-02) | Nol setelah rekaman selesai |
| Kejujuran hasil | Terlihat apa adanya | Dapat menyesatkan bila disunting berlebihan |
| Bukti keaslian | Kuat — juri menyaksikan sendiri | Lemah — harus dibuktikan dengan cara lain |

**Aturan pengikat:** setiap percepatan, potongan, atau efek dalam video yang mengubah persepsi
waktu nyata **wajib diberi penanda visual di layar** (mis. label "dipercepat 4×" atau "waktu
nyata"). Aturan antislop R-36 melarang klaim dan tampilan yang dibuat-buat. Video demo yang
terlihat lebih cepat daripada kenyataan tanpa penanda melanggar aturan ini, dan bila juri
menyadarinya, kerugiannya jauh lebih besar daripada sekadar mengakui durasi sebenarnya.

**Konsekuensinya untuk pemakaian:** video demo **melengkapi**, bukan menggantikan, demo langsung.
Pembagian yang direkomendasikan:

- Video memuat hal yang lambat dan hal yang tidak mungkin ditunjukkan berulang: arsitektur, rantai
  fallback, alur enam langkah penuh dari mesin bersih, dan perbandingan foto asli vs foto studio.
- Demo langsung tetap memuat tiga hal: produk kriya fisik, layar tinjau transkrip (koreksi di depan
  juri), dan sesi tanya jawab.

---

## 2. Dua format yang dibutuhkan

Satu slot presentasi 7 menit (asumsi `DEMO-RUNBOOK.md`; Q2 di `docs/PRD.md` belum dikonfirmasi).
Siapkan dua varian sekaligus dari satu sesi rekaman.

| Varian | Durasi | Posisi dalam presentasi | Isi |
|---|---|---|---|
| **A — Video demo utama** | **2:30 (±15 detik)** | Setelah pembuka masalah, sebagai pengganti bagian demo langsung | Alur lima langkah dari mesin bersih sampai katalog terbit |
| **B — Video pendek submisi** | **60 detik** | Untuk formulir lomba, tautan pratinjau, atau media sosial | Masalah → hasil. Tanpa arsitektur. |

Rekomendasi durasi ini berasal dari pembagian slot 7 menit:

```
0:00–1:15  Presenter langsung — masalah + pengguna            (1:15)
1:15–3:45  VIDEO A diputar                                     (2:30)
3:45–4:30  Presenter — aksesibilitas, demo live kecil          (0:45)
4:30–5:15  Demo langsung atau lanjutan video — Talking-Catalog (0:45)
5:15–6:45  Presenter — arsitektur, angka terukur               (1:30)
6:45–7:00  Penutup                                             (0:15)
```

**Mengapa 2:30, bukan lebih panjang.** Batas kritisnya bukan selera, melainkan kompresi waktu.
Tahap pemrosesan nyata memakan 60–70 detik (jalur normal 60 detik, bila fallback aktif 70 detik —
`DEMO-RUNBOOK.md` langkah 4). Pada percepatan 4×, itu menjadi 15–18 detik di video. Sisa waktu
dipakai untuk lima bagian lain. Bila video lebih dari 3 menit, ia memakan bagian arsitektur dan
tanya jawab yang justru paling menentukan penilaian teknis.

Bila slot sebenarnya berbeda dari 7 menit, skala ulang dengan aturan: **video A = 35% dari slot**,
tidak pernah lebih dari 3 menit. Bagian yang dipotong lebih dulu adalah potongan arsitektur di
dalam video (scene 7 opsional), karena isinya dapat disampaikan lisan.

---

## 3. Scene dan storyboard

Delapan scene untuk varian A. Kolom **Sumber** menunjuk dokumen acuan, sehingga setiap klaim di
video dapat dipertanggungjawabkan bila ditanya juri.

| # | Waktu | Scene | Yang tampil di layar | Narasi inti | Sumber |
|---|---|---|---|---|---|
| 1 | 0:00–0:15 | **Masalah** | Satu foto produk kriya yang gelap, berlatar berantakan. Tanpa teks dekoratif. | Tiga hambatan: aset visual, artikulasi copywriting, barrier bahasa | `PRD.md` §2 |
| 2 | 0:15–0:30 | **Pengrajin** | Rekaman singkat tangan pengrajin memegang produk. Ponsel kelas menengah ditunjukkan bila ada perangkat fisik. | Siapa pengguna; tanpa angka yang belum diverifikasi | `PRD.md` §3 |
| 3 | 0:30–1:05 | **Langkah 1–2: Foto → Cerita** | Layar rekam: tombol bundar 96px, gelombang suara bergerak, penghitung waktu naik | "Satu layar satu keputusan." Tekan, lalu bercerita 30 detik | `FEATURE-SPECS.md` F1, S2 |
| 4 | 1:05–1:25 | **Langkah 3: Tinjau transkrip** | Kotak teks besar berisi transkrip, penyuntingan terlihat di layar | **Scene terpenting secara strategis.** ASR salah, pengrajin mengoreksi. Ini keputusan desain, bukan cacat | ADR-008, `FEATURE-SPECS.md` F1-03 |
| 5 | 1:25–1:45 | **Langkah 4: Proses** | Indikator progres nyata: "Menyusun cerita… 40%". Teks *overlay* kecil "dipercepat 4×" | Rantai fallback tiga lapis; pekerjaan berjalan asinkron | `ARCHITECTURE.md` §8, ADR-007 |
| 6 | 1:45–2:10 | **Hasil + perbandingan** | Perbandingan berdampingan: foto asli dan foto studio. Cerita 80–150 kata, 3–6 spesifikasi, caption, 5 kata kunci | "Produk tidak berubah bentuk, warna, tekstur." Kriteria gagal/lolos | F2-05, F2-06, F2-07 |
| 7 | 2:10–2:25 | **Aksesibilitas + terbit** *(opsional, dipotong bila slot pendek)* | Accessibility Mode profil Visual diaktifkan; TTS membacakan cerita; katalog terbit | Target 56px, teks 18px, kontras AAA terukur | `DESIGN.md` §8, S1 |
| 8 | 2:25–2:30 | **Penutup** | Katalog publik di layar ponsel, *QR code* ditampilkan | Posisi produk, satu kalimat | `PRD.md` §5.3 |

### Empat momen yang wajib ada

Bila waktu memaksa memotong, urutan pemotongan adalah scene 7 dahulu, lalu scene 7 dan 2. **Empat
scene ini tidak pernah dipotong:**

1. **Scene 4 — tinjau transkrip.** Ini yang membedakan KATAVIS dari sekadar pembungkus API.
2. **Scene 6 — perbandingan asli vs studio.** Membuktikan F2-05 (produk tidak berubah), sekaligus
   klaim yang paling mudah diuji juri.
3. **Scene 5 — progres nyata.** Membuktikan gaya asinkron, yang menjadi dasar ADR-007.
4. **Scene 1 — foto asli yang buruk.** Tanpa kontras "sebelum", nilai "sesudah" tidak terasa.

### Varian B (60 detik)

Buang scene 2, 5, 7. Sisakan: masalah (0:00–0:10) → alur dipadatkan (0:10–0:40) → hasil dan
perbandingan (0:40–0:55) → penutup (0:55–1:00). Tanpa arsitektur, tanpa angka biaya.

---

## 4. Urutan alur demo — apa yang direkam, dalam urutan apa

Urutan ini mengikuti `S2 — Guided Navigation` yang mengikat: **enam langkah, satu aksi utama per
layar, tidak dapat dilompati.** Merekam di luar urutan ini akan menghasilkan video yang menunjukkan
alur yang tidak ada di produk.

```
Persiapan (tidak direkam)
  0. Mesin bersih: tab baru, tanpa draf tersimpan, kuota diperiksa

Rekaman alur utama
  1. Foto Produk        → "Arahkan kamera ke produk Anda."
  2. Rekam Cerita       → 30 detik, Bahasa Indonesia baku
  3. Periksa Transkrip  → REKAM SATU KALI DENGAN KESALAHAN SENGAJA, satu kali yang bersih
  4. Sistem Memproses   → rekam sampai selesai, tanpa dipotong
  5. Periksa Hasil      → bandingkan asli vs studio
  6. Terbitkan          → halaman publik terbuka

Rekaman tambahan (B-roll)
  7. Accessibility Mode → profil Visual, TTS, navigasi suara
  8. Studio Agent       → terminal, pemeriksaan kesehatan hijau
  9. Katalog publik     → di layar ponsel fisik
```

### Detail yang menentukan kualitas rekaman

**Bahasa narasi wajib Bahasa Indonesia baku.** Ini alasan teknis, bukan gaya: ASR akan kacau pada
campur kode bahasa daerah, dan WER bahasa Jawa berada di atas 50%. Bila rekaman uji di video
memakai bahasa daerah, hasil transkrip yang tampil justru melemahkan produk di depan juri. Lihat
R-05 dan `ARCHITECTURE.md` §8.

**Scene tinjau transkrip direkam dua kali.** Sekali dengan ASR yang salah dengar (nama bahan,
istilah kriya), sekali dengan transkrip benar. Potongan yang menunjukkan koreksi dipakai di scene 4;
potongan bersih dipakai sebagai kelanjutan alur. Jangan memalsukan kesalahan dengan mengetik
kesalahan buatan di layar — biarkan ASR benar-benar salah, atau bila tidak salah, katakan terus
terang di narasi bahwa layar ini ada justru untuk antisipasi.

**Tahap pemrosesan direkam utuh tanpa potongan.** Inilah bukti keaslian yang paling kuat: durasi
asli 60–70 detik terlihat di stopwatch video. Percepatan dilakukan di tahap penyuntingan dengan
penanda "dipercepat 4×", bukan dengan memotong diam-diam.

**Rekam resolusi dan latar konsisten.** Satu sesi, satu mesin, satu pengaturan skala tampilan.
`DEMO-RUNBOOK.md` H-0 butir 7 menyarankan skala 125% agar terbaca dari kursi juri — pengaturan ini
berlaku juga untuk rekaman.

---

## 5. Tool dan perangkat lunak

### 5.1 Perekaman layar

| Tool | Platform | Lisensi | Catatan |
|---|---|---|---|
| **OBS Studio** | Win/mac/Linux | Gratis, sumber terbuka | **Rekomendasi utama.** Multi-sumber (layar + webcam + audio terpisah), output tanpa batas waktu, tidak memuat sumber daya besar. Rekaman diskalakan ke perangkat yang RAM-nya sempit (R-10). |
| **Windows Game Bar** | Windows | Bawaan | Cukup untuk tangkapan layar cepat. Terbatas: satu monitor, tidak ada pengaturan audio lanjutan. |
| **ShareX** | Windows | Gratis, sumber terbuka | Baik untuk tangkapan layar per langkah (`DEMO-RUNBOOK.md` meminta ini) dan GIF pendek. |

Pengaturan OBS yang direkomendasikan:

```
Resolusi keluaran   1920x1080 (sesuaikan bila layar lebih kecil — jangan naikkan)
FPS                 30 (cukup untuk UI; 60 hanya menambah ukuran berkas)
Encoder             Hardware (Intel QuickSync pada iGPU Arc) — memakai GPU yang ada,
                    membebaskan CPU yang sudah sempit
Bitrate             8.000–10.000 Kbps
Format              MKV saat merekam, remux ke MP4 setelah selesai
Audio               Dua jalur terpisah: mikrofon narator, dan audio sistem
```

Dua catatan penting untuk mesin pengembangan ini:

1. **Encoder QuickSync, bukan x264.** GPU adalah Intel Arc iGPU tanpa CUDA, tetapi QuickSync
   berfungsi dan memindahkan beban enkode dari CPU. Dengan RAM bebas terukur 1,7 GB (R-10),
   mengenkode di CPU sambil Next.js dev server dan Wrangler berjalan berisiko membuat rekaman
   tersendat.
2. **Tutup Studio Agent saat merekam.** Chrome untuk Studio Agent, dev server, dan Wrangler
   berjalan bersamaan akan menghabiskan memori. Rekam alur yang jalur Gemini-nya sudah
   di-cache lebih dulu, atau jalankan fallback Workers AI saja.

### 5.2 Penyuntingan

| Tool | Lisensi | Kapan dipakai |
|---|---|---|
| **Kdenlive** | Gratis, sumber terbuka | **Rekomendasi.** Ringan, cukup untuk potong, percepat, overlay teks, dan penyelarasan audio. Berjalan tanpa akun. |
| **DaVinci Resolve** | Gratis (versi dasar) | Lebih kuat untuk koreksi warna dan subtitle. Berat — periksa memori sebelum dipakai di mesin ini. |
| **CapCut** | Gratis (versi dasar) | Paling cepat untuk video 60 detik varian B. Subtitle otomatis Bahasa Indonesia tersedia. |
| **Shotcut** | Gratis, sumber terbuka | Alternatif paling ringan bila Kdenlive terasa lambat. |

`ffmpeg` **tidak terpasang** di mesin ini (`AGENTS.md` kendala keras). Jika tim membutuhkannya untuk
perakitan cepat dari baris perintah, ia harus dipasang lebih dulu — dan pemasangannya **tidak**
boleh menjadi prasyarat bagi jalur kritis demo. Semua tool di atas dapat menyelesaikan pekerjaan
tanpa `ffmpeg`.

### 5.3 Audio

| Kebutuhan | Tool | Catatan |
|---|---|---|
| Narasi | Mikrofon clip-on atau headset | Rekam audio **terpisah** dari layar, lalu selaraskan. Kualitas audio lebih menentukan persepsi profesional daripada kualitas gambar. |
| Musik latar | Pustaka bebas royalti | Volume -18 dB di bawah narasi. Tanpa musik lebih baik daripada musik yang menutupi narasi. |
| Pembersihan derau | Fitur bawaan editor | Ruang kerja di venue biasanya berisik; rekam di ruang tenang. |

**Jangan memakai TTS sebagai narasi video.** Suara TTS produk (F3) berbeda dari suara narator.
Mencampur keduanya membuat juri bingung membedakan mana fitur produk dan mana narasi presenter.

### 5.4 Khusus varian B (60 detik)

CapCut atau Kdenlive dengan format vertikal 1080×1920 bila ditujukan untuk media sosial, dan
horizontal 1920×1080 bila untuk formulir lomba. Rekam sekali dalam horizontal, bingkai ulang untuk
vertikal di penyuntingan — jangan merekam dua kali.

---

## 6. Yang tidak boleh ada dalam video

Daftar ini mengikat, dan berasal dari aturan proyek yang sudah ada.

| Dilarang | Alasan | Sumber |
|---|---|---|
| Mempercepat waktu tanpa penanda di layar | Klaim yang dibuat-buat | R-36 |
| Menyatakan "latensi di bawah 300ms" untuk pemrosesan AI | Angka tidak dapat dipenuhi; akan runtuh saat ditanya | ADR-007 |
| Menyebut "penghematan 70%" | Tidak ada baseline terukur | ADR-007, R-09 |
| Menyatakan "WCAG 2.1 AAA" menyeluruh | Yang benar: AA menyeluruh + AAA pada kontras dan ukuran target | `PRD.md` §4, R-09 |
| Menampilkan angka statistik BPS tanpa sumber yang dibuka | R-17; angka proposal belum diverifikasi | `PRD.md` §2 |
| Menyebut Gemini sebagai tulang punggung | Yang jujur: Workers AI jalur produksi, Gemini jalur eksperimental | `ARCHITECTURE.md` §4 |
| Menyembunyikan bahwa data berasal dari cache | Harus ada penanda terlihat | `ARCHITECTURE.md` §9 |
| Jendela terminal palsu sebagai dekorasi | Antislop | `DESIGN.md` §10 |
| Musik bertempo tinggi, transisi berkilau, animasi berlebihan | Dial produk: ENERGY 2, RHYTHM 1, MOTION 1 | `DESIGN.md` §2 |
| Menyebut biaya total per katalog | Sebagian komponen belum diukur (O6) | ADR-007 |

Video demo juga tunduk pada arah visual yang sama dengan produk. Musik bertempo tinggi dan
transisi cepat akan bertabrakan dengan dial yang sudah ditetapkan, dan membuat produk aksesibilitas
terlihat seperti iklan aplikasi biasa.

---

## 7. Kalimat siap pakai

Dua kalimat di bawah sudah teruji di dokumen lain. Pakai apa adanya.

**Menjawab pertanyaan latensi sebelum diajukan** (`ADR-007` bagian *Kalimat siap pakai*):

> "Kami mengukur latensi pada dua tingkat yang berbeda. Antarmuka merespons di bawah 300 milidetik
> pada setiap interaksi — ini grafik INP kami. Pemrosesan AI membutuhkan 15 sampai 70 detik, dan
> karena itu kami merancang alurnya asinkron: pengrajin melihat progres nyata dan pekerjaannya
> tersimpan otomatis. Total dari mulai sampai katalog siap tinjau berada di bawah tiga menit."

**Menjelaskan layar tinjau transkrip** (`DEMO-RUNBOOK.md` langkah 3):

> "Ini yang kami rancang khusus. Model ASR mana pun akan salah pada nama daerah, jadi pengrajin
> selalu memegang kendali sebelum ceritanya masuk ke AI."

**Bila juri bertanya layanan AI apa yang dipakai** (`ARCHITECTURE.md` §4, R-04):

> "Cloudflare Workers AI untuk gambar, Groq Whisper untuk transkripsi, dan 9router untuk teks.
> Gemini adalah jalur eksperimental yang kami matikan bila ada masalah."

---

## 8. Daftar periksa produksi

### Sebelum merekam

- [ ] `pnpm run verify` lolos — tidak merekam build yang gagal
- [ ] Mesin bersih: tab baru, tanpa draf tersimpan, `localStorage` dibersihkan
- [ ] Kuota diperiksa: Workers AI Neurons, Groq
- [ ] Cache aset demo terisi — buka setiap halaman sekali
- [ ] `DEMO_MODE` sesuai keinginan rekaman. (`GEMINI_ENABLED` sudah dihapus — bendera itu tidak pernah dibaca kode mana pun.)
- [ ] Studio Agent dimatikan kecuali scene 8 direkam
- [ ] Notifikasi sistem dimatikan; hanya Chrome dan terminal terbuka
- [ ] Skala tampilan 125%
- [ ] Resolusi layar dicatat — dipakai konsisten di seluruh sesi
- [ ] Ruangan tenang; mikrofon diuji 10 detik lebih dulu
- [ ] **Stopwatch terlihat** di sudut layar untuk membuktikan durasi nyata

### Saat merekam

- [ ] Rekaman percobaan 60 detik dijalankan lebih dulu untuk uji format
- [ ] Scene 4 direkam dua kali: dengan kesalahan ASR, dan bersih
- [ ] Scene 5 direkam utuh tanpa potongan
- [ ] Tangkapan layar per langkah disimpan terpisah (untuk slide cadangan)
- [ ] Berkas disimpan MKV; *remux* ke MP4 setelah tiap scene

### Setelah merekam

- [ ] Audio dinormalisasi ke tingkat seragam
- [ ] Percepatan waktu diberi penanda di layar
- [ ] Seluruh angka di video dicocokkan ke dokumen sumbernya
- [ ] Tidak ada istilah teknis yang bocor (pesan galat harus versi ramah — `FEATURE-SPECS.md` S5)
- [ ] Subtitle Bahasa Indonesia ditambahkan *(wajib — video produk aksesibilitas yang subtitelnya
      tidak ada akan menjadi kontradiksi di depan juri)*
- [ ] Video disimpan **lokal di laptop**, bukan hanya di cloud (R-01 mitigasi 4)
- [ ] Salinan kedua di USB, dibawa saat hari-H
- [ ] Varian A dan B diekspor terpisah
- [ ] Durasi final diukur dengan pemutar, bukan diperkirakan

---

## 9. Pemakaian saat hari-H

Video demo dijalankan tiga cara berbeda, dan ketiganya harus disiapkan:

1. **Diputar penuh sebagai bagian presentasi** — varian A, sesuai pembagian di bagian 2.
2. **Diputar sebagai pengganti demo langsung saat gagal** — bila `DEMO_MODE` aktif atau aplikasi
   macet, putar varian A dan katakan terus terang bahwa ini rekaman. Jangan berpura-pura.
3. **Diputar per bagian saat tanya jawab** — simpan varian A di posisi *timestamp* scene 4, 5, dan
   6, sehingga dapat langsung dilompati bila juri menanyakan hal spesifik.

Berkas disimpan di laptop, di USB, dan di ponsel sebagai salinan ketiga. Batas waktu memperbaiki
masalah di panggung tetap 45 detik (`DEMO-RUNBOOK.md`); setelah itu pindah ke rekaman.

---

## 10. Rujukan

- `docs/ops/DEMO-RUNBOOK.md` — prosedur hari-H, termasuk saat gagal
- `docs/PRD.md` §2–§5 — masalah, pengguna, fitur, koreksi klaim
- `docs/spec/FEATURE-SPECS.md` — perilaku yang dapat diuji, per fitur
- `docs/ARCHITECTURE.md` §4, §8, §9 — mengapa Studio Agent di laptop, rantai fallback, ketahanan
- `docs/adr/ADR-007-latency-claim.md` — definisi klaim latensi dan perhitungan biaya
- `docs/adr/ADR-008-transcript-review.md` — mengapa langkah tinjau transkrip ada
- `docs/ops/RISK-REGISTER.md` R-01, R-04, R-05, R-09 — risiko yang menyentuh rekaman
- `DESIGN.md` §2, §8, §10 — dial liveliness, aksesibilitas, larangan mengikat
