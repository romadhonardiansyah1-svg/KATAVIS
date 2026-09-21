# ADR-002 — Android lewat TWA, bukan Kotlin native

**Status** Diterima · **Tanggal** 15 September 2026
**Menyimpang dari proposal** Tidak — proposal menyebut PWA

## Konteks

Tim berencana mengirim aplikasi Android selain versi web. Pertanyaannya: Kotlin native lewat
Android Studio, React Native, atau membungkus PWA menjadi Trusted Web Activity.

Kondisi terukur pada mesin pengembangan:

| Fakta | Nilai |
|---|---|
| `adb` | tidak terpasang |
| `java --version` | gagal — JDK tidak tersedia |
| RAM total / bebas | 15,6 GB / 1,7 GB |
| Sisa disk C: | 28,3 GB |

Proposal bagian 2.1 dan 4.1 menyebut "Web/Progressive Web Application (PWA)" sebagai klien.
Bagian 4.2 menyebut aktor memakai "aplikasi mobile atau PWA".

## Keputusan

Satu basis kode PWA Next.js, dibungkus menjadi APK dengan Bubblewrap sebagai Trusted Web Activity.

## Alasan

**Konsistensi dengan dokumen yang sudah diserahkan.** Juri memegang proposal yang menyebut PWA.
Mengirim aplikasi Kotlin justru menciptakan pertanyaan yang harus dijelaskan, bukan nilai tambah.

**Anggaran memori.** Android Studio dengan Gradle daemon dan emulator membutuhkan 8–12 GB. Itu
harus berjalan bersamaan dengan Next.js dev server, Wrangler, dan Chrome untuk Studio Agent. Dengan
15,6 GB total, mesin akan tersendat dan siklus pengembangan melambat drastis.

**TWA tetap menghasilkan APK asli.** Berkas `.apk` yang dapat dipasang dan ditunjukkan ada.
Ini bukan "sekadar web yang dibuka di browser".

**Satu basis kode.** Perbaikan aksesibilitas ditulis sekali dan berlaku di web maupun Android.
Dengan Kotlin, setiap perbaikan dikerjakan dua kali.

## Konsekuensi

Positif:
- Nol biaya pemeliharaan basis kode kedua.
- Pembaruan aplikasi tidak memerlukan pemasangan ulang APK.
- Tidak ada toolchain Android yang perlu dipasang sama sekali sampai tahap pembuatan APK.

Negatif — dinyatakan jujur:
- **TalkBack pada WebView tidak sebaik pada komponen native Android.** Ini kerugian nyata untuk
  produk yang menargetkan pengguna tunanetra. Mitigasi: struktur ARIA yang benar, diuji langsung
  dengan TalkBack di perangkat fisik, bukan hanya axe-core. Diuji di TC-A11Y-21.
- Akses kamera lewat `getUserMedia` memberi kontrol lebih terbatas daripada Camera2 API. Untuk
  kebutuhan memotret produk diam, ini cukup.
- Getar untuk notifikasi multimodal bergantung Vibration API, yang tidak tersedia di iOS Safari.
  Untuk target Android, tersedia.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| Kotlin native | TalkBack terbaik, tetapi menuntut basis kode kedua, toolchain 20–40 GB, dan 8–12 GB RAM yang tidak tersedia. Untuk penilaian berbasis demo, tidak menambah nilai yang terlihat. |
| React Native / Expo | Tetap basis kode terpisah dengan sebagian besar kerugian Kotlin, tanpa keunggulan aksesibilitas native penuh. |
| PWA tanpa APK | Menghemat waktu, tetapi tidak ada berkas yang bisa diserahkan atau dipasang juri. |

## Pemicu peninjauan ulang

Keputusan ini ditinjau ulang bila pengujian TalkBack pada perangkat fisik menunjukkan hambatan yang
tidak dapat diperbaiki lewat ARIA. Dalam kasus itu, opsi yang dipertimbangkan adalah lapisan native
tipis hanya untuk alur yang bermasalah — bukan penulisan ulang seluruh aplikasi.
