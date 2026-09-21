# Dokumen Sumber

Seluruh dokumen perencanaan mengutip kedua berkas ini per halaman. Berkasnya disimpan di sini agar
kutipan dapat diverifikasi oleh siapa pun yang membaca repositori, termasuk juri.

| Berkas | Halaman | Peran |
|---|---|---|
| `PROPOSAL-DIGIBOOM-KATAVIS-APHACKATON-2026.pdf` | 14 | Dokumen yang diserahkan ke panitia. Sumber fitur utama, arsitektur, dan klaim teknis. |
| `Fitur-pendukung.pdf` | 9 | Sumber 15 fitur aksesibilitas dan pendukung, beserta urutan prioritasnya. |

Berkas `.txt` adalah hasil ekstraksi teks dengan `pypdf`. Ia memudahkan pencarian dan menunjukkan
nomor halaman. Ekstraksi proposal memecah kata per baris karena tata letak PDF-nya; teks tetap utuh
dan berurutan.

## Cara memverifikasi kutipan

Setiap kutipan dalam dokumen perencanaan menyebut nomor halaman. Penanda `===== PAGE n =====` di
berkas `.txt` menunjukkan batas halaman yang sama.

```powershell
Select-String -LiteralPath "Fitur-pendukung.txt" -Pattern "Pendamping" -Context 3,3
```

## Kutipan yang dipakai dan lokasinya

| Dikutip di | Isi | Sumber |
|---|---|---|
| `PRD.md` bagian 2 | Tiga hambatan struktural | Proposal hal. 2 |
| `PRD.md` bagian 6 | PIN 4–6 digit untuk pengguna kognitif | Fitur pendukung hal. 6 |
| `ARCHITECTURE.md` bagian 6 | Pendamping membantu tanpa mengambil alih | Fitur pendukung hal. 5 |
| `ARCHITECTURE.md` bagian 6 | Larangan pesan galat teknis | Fitur pendukung hal. 6–7 |
| `ADR-005` | Subtitle untuk pengguna tunarungu | Fitur pendukung hal. 4 |
| `ADR-008` | Guided Navigation lima langkah | Fitur pendukung hal. 2–3 |
| `ADR-008` | Posisi KATAVIS sebagai alat kemandirian | Fitur pendukung hal. 8–9 |
| `DESIGN-SYSTEM.md` bagian 9 | Satu tombol Mode Aksesibilitas | Fitur pendukung hal. 2 |
| `FEATURE-SPECS.md` S2 | Kalimat panduan enam langkah | Fitur pendukung hal. 2–3 |

## Angka yang belum diverifikasi ke sumber primer

Proposal hal. 2 menyebut "lebih dari 22,9 juta jiwa" penyandang disabilitas dan "TPAK di bawah 45%",
merujuk BPS dan Kemnaker.

**Angka ini dikutip dari proposal, bukan diverifikasi ulang ke sumber primer.** Sebelum tampil di
slide final, tautan BPS wajib dibuka dan angkanya dicocokkan. Aturan antislop R-17 melarang
menampilkan angka tanpa rujukan yang dapat ditunjuk. Bila tidak dapat diverifikasi, angka dihapus
dari slide.

Tautan yang tercantum di proposal hal. 13–14:
- `https://jakarta.bps.go.id/id/news/2023/01/05/828/disabilitas-dalam-angka.html`
- `https://databoks.katadata.co.id/demografi/statistik/53fb8c7c90f8dc6/`
