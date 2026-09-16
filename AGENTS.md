# AGENTS.md — Aturan Proyek KATAVIS

Dibaca otomatis setiap sesi. Baca ini sebelum menulis kode apa pun.

---

## Apa ini

KATAVIS mengubah foto produk dan rekaman suara 30 detik menjadi katalog digital siap jual.
Penggunanya pengrajin difabel dan pendamping SLB. Untuk lomba APTIKOM Hackathon 2026, babak final.

**Penilaian berupa demo langsung.** Konsekuensinya: kode yang berjalan andal mengalahkan kode yang
elegan tetapi rapuh.

## Baca sebelum mulai

| Kalau Anda mengerjakan | Baca dulu |
|---|---|
| Apa pun | `docs/PRD.md`, file ini |
| Endpoint atau pemanggilan API | `docs/spec/API-CONTRACT.md` — **mengikat, jangan mengarang bentuk** |
| Antarmuka | `DESIGN.md` lalu `docs/design/DESIGN-SYSTEM.md` |
| Basis data | `docs/ARCHITECTURE.md` bagian 6, `migrations/` |
| Pengujian | `docs/testing/TEST-PLAN.md` |
| Kenapa teknologi X bukan Y | `docs/adr/` |

## Kendala keras — tidak dapat dinegosiasikan

Diukur langsung pada mesin pengembangan:

```
GPU     Intel Arc iGPU, 2 GB VRAM, TANPA CUDA
RAM     15,6 GB total, 1,7 GB bebas
Disk    sisa 28,3 GB
ffmpeg  tidak terpasang
```

**Jangan pernah menyarankan atau menulis kode yang membutuhkan:** CUDA, PyTorch lokal, Stable
Diffusion lokal, SAM, SadTalker, LivePortrait, Whisper lokal di atas ukuran `small`, PostgreSQL,
Redis, Docker pada jalur data, atau Android Studio.

Lima hal pertama disebut di proposal asli. Kelimanya tidak dapat dijalankan di sini. Alasannya di
ADR-003, ADR-004, ADR-005.

## Perintah

```powershell
pnpm install
pnpm run dev              # Next.js di :3000
pnpm run dev:worker       # Worker di :8787
pnpm run db:migrate:local # migrasi D1 lokal

pnpm run verify           # typecheck + lint + unit + kontras + rujukan
pnpm run test             # unit
pnpm run test:integration # workerd asli dengan D1 dan R2
pnpm run test:e2e         # Playwright
```

Jalankan `pnpm run verify` sebelum menyatakan pekerjaan selesai. Bukan setelah ditanya.

## Struktur

```
worker/        Cloudflare Worker, tujuh modul dengan batas tegas
  auth/        OTP, sesi, PIN
  rbac/        peran, izin, akses pendamping      <- KRITIS
  catalog/     produk, draf, versi
  media/       URL bertanda tangan, unggah
  jobs/        siklus hidup pekerjaan AI          <- KRITIS
  export/      PDF, feed, halaman publik
  audit/       log aktivitas
app/           Next.js App Router (PWA)
components/    Komponen UI
lib/           Utilitas bersama
agent/         Studio Agent, Node.js di laptop   <- KRITIS
migrations/    Migrasi D1
e2e/           Playwright
tools/         Skrip verifikasi Python
docs/          Seluruh dokumen perencanaan
```

### Batas modul

Modul tidak mengimpor bagian dalam modul lain. Hanya lewat `index.ts` masing-masing.

```ts
import { canEditDraft } from "@worker/rbac";           // benar
import { checkPerm } from "@worker/rbac/internal/x";   // dilarang
```

Ditegakkan `eslint-plugin-boundaries`, bukan disiplin. ADR-001 menjelaskan alasannya.

---

## Aturan yang paling sering dilanggar

### 1. Batas 50 kueri D1 per invocation

D1 paket gratis mengizinkan **50 kueri per invocation Worker**, bukan 1000 seperti paket berbayar.

```ts
// DILARANG — pola N+1, akan menembus batas
for (const product of products) {
  const media = await db.prepare("SELECT * FROM media_assets WHERE product_id = ?")
    .bind(product.id).first();
}

// BENAR — satu kueri berkelompok
const results = await db.batch(statements);
```

Ambang pengujian 25 kueri, memberi ruang aman. TC-PERF-04.

### 2. Pesan galat tidak pernah memuat istilah teknis

Setiap galat yang sampai ke pengrajin wajib memuat tiga hal: apa yang terjadi, apakah pekerjaannya
aman, dan langkah berikutnya.

```ts
// DILARANG
throw new Error("Failed to generate image: 500 Internal Server Error");

// BENAR
return apiError("IMAGE_GENERATE_FAILED");
// -> { code, message: "Foto studio belum berhasil dibuat. Foto asli Anda
//      tetap tersimpan.", action: "RETRY_OR_USE_ORIGINAL", workSafe: true }
```

Daftar lengkap di `docs/spec/API-CONTRACT.md` bagian 12. Menambah kode baru berarti menambah
barisnya di sana lebih dulu.

**Seluruh galat bernilai `workSafe: true`.** Ini invarian: kegagalan apa pun tidak boleh
menghilangkan pekerjaan pengguna. Kalau Anda perlu `workSafe: false`, itu pertanda cacat rancangan.

### 3. Otorisasi hanya di server

```ts
// DILARANG — peran dari klien
if (request.body.role === "admin") { }

// BENAR — peran dari token terverifikasi
const user = await verifyToken(request);
if (!canPublish(user, product)) return apiError("FORBIDDEN");
```

Pemeriksaan di frontend adalah pengalaman pengguna, bukan keamanan.

### 4. Pencabutan akses pendamping harus seketika

Mengubah `status = 'revoked'` saja **tidak cukup**. Token lama masih sah sampai kedaluwarsa.

Naikkan `users.token_version` dan periksa nilainya pada setiap permintaan. Ini pengujian keamanan
terpenting di sistem: TC-I-04, TC-SEC-16, TC-E2E-05.

### 5. Setiap penyedia AI punya fallback

Tidak boleh ada satu penyedia pun yang, bila mati, menghentikan demo.

```ts
// Rantai wajib, urutan tetap:
// Gambar : GeminiWeb (45s) -> WorkersAI -> Cache
// ASR    : Groq -> WorkersAI
// Teks   : 9router -> WorkersAI
```

Fallback diuji, bukan diasumsikan. TC-E2E-10 sampai TC-E2E-13.

### 6. Aksesibilitas bukan lapisan tambahan

```
Target sentuh minimum  56x56 px    (bukan 44)
Teks tubuh minimum     18 px       (bukan 16)
Kontras                7:1 AAA
Ikon                   selalu berdampingan label teks
Status                 tidak pernah disampaikan lewat warna saja
Fokus                  outline 3px, tidak pernah `outline: none`
```

Menambah warna baru menuntut menjalankan `python tools/contrast.py` — dan skrip itu akan gagal
bila angkanya tidak cocok dengan `DESIGN.md`.

### 7. Foto asli tidak pernah ditimpa

Generate gambar menghasilkan aset baru. Kegagalan generate mempertahankan foto pengrajin.
TC-E2E-13.

---

## Desain — antislop aktif

Enam skill antislop terpasang di `.agents/skills/`. `DESIGN.md` adalah arah desain yang diwajibkan
R-37.

Dilarang keras:
- Gradient ungu–biru atau warna di luar palet material
- Bento grid
- Bentuk 3D mengambang, blob gradien
- Tiga kartu fitur berjajar dengan ikon di atas judul di atas satu kalimat
- Titik status berkedip yang tidak menandai apa pun
- Garis aksen berwarna di sisi kiri kartu
- Angka statistik tanpa sumber, testimoni yang dikarang
- Ikon tanpa label teks

Daftar lengkap di `DESIGN.md` bagian 10.

Dial liveliness: **ENERGY 2, RHYTHM 1, MOTION 1**. Berlaku dari layar pertama sampai terakhir.

## Menulis kode

- TypeScript strict. Tanpa `any`, tanpa `@ts-ignore`.
- Validasi di batas aplikasi dengan Zod. Data dari luar tidak pernah dipercaya.
- Nama menjelaskan isi. Bukan `data`, `result`, `temp`, `item`.
- Komentar menjelaskan **mengapa**, bukan apa. Kode yang jelas tidak butuh komentar.
- Tanpa abstraksi spekulatif. Tambahkan lapisan hanya bila ada konsumen nyata sekarang.
- `catch` yang menelan galat tanpa penanganan dilarang.

## Menulis pengujian

Setiap perilaku di `docs/spec/FEATURE-SPECS.md` punya ID kasus uji. Cantumkan ID-nya:

```ts
it("menolak pendamping yang aksesnya sudah dicabut", () => {
  // TC-U-RBAC-05
});
```

`python tools/check_refs.py` memeriksa setiap ID yang dirujuk benar-benar terdefinisi.

Jangan melemahkan pengujian agar lolos. Jangan menghapus pengujian yang gagal.

## Yang tidak boleh dilakukan tanpa bertanya

- Menambah dependensi baru
- Mengubah `docs/spec/API-CONTRACT.md`
- Mengubah skema basis data
- Mengubah token di `DESIGN.md`
- Menurunkan ambang cakupan pengujian
- Menambah kode galat baru
- Mematikan aturan lint

## Rahasia

Tidak ada kunci API di repositori. Gunakan `.dev.vars` lokal dan `wrangler secret put` untuk
produksi. `.env.example` memuat nama variabel, tidak pernah nilainya.

Profil Chrome Studio Agent memuat sesi login Google dan diabaikan git.

## Saat ragu

1. Cek `docs/spec/API-CONTRACT.md` untuk bentuk API
2. Cek `docs/adr/` untuk alasan suatu keputusan
3. Cek `docs/testing/TEST-PLAN.md` untuk perilaku yang diharapkan
4. Bertanya, jangan menebak

Menebak bentuk API menghasilkan frontend dan backend yang tidak cocok. Itu biaya yang jauh lebih
besar daripada satu pertanyaan.
