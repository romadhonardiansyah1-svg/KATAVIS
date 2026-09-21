# ADR-001 — Modular monolith di Workers, bukan microservices

**Status** Diterima · **Tanggal** 15 September 2026
**Menyimpang dari proposal** Ya — bagian 4.2

## Konteks

Proposal bagian 4.2 menyatakan sistem memakai "konsep microservices dan event-driven architecture,
di mana setiap layanan memiliki tanggung jawab yang berbeda namun tetap terhubung melalui API dan
task queue." Ia juga menyebut FastAPI (Python) *dan* Node.js Microservices *dan* Redis secara
bersamaan.

Kondisi nyata yang mengikat:

- Satu pengembang utama mengerjakan hampir seluruh sistem.
- RAM bebas terukur 1,7 GB dari total 15,6 GB. Menjalankan FastAPI + Node + Redis + PostgreSQL
  bersamaan di mesin pengembangan tidak muat.
- Penilaian final adalah demo langsung. Sistem yang tidak selesai bernilai nol, seelegan apa pun
  arsitekturnya.

## Keputusan

Satu Cloudflare Worker dengan tujuh modul yang batasnya tegas: `auth`, `rbac`, `catalog`, `media`,
`jobs`, `export`, `audit`. Satu bahasa (TypeScript). Komunikasi antar modul lewat pemanggilan fungsi
langsung, bukan HTTP.

Pekerjaan asinkron tetap event-driven lewat Cloudflare Queues, sesuai semangat proposal.

Satu proses terpisah: **Studio Agent** di laptop. Ia terpisah bukan karena selera arsitektur,
melainkan karena kendala teknis mutlak — otomasi Chrome tidak dapat berjalan di isolat V8 Workers.

## Alasan

**Batas modul dipertahankan sama dengan batas layanan di proposal.** Setiap modul punya berkas
masuk sendiri, tidak mengimpor bagian dalam modul lain, dan hanya memakai antarmuka publik. Bila
kelak dipecah menjadi layanan terpisah, batasnya sudah ada. Yang berubah hanya mekanisme pemanggilan.

**Redis tidak diperlukan.** Proposal memakai Redis untuk antrian dan cache. Cloudflare Queues
menggantikan antrian, dan Cache API Workers menggantikan cache. Menambahkan Redis berarti menambah
proses yang memakan RAM yang tidak tersedia, untuk menyelesaikan masalah yang sudah terselesaikan.

**Dua bahasa menjadi satu.** FastAPI + Node.js berarti dua ekosistem, dua pipeline build, dua set
dependensi, dua cara menguji. Untuk satu pengembang dengan tenggat, itu biaya tanpa imbalan.

## Konsekuensi

Positif:
- Satu perintah deploy, satu berkas log, satu tempat mencari kesalahan.
- Tidak ada kegagalan jaringan antar layanan yang harus ditangani.
- Nol biaya RAM di mesin pengembangan untuk layanan yang menetap.

Negatif:
- Tidak bisa menskalakan satu modul secara terpisah. Tidak relevan pada skala saat ini.
- Batas modul dijaga oleh disiplin, bukan oleh jaringan. **Mitigasi:** aturan lint yang melarang
  impor lintas-internal modul, diuji di CI. Disiplin yang tidak diuji akan runtuh.

Untuk presentasi: bila juri menanyakan microservices, jawaban jujurnya adalah batas layanan sudah
dirancang dan dipertahankan, sedangkan pemecahan fisik ditunda sampai ada beban yang menuntutnya.
Memecah lebih awal tanpa kebutuhan adalah biaya, bukan prestasi.

## Alternatif yang ditolak

| Alternatif | Alasan ditolak |
|---|---|
| Microservices penuh seperti proposal | Tidak akan selesai oleh satu pengembang sebelum final. Risiko terbesar proyek ini adalah tidak selesai, bukan tidak terskalakan. |
| FastAPI terpisah untuk pipeline AI | Menambah bahasa kedua dan proses yang menetap. Panggilan penyedia AI adalah HTTP biasa yang tidak menuntut Python. |
| Monolith tanpa batas modul | Menghemat waktu di awal, tetapi menghilangkan kemampuan menjelaskan arsitektur ke juri dan membuat pemecahan kelak menjadi penulisan ulang. |
