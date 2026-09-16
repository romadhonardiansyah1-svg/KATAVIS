# Risk Register KATAVIS

**Versi** 1.0 · **Tanggal** 15 September 2026
**Ditinjau** setiap akhir minggu

Skala: Kemungkinan (K) dan Dampak (D), masing-masing 1–5. Skor = K × D.

---

## Risiko aktif, diurutkan dari skor tertinggi

### R-01 — WiFi venue gagal saat demo · Skor 20 (K4 × D5)

**Sebab risiko ini tertinggi:** ADR-006 menempatkan D1 dan R2 sebagai satu-satunya penyimpanan.
Tanpa jaringan, aplikasi tidak memiliki data sama sekali. WiFi venue lomba dipakai puluhan tim
bersamaan; kegagalan bukan skenario ekstrem melainkan hal yang lazim.

Mitigasi berlapis:
1. Hotspot ponsel disiapkan dan **sudah diuji sebelum hari-H**, bukan disiapkan sebagai niat.
2. Service Worker menyimpan seluruh aset dan data produk demo di cache.
3. Mode demo eksplisit lewat feature flag yang menyajikan data cache, dengan penanda yang terlihat.
4. Tangkapan layar dan rekaman video alur penuh sebagai jalan terakhir dalam presentasi.

Pemilik risiko: ketua tim. Tenggat mitigasi: Minggu 6.
Dilatih di TC-DEMO-02.

**Catatan jujur:** lapis 4 berarti demo langsung digantikan rekaman. Itu kehilangan nilai, tetapi
lebih baik daripada layar kosong di panggung.

### R-02 — Studio Agent gagal saat demo · Skor 16 (K4 × D4)

Selector `gemini.google.com` akan pecah; pertanyaannya kapan. Aplikasi Angular dengan nama kelas
terobfuskasi berubah setiap penerapan.

Mitigasi:
1. Batas waktu keras 45 detik, lalu fallback otomatis ke Workers AI.
2. Pemeriksaan kesehatan saat agen mulai; bila selector tidak dikenali, agen mendaftarkan diri
   tidak sehat dan pekerjaan langsung menuju Workers AI tanpa menunggu.
3. Aset demo sudah diproduksi sebelumnya dan tersimpan di cache.
4. Feature flag untuk mematikan jalur Gemini sepenuhnya dalam hitungan detik.

Dilatih di TC-DEMO-03 dan TC-SA-01 sampai TC-SA-06.

### R-03 — Fitur tidak selesai sebelum final · Skor 15 (K3 × D5)

Satu pengembang mengerjakan empat fitur utama, lima belas fitur pendukung, aksesibilitas tingkat
AAA, dan enam lapis pengujian.

Mitigasi:
1. Urutan pengerjaan mengikuti nilai demo, bukan kelengkapan. Lihat `ROADMAP.md`.
2. Setiap minggu diakhiri dengan build yang dapat didemokan, betapapun kecil cakupannya.
3. Titik potong ditetapkan di muka: bila Minggu 6 belum tercapai, F4 diturunkan menjadi ekspor PDF
   saja tanpa feed marketplace.

### R-04 — Akun Google ditangguhkan · Skor 12 (K3 × D4)

Otomasi Gemini web melanggar Google ToS bagian *"Don't abuse our services"*. Sanksinya dapat
mencakup penghapusan akun Google beserta Gmail, Drive, dan Photos.

Mitigasi:
1. **Gunakan akun Google terpisah**, bukan akun utama anggota tim. Ini syarat wajib, bukan saran.
2. Tidak ada otomasi proses masuk; login dilakukan manusia satu kali.
3. Volume permintaan dibatasi wajar, tidak ada perulangan cepat.
4. Workers AI selalu siap dan tidak bergantung pada akun mana pun.

Bila terpicu: matikan jalur Gemini lewat feature flag, seluruh beban berpindah ke Workers AI.
Dampaknya pada demo mendekati nol karena fallback sudah diuji.

### R-05 — Akurasi ASR Bahasa Indonesia tidak memadai · Skor 12 (K4 × D3)

Tidak ada penyedia yang mengklaim dukungan dialek daerah Indonesia. AssemblyAI menempatkan bahasa
Jawa pada kelompok WER di atas 50%. Angka WER Bahasa Indonesia untuk Whisper tidak ditemukan di
sumber mana pun.

Mitigasi:
1. Layar tinjau transkrip wajib — ADR-008. Ini mitigasi utama, bukan tambahan.
2. Skrip narasi demo memakai Bahasa Indonesia baku.
3. Pengukuran nyata pada Minggu 3 dengan rekaman beraksen, bukan mengandalkan klaim penyedia.
4. ElevenLabs Scribe v2 sebagai opsi berbayar bila akurasi menjadi penghambat — satu-satunya yang
   menempatkan Indonesia pada kelompok WER ≤5%.

### R-06 — Kuota gratis habis saat latihan demo · Skor 12 (K4 × D3)

Workers AI memberi 10.000 Neurons per hari. Itu setara sekitar tujuh penyuntingan
`flux-2-klein-9b`. Latihan demo berulang akan menghabiskannya sebelum tengah hari.

Mitigasi:
1. Hasil generate di-cache dan dipakai ulang saat latihan.
2. Latihan memakai produk demo yang sama sehingga cache selalu kena.
3. `flux-1-schnell` (~170 gambar/hari) untuk pengembangan; `flux-2-klein-9b` hanya untuk hasil final.
4. Workers Paid seharga sekitar $5 per bulan disiapkan sebagai opsi. Biaya ini kecil dibanding
   risiko gagal latihan.

### R-07 — TalkBack pada WebView tidak memadai · Skor 9 (K3 × D3)

ADR-002 memilih TWA dengan mengakui TalkBack pada WebView lebih lemah daripada komponen native.
Produk ini menargetkan pengguna tunanetra, jadi kelemahan ini menyentuh nilai inti.

Mitigasi:
1. Uji TalkBack pada perangkat fisik sejak Minggu 4, bukan menjelang final — TC-A11Y-21.
2. Struktur ARIA yang benar dan diuji, bukan diasumsikan.
3. Bila hambatan tidak dapat diperbaiki lewat ARIA, pertimbangkan lapisan native tipis hanya untuk
   alur bermasalah.

### R-08 — Batas 50 kueri D1 per invocation tertembus · Skor 9 (K3 × D3)

D1 pada paket gratis hanya mengizinkan 50 kueri per invocation Worker, dibanding 1000 pada paket
berbayar. Satu pola N+1 akan menembusnya, dan galatnya hanya muncul di produksi.

Mitigasi:
1. TC-PERF-04 menghitung kueri nyata dengan ambang 25, memberi ruang aman.
2. Kueri berkelompok dengan `batch()` sebagai pola baku.
3. Gerbang CI menolak merge bila ambang terlampaui.

### R-09 — Klaim proposal dipertanyakan juri · Skor 8 (K4 × D2)

Proposal memuat tiga klaim yang tidak dapat dipenuhi apa adanya: latensi 300ms, penghematan 70%,
dan WCAG 2.1 AAA.

Mitigasi:
1. ADR-007 mendefinisikan ulang klaim latensi menjadi bentuk yang dapat diukur.
2. Klaim 70% dihapus kecuali perhitungan pembandingnya lengkap dengan sumber.
3. Klaim AAA dipersempit menjadi AA menyeluruh ditambah AAA pada kriteria terpilih, dengan laporan
   axe-core sebagai bukti.
4. Kalimat jawaban disiapkan di ADR-007 dan dilatih sebelum presentasi.

### R-10 — Mesin pengembangan kehabisan sumber daya · Skor 6 (K3 × D2)

RAM bebas terukur 1,7 GB dari 15,6 GB. Sisa disk 28,3 GB. Chrome untuk Studio Agent, Next.js dev
server, dan Wrangler berjalan bersamaan.

Mitigasi:
1. ADR-006 menghapus PostgreSQL dan Redis dari mesin lokal.
2. ADR-002 menghapus Android Studio dan emulator.
3. ADR-003 dan ADR-005 menghapus seluruh bobot model lokal.
4. Studio Agent hanya dijalankan saat dibutuhkan, bukan terus-menerus.

Keempat ADR di atas secara bersamaan membebaskan sumber daya berikut, dengan rincian yang dapat
ditelusuri:

| Dihapus oleh | Item | RAM | Disk |
|---|---|---|---|
| ADR-002 | Android Studio, Gradle, emulator | 8–12 GB | 20–40 GB |
| ADR-006 | PostgreSQL dalam kontainer | 0,3–0,5 GB | ~1 GB |
| ADR-003 | Bobot Whisper Large-v3 | ~3,9 GB saat berjalan | ~3,1 GB |
| ADR-005 | SadTalker, LivePortrait, ffmpeg | belum diukur | beberapa GB |

Angka RAM tidak dijumlahkan langsung karena ketiganya tidak selalu berjalan bersamaan. Yang pasti:
tanpa ADR-002 saja, mesin ini sudah kehabisan memori.

## Risiko yang ditutup

| ID | Risiko | Cara ditutup |
|---|---|---|
| R-11 | Whisper Large-v3 tidak muat di memori | ADR-003 memindahkan ASR ke cloud |
| R-12 | SAM dan Stable Diffusion butuh CUDA | ADR-004 memindahkan generate gambar ke cloud |
| R-13 | SadTalker butuh CUDA | ADR-005 mengganti dengan avatar 2D di browser |
| R-14 | ffmpeg tidak terpasang | ADR-005 menghapus kebutuhan perakitan video |
| R-15 | Toolchain Android tidak tersedia | ADR-002 memakai TWA dari PWA |

## Tinjauan mingguan

Setiap akhir minggu, tiga pertanyaan dijawab tertulis:

1. Apakah ada risiko yang kemungkinannya berubah?
2. Apakah ada mitigasi yang belum dikerjakan padahal tenggatnya lewat?
3. Apakah muncul risiko baru dari pekerjaan minggu ini?

Risiko yang mitigasinya lewat tenggat naik satu tingkat kemungkinan secara otomatis.
