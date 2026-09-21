# ADR-005 — Avatar 2D dengan TTS dan subtitle, bukan SadTalker/LivePortrait

**Status** Diterima · **Tanggal** 15 September 2026
**Menyimpang dari proposal** Ya — bagian 4.1

## Konteks

Proposal bagian 4.1 menyebut "SadTalker / LivePortrait Engine untuk sinkronisasi bibir dan video
presenter". Fitur Talking-Catalog & AI Avatar bergantung padanya.

Kendala terukur:

| Kebutuhan | Tersedia |
|---|---|
| SadTalker/LivePortrait menuntut CUDA | Intel Arc iGPU, **tanpa CUDA** |
| Perakitan video menuntut ffmpeg | **ffmpeg tidak terpasang** |
| Bobot model beberapa GB | Sisa disk 28,3 GB, sudah diperebutkan |

## Keputusan

Avatar 2D berbasis SVG dengan gerak mulut yang digerakkan amplitudo audio, dipasangkan dengan
sintesis suara dan subtitle tersinkronisasi. Dirender di browser, bukan sebagai berkas video.

Komponen:
- Karakter SVG dengan beberapa bentuk mulut, dipilih berdasar amplitudo audio per bingkai.
- TTS untuk menarasikan cerita produk.
- Subtitle yang menyorot kalimat yang sedang dibacakan.
- Kendali putar, jeda, ulang yang dapat dijangkau keyboard.

## Alasan

**Kendala CUDA bersifat mutlak.** SadTalker dan LivePortrait tidak akan berjalan, sekeras apa pun
usahanya. Ini bukan penyesuaian preferensi.

**Untuk pengguna sasaran, subtitle lebih bernilai daripada wajah realistis.** `Fitur pendukung.pdf`
halaman 4 menempatkan Subtitle & Visual Indicator sebagai kebutuhan pengguna tunarungu. Wajah
realistis yang berbicara tidak memberi mereka apa pun; subtitle akurat memberi segalanya.

**Rendering di browser menghapus seluruh pipeline video.** Tanpa ffmpeg, tanpa penyimpanan berkas
video di R2, tanpa pekerjaan perakitan yang bisa gagal. Yang disimpan hanya audio TTS dan berkas
waktu subtitle — beberapa ratus kilobyte, bukan puluhan megabyte.

**Ia tidak pernah gagal saat demo.** Tidak ada panggilan jaringan ke layanan avatar, tidak ada
antrian render, tidak ada batas kuota.

## Konsekuensi

Positif:
- Nol ketergantungan GPU dan nol ketergantungan ffmpeg.
- Konsumsi R2 jauh lebih kecil, penting dengan batas 10 GB gratis.
- Dapat diputar ulang seketika tanpa render ulang.
- Aksesibilitas lebih baik: teks adalah teks nyata yang dapat dibaca screen reader, bukan piksel
  di dalam video.

Negatif — dinyatakan jujur:
- **Tidak ada wajah manusia realistis.** Bila juri mengharapkan avatar seperti HeyGen, ini terlihat
  lebih sederhana. Pembelaan yang jujur: produk ini melayani pengguna tunarungu dan tunanetra, dan
  avatar realistis tidak melayani keduanya. Keterbacaan dan keandalan dipilih di atas kesan visual.
- Gerak mulut berbasis amplitudo lebih kasar daripada lip-sync berbasis fonem. Tidak akan menipu
  siapa pun sebagai manusia — dan memang tidak dimaksudkan demikian.

**Konsistensi dengan proposal:** nama fitur tetap "Talking-Catalog & AI Avatar", dan fungsinya tetap
"menarasikan filosofi produk kriya secara dinamis di halaman landing page" persis seperti tertulis
di proposal bagian 2.2. Yang berubah adalah mesin di baliknya.

## Keputusan terbuka

Penyedia TTS Bahasa Indonesia belum ditetapkan. Kandidat: Web Speech API browser (gratis, kualitas
bervariasi antar perangkat) atau layanan cloud. Diputuskan pada Minggu 4 setelah mendengarkan
keluaran nyata, bukan berdasar klaim pemasaran. Tercatat sebagai O4 di `docs/ARCHITECTURE.md`.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| SadTalker/LivePortrait seperti proposal | Menuntut CUDA. Tidak tersedia. |
| Sewa GPU cloud untuk SadTalker | Biaya berjalan, waktu penyiapan besar, dan menambah titik gagal saat demo untuk imbalan yang tidak melayani pengguna sasaran. |
| API avatar pihak ketiga (HeyGen, D-ID) | Kuota gratis sangat terbatas, ada watermark, dan menambah ketergantungan jaringan pada jalur demo. |
| Slideshow sinematik dengan voiceover | Tampak profesional, tetapi menghapus elemen "avatar" yang disebut nama fiturnya di proposal. |
