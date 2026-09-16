# Design System KATAVIS

Turunan langsung dari `DESIGN.md`. Dokumen itu menetapkan arah; dokumen ini menetapkan nilainya.
Bila keduanya bertentangan, `DESIGN.md` yang menang.

---

## 1. Token warna

```css
:root {
  /* Permukaan — diturunkan dari material kriya */
  --clay-900: #2E1F17;   /* tanah liat Kasongan setelah dibakar */
  --clay-700: #5A3E2B;   /* kulit samak nabati */
  --clay-200: #E8DCCF;   /* kertas daluang */
  --clay-50:  #FAF6F0;   /* kapas mentah */

  /* Aksi */
  --indigo-800: #1F3A5F; /* indigo celupan ke-7 */
  --indigo-600: #2E5A8A; /* indigo celupan ke-3 — non-teks saja */

  /* Aksen dan status */
  --rattan-500: #B8834A; /* rotan manau kering — teks hanya ≥24px di atas clay-900 */
  --moss-700:   #3D5A3D; /* daun jati muda */
  --rust-700:   #8B3A2F; /* mengkudu */

  /* Peran semantik */
  --bg-page:        var(--clay-50);
  --bg-surface:     var(--clay-200);
  --bg-inverse:     var(--clay-900);
  --text-primary:   var(--clay-900);
  --text-secondary: var(--clay-700);
  --text-inverse:   var(--clay-50);
  --action:         var(--indigo-800);
  --action-hover:   var(--indigo-600);  /* latar tombol, bukan teks */
  --border:         var(--clay-200);
  --border-strong:  var(--clay-700);
  --focus-ring:     var(--indigo-600);
  --success:        var(--moss-700);
  --danger:         var(--rust-700);
  --accent:         var(--rattan-500);  /* border dan fill saja */
}
```

### Aturan pemakaian yang mengikat

| Token | Boleh untuk teks normal? | Alasan |
|---|---|---|
| `--indigo-600` | **Tidak** | 6,62:1 di atas `clay-50`, di bawah ambang AAA 7:1 |
| `--rattan-500` di atas `clay-50` | **Tidak** | 3,06:1 — border dan fill saja |
| `--rattan-500` di atas `clay-900` | Hanya ≥24px | 4,82:1 — memenuhi AAA teks besar |
| `--moss-700` di atas `clay-200` | Hanya ≥24px | 5,71:1 |
| `--rust-700` di atas `clay-200` | Hanya ≥24px | 5,67:1 |

Semua angka terukur oleh `tools/contrast.py`. Menambah warna baru tanpa menjalankan skrip itu
dilarang.

### Dark mode

Belum dirancang. Aturan R-34 menyatakan setiap tema yang dikirim harus benar-benar bekerja.
Membalik nilai terang menjadi gelap akan menghasilkan rasio yang berbeda dan menuntut pengukuran
ulang seluruh tabel.

**Keputusan:** dark mode tidak dikirim pada rilis ini. Menambahkannya setengah jadi lebih merugikan
daripada tidak ada. Bila kelak dibuat, ia diturunkan ulang dari material yang sama dan diuji
kontrasnya sendiri.

## 2. Tipografi

```css
:root {
  --font-ui:    'Inter', system-ui, -apple-system, sans-serif;
  --font-story: 'Lora', Georgia, serif;

  --text-display: 2.25rem;  /* 36px */
  --text-heading: 1.5rem;   /* 24px */
  --text-subhead: 1.25rem;  /* 20px */
  --text-body:    1.125rem; /* 18px — minimum untuk teks tubuh */
  --text-body-lg: 1.25rem;  /* 20px — teks tubuh pada profil Visual */
  --text-small:   1rem;     /* 16px — batas bawah mutlak */

  --leading-tight:   1.2;
  --leading-snug:    1.3;
  --leading-normal:  1.4;
  --leading-label:   1.5;
  --leading-relaxed: 1.6;

  --weight-regular: 400;
  --weight-medium:  500;
  --weight-semibold: 600;
}
```

| Peran | Ukuran | Tinggi baris | Bobot | Typeface |
|---|---|---|---|---|
| Judul halaman | `--text-display` | 1.2 | 600 | Inter |
| Judul bagian | `--text-heading` | 1.3 | 600 | Inter |
| Subjudul | `--text-subhead` | 1.4 | 500 | Inter |
| Teks tubuh | `--text-body` | 1.6 | 400 | Inter |
| Label, caption | `--text-small` | 1.5 | 400 | Inter |
| **Cerita produk** | `--text-body` | 1.6 | 400 | **Lora** |

Lora muncul di satu tempat: blok cerita produk. Kemunculannya di tombol, navigasi, atau label
adalah bug.

Tidak ada ukuran di bawah 16px di seluruh produk. Termasuk footnote dan label input.

## 3. Spasi

```css
:root {
  --space-1: 0.25rem;  /*  4px */
  --space-2: 0.5rem;   /*  8px */
  --space-3: 0.75rem;  /* 12px */
  --space-4: 1rem;     /* 16px */
  --space-6: 1.5rem;   /* 24px */
  --space-8: 2rem;     /* 32px */
  --space-12: 3rem;    /* 48px */
  --space-16: 4rem;    /* 64px */
}
```

Delapan nilai. Angka di luar skala ini tidak dipakai.

## 4. Bentuk dan bayangan

```css
:root {
  --radius-input: 4px;
  --radius-surface: 8px;
  --radius-pill: 999px;   /* badge status saja */

  --shadow-raised: 0 1px 3px rgba(46, 31, 23, 0.12);

  --border-width: 1px;
  --border-width-strong: 2px;
}
```

Tiga radius, satu bayangan. Bayangan hanya untuk permukaan yang benar-benar terangkat: modal,
dropdown, sheet. Kartu statis dipisahkan dengan border, bukan bayangan.

Glassmorphism, neumorphism, dan glow tidak dipakai. Ketiganya menurunkan kontras, dan target
kontras di sini adalah AAA.

## 5. Ukuran target sentuh

```css
:root {
  --touch-min: 56px;         /* seluruh produk */
  --touch-comfortable: 64px; /* aksi utama, profil Visual */
  --touch-motor: 72px;       /* profil Motorik */
  --touch-gap: 8px;          /* jarak antar target */
  --touch-gap-motor: 16px;   /* jarak antar target, profil Motorik */
  --touch-record: 96px;      /* tombol rekam, satu-satunya aksi di layarnya */
}
```

WCAG 2.1 **SC 2.5.5 Target Size adalah Level AAA** dengan ambang 44×44 px. Yang Level AA adalah
SC 2.5.8 (24×24 px), dan itu baru muncul di WCAG 2.2.

Kami memakai **56×56 px — di atas ambang AAA**, karena pengguna sasaran mencakup penyandang
keterbatasan motorik sedangkan 44 px dirancang untuk pengguna umum.

Target yang berdekatan dipisahkan minimal 8 px agar tidak salah tekan.

`--touch-record` 96 px adalah pengecualian sadar terhadap skala. Tombol rekam adalah satu-satunya
elemen interaktif di layarnya, dan harus dapat ditemukan tanpa melihat presisi.

## 6. Status interaktif — enam, bukan tiga

Setiap elemen interaktif wajib memiliki enam tampilan berbeda.

| Status | Tampilan |
|---|---|
| `default` | Latar `--action`, teks `--text-inverse` |
| `hover` | Latar `--action-hover` |
| `focus-visible` | `outline: 3px solid var(--focus-ring); outline-offset: 2px` |
| `active` | Latar `--action`, `transform: translateY(1px)` |
| `disabled` | Latar `--clay-200`, teks `--clay-700`, `cursor: not-allowed` |
| `loading` | Teks diganti label proses + indikator, tombol tidak dapat ditekan |

`outline: none` tanpa pengganti yang lebih terlihat dilarang.

Status `loading` wajib memiliki teks, bukan hanya animasi berputar. "Menyimpan..." memberi informasi;
lingkaran berputar tidak.

## 7. Kaidah komponen

### Tombol

```
Tinggi minimum   56px
Padding          --space-4 horizontal, --space-3 vertikal
Radius           --radius-surface
Label            kata kerja + objek, tidak pernah berdiri sendiri
Ikon             selalu berdampingan teks, tidak pernah sendirian
```

Satu aksi utama per layar. Dua tombol dengan bobot visual setara berarti desainnya perlu ditinjau.

### Input

```
Tinggi minimum   56px
Radius           --radius-input
Border           1px solid --border-strong
Label            selalu terlihat di atas input, tidak pernah hanya placeholder
Error            teks di bawah input + ikon + warna, tidak pernah warna saja
```

Placeholder sebagai satu-satunya label dilarang: ia hilang saat diketik, dan screen reader tidak
memperlakukannya sebagai label.

### Kartu produk

```
Rasio gambar     aspect-[4/5], object-contain, latar --bg-surface
Pemisah          border 1px solid --border, tanpa bayangan
Isi              foto, nama produk, nama pengrajin, status
Urutan fokus     mengikuti urutan visual
```

`object-contain` dipilih, bukan `object-cover`. Produk kriya memiliki proporsi tidak beraturan;
memaksa crop persegi memotong karyanya.

### Status dan notifikasi

Setiap status disampaikan lewat tiga kanal sekaligus:

```
Berhasil:  ikon centang + teks "Foto tersimpan" + warna --success
Gagal:     ikon peringatan + teks penjelasan + warna --danger + langkah berikutnya
Proses:    indikator progres + teks "Membuat katalog... 40%"
```

Warna tidak pernah menjadi satu-satunya pembawa informasi.

## 8. Gerak

```css
:root {
  --duration-fast: 120ms;
  --duration-normal: 200ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

MOTION diatur pada nilai 1 di `DESIGN.md`. Gerak hanya untuk umpan balik status. Tidak ada
scroll-reveal, parallax, atau koreografi.

Satu pengecualian: indikator progres pemrosesan AI boleh beranimasi terus-menerus, karena ia
menyampaikan bahwa sistem masih bekerja. Ia tetap dimatikan di bawah `prefers-reduced-motion`,
diganti dengan angka persentase yang diperbarui.

## 9. Profil Accessibility Mode

Satu tombol, lima profil. Memilih profil mengubah beberapa token sekaligus.

| Profil | Perubahan |
|---|---|
| **Visual** | Teks tubuh naik ke 20px, target ke 64px, TTS aktif otomatis, teks alternatif gambar dibacakan |
| **Pendengaran** | Subtitle aktif otomatis, seluruh notifikasi audio mendapat padanan visual, getar aktif |
| **Motorik** | Target ke 72px, jarak antar target ke 16px, tidak ada interaksi berbatas waktu, konfirmasi ganda untuk aksi merusak |
| **Kognitif** | Satu aksi per layar dipaksakan, bahasa disederhanakan, progres selalu terlihat, tanpa batas waktu |
| **Bantuan suara** | Voice Navigation aktif, seluruh aksi punya padanan perintah suara |

Profil dapat digabung. Pengguna tunarungu dengan keterbatasan motorik memilih keduanya.

Ini mengikuti usulan `Fitur pendukung.pdf` halaman 2: satu tombol Mode Aksesibilitas, bukan
pengaturan yang tersebar.

## 10. Daftar larangan

Diambil dari `DESIGN.md` bagian 10 dan aturan antislop. Melanggarnya membatalkan klaim anti-slop.

- Gradient ungu–biru atau kombinasi apa pun di luar palet material.
- Bento grid.
- Hero dengan bentuk 3D mengambang atau blob gradien.
- Titik status berkedip yang tidak menandai apa pun.
- Tiga kartu fitur berjajar dengan ikon di atas judul di atas satu kalimat.
- Garis aksen berwarna di sisi kiri kartu.
- Jendela terminal palsu sebagai dekorasi.
- Angka statistik tanpa sumber yang dapat ditunjuk.
- Testimoni yang dikarang.
- Tangkapan layar produk yang dibuat-buat untuk slide.
- Ikon tanpa label teks.
- Placeholder sebagai satu-satunya label input.
- `outline: none` tanpa pengganti yang lebih terlihat.
- Warna sebagai satu-satunya pembawa informasi status.
