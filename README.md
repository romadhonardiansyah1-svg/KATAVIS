# KATAVIS

Katalog digital untuk pengrajin difabel. Foto produk dan cerita suara 30 detik menjadi katalog siap
jual dalam bahasa pasar ekspor.

**Tim Digiboom** — Universitas Nahdlatul Ulama Surabaya
APTIKOM Hackathon (APHACKATON) 2026, babak final

---

## Status

Tahap perencanaan selesai. Implementasi belum dimulai.

## Peta dokumen

Baca berurutan bila baru pertama kali:

| Urutan | Dokumen | Isi |
|---|---|---|
| 1 | [`docs/PRD.md`](docs/PRD.md) | Masalah, pengguna, lingkup, tujuan terukur, dan koreksi terhadap klaim proposal |
| 2 | [`DESIGN.md`](DESIGN.md) | Arah visual. Mengikat seluruh pekerjaan antarmuka. |
| 3 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Komponen, alur data, skema, batas kuota terverifikasi |
| 4 | [`docs/adr/`](docs/adr/) | Delapan keputusan teknis yang menyimpang dari proposal, beserta alasannya |
| 5 | [`docs/spec/FEATURE-SPECS.md`](docs/spec/FEATURE-SPECS.md) | Perilaku yang dapat diuji, per fitur |
| 6 | [`docs/design/DESIGN-SYSTEM.md`](docs/design/DESIGN-SYSTEM.md) | Token siap pakai |
| 7 | [`docs/testing/TEST-PLAN.md`](docs/testing/TEST-PLAN.md) | Enam lapis pengujian |
| 8 | [`docs/ops/ROADMAP.md`](docs/ops/ROADMAP.md) | Delapan minggu dengan gerbang mingguan |
| 9 | [`docs/ops/RISK-REGISTER.md`](docs/ops/RISK-REGISTER.md) | Risiko terurut beserta mitigasinya |
| 10 | [`docs/ops/DEMO-RUNBOOK.md`](docs/ops/DEMO-RUNBOOK.md) | Prosedur hari-H, termasuk saat gagal |

Dokumen sumber ada di [`docs/sources/`](docs/sources/) agar setiap kutipan dapat diverifikasi.

## Kendala yang membentuk seluruh keputusan

Seluruh nilai di bawah diukur langsung pada mesin pengembangan, bukan diperkirakan.

| Kendala | Nilai |
|---|---|
| GPU | Intel Arc iGPU, 2 GB VRAM, **tanpa CUDA** |
| RAM | 15,6 GB total, **1,7 GB bebas** saat diukur |
| Disk | sisa **28,3 GB** |
| ffmpeg | tidak terpasang |
| Toolchain Android | tidak terpasang |

Kendala inilah yang membuat delapan ADR ada. Proposal menyebut SAM, Stable Diffusion, Whisper
Large-v3, SadTalker, dan LivePortrait — kelimanya tidak dapat dijalankan di mesin ini. Setiap
penggantian dicatat beserta alasannya, sehingga dapat dipertanggungjawabkan bila ditanya juri.

## Verifikasi yang dapat dijalankan sekarang

```powershell
python tools/contrast.py
```

Memeriksa 16 pasangan warna terhadap tabel di `DESIGN.md`, dan keluar dengan kode 1 bila ada yang
menyimpang atau turun di bawah tingkat WCAG yang dijanjikan. Ini gerbang TC-A11Y-02.

## Aturan yang mengikat

**Setiap angka punya sumber.** Angka yang belum diukur ditandai sebagai belum diukur, bukan
ditebak. Ini berlaku untuk dokumen maupun slide presentasi.

**Antislop terpasang** di `.agents/skills/` — enam skill, 38 aturan. `DESIGN.md` menyediakan arah
desain yang diwajibkan R-37; benturan dicatat di `docs/design/overrides.md`.

**Demo tidak boleh bergantung pada satu penyedia.** Setiap antarmuka penyedia AI punya minimal dua
implementasi, dan fallback-nya diuji, bukan diasumsikan.
