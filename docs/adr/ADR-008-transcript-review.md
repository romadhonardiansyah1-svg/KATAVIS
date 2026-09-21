# ADR-008 — Tinjau transkrip wajib sebelum pemrosesan LLM

**Status** Diterima · **Tanggal** 15 September 2026
**Menyimpang dari proposal** Tidak — langkah tambahan

## Konteks

Proposal bagian 2.1 menggambarkan alur otomatis penuh: rekam suara, ASR mentranskripsi, LLM
menyusun copywriting. Tidak ada langkah manusia di antaranya.

`Fitur pendukung.pdf` halaman 2–3 mengusulkan Guided Navigation lima langkah, dengan langkah 4
berbunyi "Periksa Hasil — Apakah katalog sudah sesuai?". Pemeriksaan ada, tetapi setelah seluruh
pipeline selesai.

Masalahnya terletak pada kualitas ASR Bahasa Indonesia:

- Tidak ada penyedia yang mengklaim dukungan dialek daerah Indonesia.
- AssemblyAI menempatkan bahasa Jawa pada kelompok WER di atas 50%, dan tidak memberi peringkat
  untuk Sunda.
- Pengguna sasaran adalah pengrajin di daerah, yang besar kemungkinan bertutur dengan aksen kuat
  dan menyebut istilah kriya lokal.
- Angka WER Bahasa Indonesia untuk Whisper tidak ditemukan di sumber mana pun. Open ASR Leaderboard
  HuggingFace hanya menguji bahasa Inggris.

## Keputusan

Sisipkan satu layar antara ASR dan LLM: **transkrip ditampilkan untuk ditinjau dan dikoreksi
pengrajin sebelum diteruskan.**

Alur menjadi enam langkah:

```
1. Foto Produk
2. Rekam Cerita
3. Periksa Transkrip     <- langkah baru
4. Sistem Memproses
5. Periksa Hasil
6. Terbitkan
```

Layar tinjau transkrip menyediakan:
- Teks hasil transkripsi dengan ukuran besar dan dapat disunting.
- Tombol "Rekam ulang" bila hasilnya terlalu jauh melenceng.
- Tombol "Sudah benar, lanjutkan" sebagai aksi utama.
- Pembacaan transkrip lewat TTS untuk pengguna yang tidak dapat membaca layar.

## Alasan

**Galat ASR yang lolos akan berlipat ganda.** Satu nama produk yang salah transkrip akan muncul di
cerita, spesifikasi, caption media sosial, kata kunci SEO, dan lima bahasa terjemahan. Memperbaiki
di hilir berarti menyunting belasan bidang. Memperbaiki di hulu berarti menyunting satu kalimat.

**Ini memberi pengrajin kendali, bukan menambah beban.** `Fitur pendukung.pdf` halaman 8–9
memposisikan KATAVIS sebagai alat kemandirian. Sistem yang mengarang nama produk yang salah dan
menerbitkannya tanpa persetujuan justru melemahkan kemandirian itu.

**Ia tidak melanggar tujuan "tanpa mengetik".** Langkah ini opsional untuk disunting — pengrajin
dapat menekan "Sudah benar" tanpa mengetik apa pun. Yang wajib adalah melihat, bukan mengubah.
Untuk pengguna tunanetra, TTS membacakan transkrip dan konfirmasi dilakukan lewat suara.

**Ia menyelamatkan demo.** Bila ASR salah mendengar saat presentasi, presenter dapat memperbaiki
dalam dua detik di layar ini, dan demo berlanjut. Tanpa langkah ini, kesalahan mengalir ke seluruh
keluaran dan terlihat oleh juri.

## Konsekuensi

Positif:
- Galat dihentikan di hulu.
- Kualitas keluaran LLM meningkat karena masukannya lebih bersih.
- Pengrajin melihat bukti bahwa suaranya didengar dengan benar — ini membangun kepercayaan pada
  sistem.
- Jaring pengaman saat demo.

Negatif:
- Menambah satu langkah pada alur yang dirancang seminimal mungkin. **Mitigasi:** langkah ini
  ringan, satu layar, satu tombol utama, dan tidak menuntut pengetikan.
- Menambah waktu total. Pada sasaran di bawah tiga menit, satu layar konfirmasi tidak signifikan.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| Otomatis penuh seperti proposal | Galat ASR merusak seluruh keluaran dalam lima bahasa tanpa terdeteksi. |
| Tinjau hanya bila keyakinan ASR rendah | Terdengar cerdas, tetapi skor keyakinan tidak andal mendeteksi nama diri yang salah — justru kesalahan yang paling merugikan. |
| Tinjau setelah LLM saja | Sudah ada di langkah 5, tetapi terlambat: pengrajin harus menyunting belasan bidang alih-alih satu kalimat. |
