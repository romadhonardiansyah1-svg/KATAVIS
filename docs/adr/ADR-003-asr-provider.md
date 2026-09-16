# ADR-003 — Groq Whisper large-v3-turbo, bukan Whisper Large-v3 lokal

**Status** Diterima · **Tanggal** 15 September 2026
**Menyimpang dari proposal** Ya — bagian 4.1

## Konteks

Proposal bagian 4.1 menyebut "Whisper Large-v3 untuk ASR". Fitur Voice-to-Story bergantung penuh
pada transkripsi Bahasa Indonesia yang akurat dari rekaman 30 detik.

Kendala terukur:

| Model | Memori runtime | Muat di 1,7 GB bebas? |
|---|---|---|
| whisper tiny | ~273 MB | Ya |
| whisper base | ~388 MB | Ya |
| whisper small | ~852 MB | Ya |
| whisper medium | ~2,1 GB | Tidak |
| **whisper large-v3** | **~3,9 GB** | **Tidak** |

Angka dari tabel memori resmi whisper.cpp untuk model non-terkuantisasi.

## Keputusan

**Utama:** Groq `whisper-large-v3-turbo` lewat API.
**Cadangan:** Cloudflare Workers AI `@cf/openai/whisper-large-v3-turbo`.

Tidak ada inferensi ASR lokal pada jalur produksi.

## Alasan

### Kandidat yang gugur karena tidak mendukung Bahasa Indonesia

Ini temuan yang membatalkan sebagian besar model yang biasa disebut sebagai pengganti Whisper:

| Model | Bahasa | Indonesia? | Bukti |
|---|---|---|---|
| NVIDIA Parakeet-TDT-0.6B-v3 | 25 Eropa | **Tidak** | Daftar eksplisit di model card: bg, cs, da, de, el, en, es, et, fi, fr, hr, hu, it, lt, lv, mt, nl, pl, pt, ro, ru, sk, sl, sv, uk |
| NVIDIA Canary-1B-v2 | 25 Eropa | **Tidak** | Daftar sama; juga menuntut minimal 6 GB RAM |
| Moonshine tiny/base | English-only | **Tidak** | Kolom "Multilingual" kosong di model card |
| Kyutai STT | EN, EN+FR | **Tidak** | Hanya dua varian model |
| Mistral Voxtral-Mini-3B | 8 Eropa | **Tidak** | en, es, fr, pt, hi, de, nl, it |
| AssemblyAI Universal-3.5 Pro | 18 | **Tidak** | Daftar bahasa resmi |
| Meta SeamlessM4T-v2 | 101 | Ya | Gugur: lisensi CC-BY-NC (non-komersial) dan ~9 GB |

Yang tersisa dan mendukung Bahasa Indonesia adalah keluarga Whisper (99 bahasa). Maka pilihannya
bukan "Whisper atau yang lebih baik", melainkan "Whisper di mana".

### Mengapa Groq, bukan Cloudflare, sebagai yang utama

| Penyedia | Kuota gratis harian | Setara klip 30 detik |
|---|---|---|
| **Groq whisper-large-v3-turbo** | **28.800 detik audio** | **~960 klip** |
| Cloudflare `@cf/openai/whisper-large-v3-turbo` | 10.000 Neurons (46,63 N/menit) | ~429 klip |

Groq memberi lebih dari dua kali lipat, dan kuotanya terpisah dari 10.000 Neurons Cloudflare yang
juga dibutuhkan untuk generate gambar. Memakai Cloudflare untuk ASR berarti mengambil jatah yang
diperlukan fitur lain.

Keduanya menjalankan model yang sama, sehingga fallback tidak menurunkan kualitas.

## Konsekuensi

Positif:
- Nol beban RAM dan GPU pada mesin pengembangan.
- Kualitas large-v3-turbo, bukan `small` yang terpaksa dipakai bila lokal.
- Dua penyedia dengan model identik.

Negatif:
- Membutuhkan internet. Ini konsisten dengan keputusan arsitektur lain yang memakai D1 dan R2.
- Audio pengguna dikirim ke pihak ketiga. **Mitigasi:** persetujuan eksplisit sebelum merekam,
  dan rekaman mentah dihapus setelah transkripsi berhasil.
- Batas 20 permintaan/menit pada Groq. Cukup untuk demo; menjadi masalah pada beban nyata.

### Batas akurasi yang wajib diketahui tim

AssemblyAI menempatkan bahasa Jawa pada kelompok WER di atas 50%, dan tidak memberi peringkat untuk
Sunda. Tidak ada penyedia yang mengklaim dukungan dialek daerah Indonesia.

Artinya: Bahasa Indonesia baku beraksen daerah akan tertranskripsi layak; campur kode dengan bahasa
daerah akan kacau. Ini konsekuensi nyata untuk pengguna sasaran.

Dua mitigasi:
1. Layar tinjau transkrip wajib — lihat ADR-008.
2. Skrip narasi demo memakai Bahasa Indonesia baku.

**Angka WER Bahasa Indonesia untuk Whisper tidak ditemukan** dalam sumber mana pun. Open ASR
Leaderboard HuggingFace hanya menguji bahasa Inggris. Karena itu klaim akurasi apa pun tidak boleh
masuk slide sebelum tim mengukurnya sendiri dengan rekaman nyata.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| whisper.cpp `small` lokal | Muat di memori dan bekerja luring, tetapi kualitas di bawah turbo dan waktu proses CPU belum terukur. Disimpan sebagai opsi luring bila mode offline penuh dibutuhkan. |
| Web Speech API browser | Nol biaya, tetapi hanya Chrome, menuntut internet, dan akurasi Bahasa Indonesia tidak dapat dikendalikan maupun diukur. |
| ElevenLabs Scribe v2 | Satu-satunya yang menempatkan Indonesia pada kelompok WER ≤5%. Berbayar tanpa kuota gratis yang terverifikasi. Dicatat sebagai opsi bila akurasi menjadi penghambat. |
| Whisper Large-v3 lokal seperti proposal | Butuh ~3,9 GB memori runtime; tersedia 1,7 GB. Tidak muat. |
