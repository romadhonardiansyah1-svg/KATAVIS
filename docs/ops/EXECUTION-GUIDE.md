# Panduan Eksekusi Agen — KATAVIS

Langkah-langkah untuk mengerjakan seluruh proyek dari awal sampai akhir.
Setiap langkah berisi prompt siap tempel ke agen coding Anda.

---

## Sebelum mulai

### 1. Isi `.dev.vars`

Salin `.env.example` menjadi `.dev.vars` dan isi nilainya:

```powershell
Copy-Item .env.example .dev.vars
# Buka .dev.vars, isi minimal:
#   JWT_SIGNING_KEY   -> node -e "console.log(crypto.randomBytes(32).toString('base64'))"
#   GROQ_API_KEY      -> https://console.groq.com/keys
#   NINEROUTER_API_KEY -> dari 9router Anda
#   AGENT_SHARED_KEY  -> node -e "console.log(crypto.randomBytes(16).toString('hex'))"
```

### 2. Aturan prompt agen

Setiap kali membuka sesi baru, awali dengan:

```
Baca AGENTS.md dulu sebelum menulis kode apa pun.
Working directory: C:\Projet dian\KATAVIS
```

### 3. Urutan pengerjaan

Ikuti urutan ini. Jangan lompati. Setiap langkah bergantung pada langkah sebelumnya.

```
FRONTIER (model terbaik):
  1. worker/rbac         <- keamanan, tidak boleh salah
  2. worker/jobs          <- penyelamat demo, race condition
  3. worker/auth          <- OTP, PIN, token
  4. Lapisan kueri D1     <- batas 50 kueri
  5. worker/media         <- validasi, URL bertanda tangan

MENENGAH:
  6. worker/catalog       <- CRUD produk + transkrip
  7. worker/audit         <- log aktivitas
  8. Alur 6 langkah (frontend)
  9. Accessibility Mode
  10. Talking-Catalog

BIASA:
  11. worker/export       <- PDF, CSV
  12. Halaman publik
  13. Studio Agent (agent/)  <- frontier kalau Gemini aktif
  14. TWA / APK
```

---

## LANGKAH 1 — `worker/rbac` (FRONTIER)

**Sesi baru. Tempel prompt ini apa adanya:**

```
Baca AGENTS.md dulu.

Lalu baca berurutan:
1. docs/ARCHITECTURE.md bagian 6
2. docs/spec/FEATURE-SPECS.md bagian S3
3. docs/spec/API-CONTRACT.md bagian 9
4. docs/testing/TEST-PLAN.md bagian 3 (modul rbac)
5. docs/ops/MODEL-ROUTING.md prompt P1

Tugas: tulis modul worker/rbac dengan pendekatan TES LEBIH DULU.

File yang sudah ada dan HARUS dipakai:
- lib/errors.ts → apiError(), error code
- lib/schemas.ts → CaregiverPermissionSchema, RoleSchema
- migrations/0001_initial_schema.sql → skema tabel

Tulis di:
- worker/rbac/permissions.ts → fungsi izin murni, tanpa I/O
- worker/rbac/index.ts → ekspor publik
- worker/rbac/permissions.test.ts → 13 kasus uji TC-U-RBAC-01..13

Aturan WAJIB dari AGENTS.md:
- Default MENOLAK. Peran/izin tidak dikenal → false.
- Pendamping TIDAK PERNAH bisa publish atau delete.
- Periksa status === 'active' DAN expires_at belum lewat.
- Fungsi murni tanpa I/O agar bisa diuji tanpa D1.
- Tanpa `any`, tanpa `@ts-ignore`.

Setelah selesai jalankan:
  pnpm run test
  npx eslint worker/rbac/

Cantumkan ID kasus uji di setiap tes:
  it("menolak pendamping yang aksesnya sudah dicabut", () => {
    // TC-U-RBAC-05
  });
```

### Verifikasi setelah agen selesai:

```powershell
pnpm run test
npx eslint worker/rbac/
```

Harus: 13 tes lolos, 0 galat lint. Kalau ada `any` atau tes yang dilemahkan, tolak.

---

## LANGKAH 2 — `worker/jobs` rantai penyedia (FRONTIER)

**Sesi baru.**

```
Baca AGENTS.md dulu.

Lalu baca berurutan:
1. docs/ARCHITECTURE.md bagian 4 dan 8
2. docs/adr/ADR-004-image-provider.md
3. docs/spec/API-CONTRACT.md bagian 7 dan 8
4. docs/testing/TEST-PLAN.md bagian 3 (modul jobs)
5. docs/ops/MODEL-ROUTING.md prompt P2

Tugas: tulis modul worker/jobs dengan pendekatan TES LEBIH DULU.

File yang sudah ada dan HARUS dipakai:
- lib/errors.ts → apiError(), ErrorCode
- lib/schemas.ts → JobKindSchema, JobStatusSchema, LIMITS
- migrations/0001_initial_schema.sql → tabel jobs

Tulis di:
- worker/jobs/providers.ts → interface ImageProvider, TranscriptionProvider, TextProvider
- worker/jobs/chain.ts → rantai fallback dengan AbortController + batas waktu
- worker/jobs/lifecycle.ts → siklus hidup pekerjaan: status, transisi, percobaan ulang
- worker/jobs/index.ts → ekspor publik
- worker/jobs/chain.test.ts → TC-U-JOB-01..10

Rantai WAJIB:
  Gambar : GeminiWeb (45 detik) → WorkersAI → Cache
  ASR    : Groq → WorkersAI
  Teks   : 9router → WorkersAI

Aturan WAJIB:
- AbortController untuk batas waktu. Hasil SETELAH dibatalkan DIABAIKAN.
- Transisi status hanya maju. succeeded→running DITOLAK.
- Kegagalan satu bahasa tidak menggagalkan bahasa lain.
- Maksimum 3 percobaan. Pakai LIMITS.MAX_JOB_ATTEMPTS dari schemas.ts.
- Galat pakai error_code dari lib/errors.ts, bukan pesan mentah.

Setelah selesai jalankan:
  pnpm run test
  npx eslint worker/jobs/
```

---

## LANGKAH 3 — `worker/auth` (FRONTIER)

**Sesi baru.**

```
Baca AGENTS.md dulu.

Lalu baca:
1. docs/PRD.md bagian 6 (keamanan)
2. docs/spec/API-CONTRACT.md bagian 2
3. docs/testing/TEST-PLAN.md bagian 8
4. docs/ops/MODEL-ROUTING.md prompt P4

Tugas: tulis modul worker/auth.

File yang sudah ada dan HARUS dipakai:
- lib/errors.ts → UNAUTHENTICATED, ACCOUNT_LOCKED, RATE_LIMITED
- lib/schemas.ts → OtpRequestSchema, OtpVerifySchema, PinSetSchema, LIMITS

Tulis di:
- worker/auth/otp.ts → permintaan dan verifikasi OTP
- worker/auth/pin.ts → set dan verifikasi PIN 6 digit
- worker/auth/token.ts → penerbitan, penyegaran, pembatalan JWT
- worker/auth/middleware.ts → verifyToken middleware
- worker/auth/index.ts
- worker/auth/*.test.ts

Aturan WAJIB:
- Respons /auth/otp/request SERAGAM untuk nomor terdaftar dan tidak. TC-SEC-14.
- PIN disimpan Argon2id, bukan MD5/SHA.
- Salah 5 kali → kunci 15 menit. TC-SEC-13.
- Batas laju: 3/nomor/jam, 10/IP/jam. Simpan di D1/KV, BUKAN memori Worker.
- Setiap token memuat token_version. Permintaan dengan versi lebih rendah DITOLAK.
- logout-all menaikkan token_version.

Setelah selesai jalankan:
  pnpm run test
  npx eslint worker/auth/
```

---

## LANGKAH 4 — Lapisan kueri D1 (FRONTIER)

**Sesi baru.**

```
Baca AGENTS.md dulu. Khususnya aturan #1 tentang batas 50 kueri D1.

Lalu baca:
1. docs/ARCHITECTURE.md bagian 7
2. docs/adr/ADR-006-data-store.md
3. docs/testing/TEST-PLAN.md bagian 7
4. docs/ops/MODEL-ROUTING.md prompt P6

Tugas: tulis lapisan akses data D1 dan penghitung kueri.

Tulis di:
- worker/db/queries.ts → seluruh kueri terkelompok (batch)
- worker/db/counter.ts → penghitung kueri per invocation
- worker/db/index.ts
- worker/db/*.test.ts
- worker/db/*.integration.test.ts → WAJIB pakai D1 asli Miniflare

Aturan WAJIB:
- Ambang KERAS: 25 kueri per invocation. LIMITS.MAX_D1_QUERIES_PER_REQUEST.
- Pola N+1 DILARANG. Gunakan db.batch().
- GET /products/:id harus mengembalikan produk + konten + media + jobs + transkrip
  dalam SATU invocation di bawah 25 kueri.
- Paginasi KURSOR, bukan OFFSET.
- Pengujian integrasi menghitung kueri NYATA, bukan tiruan.

Setelah selesai jalankan:
  pnpm run test
  pnpm run test:integration
  npx eslint worker/db/
```

---

## LANGKAH 5 — `worker/media` (MENENGAH)

**Sesi baru.**

```
Baca AGENTS.md dulu.

Lalu baca:
1. docs/spec/API-CONTRACT.md bagian 5
2. docs/testing/TEST-PLAN.md (TC-U-CAT-04..06, TC-I-05..07, TC-SEC-09..11)

Tugas: tulis modul worker/media.

File yang HARUS dipakai:
- lib/schemas.ts → UploadUrlRequestSchema, MediaPatchSchema, ALLOWED_IMAGE_MIME, IMAGE_MAGIC_BYTES

Tulis di:
- worker/media/upload.ts → URL bertanda tangan R2, validasi magic bytes
- worker/media/index.ts
- worker/media/*.test.ts

Aturan WAJIB:
- Validasi berdasar MAGIC BYTES, bukan ekstensi. Pakai IMAGE_MAGIC_BYTES dari schemas.ts.
- SVG ditolak (dapat memuat skrip).
- URL bertanda tangan berumur 15 menit.
- Foto asli TIDAK PERNAH ditimpa. Generate gambar menghasilkan aset BARU.

Setelah selesai: pnpm run test && npx eslint worker/media/
```

---

## LANGKAH 6 — `worker/catalog` + transkrip (MENENGAH)

**Sesi baru.**

```
Baca AGENTS.md dulu.

Lalu baca:
1. docs/spec/API-CONTRACT.md bagian 4 dan 6
2. docs/spec/FEATURE-SPECS.md bagian F1 dan F2
3. docs/adr/ADR-008-transcript-review.md

Tugas: tulis modul worker/catalog.

Tulis di:
- worker/catalog/products.ts → CRUD produk, status transitions
- worker/catalog/content.ts → konten per bahasa, patch
- worker/catalog/transcript.ts → simpan, tinjau, edit transkrip
- worker/catalog/consent.ts → persetujuan audio_processing dan publication
- worker/catalog/index.ts
- worker/catalog/*.test.ts

Aturan WAJIB:
- POST /products/:id/generate DITOLAK bila transcript.reviewed === false.
  Ini menegakkan ADR-008 di tingkat server.
- Merekam tanpa persetujuan audio_processing → CONSENT_REQUIRED.
- Menerbitkan tanpa persetujuan publication → CONSENT_REQUIRED.
- Status produk: draft→processing→review→published→archived. Hanya maju.
- Setiap perubahan konten mengubah source menjadi 'ai_edited'.
- Idempotency-Key pada POST /products.
- Pakai worker/rbac untuk pemeriksaan izin.
- Pakai worker/db untuk kueri.

Setelah selesai: pnpm run test && pnpm run test:integration && npx eslint worker/catalog/
```

---

## LANGKAH 7 — `worker/audit` (MENENGAH)

**Sesi baru.**

```
Baca AGENTS.md dulu.
Baca docs/spec/API-CONTRACT.md — tidak ada endpoint audit yang terpisah,
tapi setiap aksi wajib dicatat.

Tugas: tulis modul worker/audit.

Tulis di:
- worker/audit/logger.ts → fungsi logActivity(actor, onBehalfOf, action, entity)
- worker/audit/index.ts

Aturan WAJIB:
- on_behalf_of TERISI saat pendamping bertindak. TC-I-09.
- on_behalf_of KOSONG saat pengrajin bertindak sendiri. TC-I-10.
- Tidak ada logika bisnis di modul ini. Ia hanya menulis.

Setelah selesai: pnpm run test && npx eslint worker/audit/
```

---

## LANGKAH 8 — Router endpoint utama

**Sesi baru.**

```
Baca AGENTS.md dulu.
Baca docs/spec/API-CONTRACT.md dari awal sampai akhir.

Tugas: hubungkan seluruh modul di worker/index.ts.

Semua modul sudah jadi: auth, rbac, catalog, media, jobs, audit, db.
Tugas Anda hanya MERAKIT, bukan menulis ulang.

Pola routing:
- Parse URL, cocokkan ke handler
- Setiap handler: validasi Zod → cek auth → cek rbac → logika → audit
- Respons selalu bentuk { ok, data } atau { ok, error }

Tulis handler untuk SELURUH endpoint di API-CONTRACT.md.
Termasuk endpoint agent (bagian 8) dengan X-Agent-Key.

Header wajib:
- Content-Security-Policy, X-Content-Type-Options, Referrer-Policy (TC-SEC-19)
- CORS hanya asal yang diizinkan (TC-SEC-20)

Setelah selesai:
  pnpm run typecheck
  pnpm run test
  pnpm run test:integration
  npx eslint .
```

---

## LANGKAH 9 — Frontend: alur 6 langkah (MENENGAH)

**Sesi baru.**

```
Baca AGENTS.md, DESIGN.md, dan docs/design/DESIGN-SYSTEM.md dulu.

Lalu baca:
1. docs/spec/FEATURE-SPECS.md bagian F1, F2, S2, S5
2. docs/spec/API-CONTRACT.md (bentuk request/response)
3. app/tokens.css (PAKAI token ini, jangan tulis warna mentah)

Tugas: bangun alur 6 langkah membuat katalog.

Enam halaman di app/:
  1. app/create/photo/page.tsx     "Arahkan kamera ke produk Anda"
  2. app/create/record/page.tsx    "Tekan tombol dan ceritakan produk Anda"
  3. app/create/transcript/page.tsx "Apakah ini yang Anda ceritakan?"
  4. app/create/process/page.tsx   "KATAVIS sedang membuat katalog Anda"
  5. app/create/review/page.tsx    "Apakah katalog sudah sesuai?"
  6. app/create/publish/page.tsx   "Katalog siap dilihat pembeli"

Aturan WAJIB:
- SATU aksi utama per layar. Dua tombol setara = desain salah.
- Tombol minimum 56×56 px. Pakai var(--touch-min).
- Teks tubuh minimum 18px. Pakai var(--text-body).
- Ikon SELALU berdampingan label teks.
- Status TIDAK PERNAH disampaikan lewat warna saja.
- Auto Save setiap 5 detik ke IndexedDB.
- Fokus: outline 3px solid var(--focus-ring), offset 2px.
- Mundur tidak menghilangkan data.
- Melompati langkah via URL DITOLAK.
- JANGAN pakai gradient ungu-biru, bento grid, blob, atau pola AI slop.
  Baca DESIGN.md bagian 10.

Setelah selesai:
  pnpm run typecheck
  npx eslint app/
  python tools/contrast.py
```

---

## LANGKAH 10 — Accessibility Mode (FRONTIER)

**Sesi baru.**

```
Baca AGENTS.md, DESIGN.md, docs/design/DESIGN-SYSTEM.md bagian 9.

Lalu baca:
1. docs/spec/FEATURE-SPECS.md bagian S1 dan S6
2. docs/testing/TEST-PLAN.md bagian 6
3. docs/ops/MODEL-ROUTING.md prompt P5

Tugas: bangun Accessibility Mode dan lapisan ARIA.

Tulis di:
- components/a11y/AccessibilityToggle.tsx → tombol di pojok, 5 profil
- components/a11y/ProfileProvider.tsx → context, simpan ke server PUT /me/a11y-profile
- app/tokens.css sudah punya [data-a11y-visual] dan [data-a11y-motor]

Aturan WAJIB:
- Lima profil dapat DIGABUNG.
- Pilihan tersimpan di SERVER (PUT /me/a11y-profile), bukan hanya localStorage.
- aria-live untuk perubahan status. Penting di langkah pemrosesan 60 detik.
- Ikon selalu berdampingan label teks.
- Placeholder BUKAN satu-satunya label input.
- outline: none tanpa pengganti DILARANG.
- Enam status interaktif: default, hover, focus-visible, active, disabled, loading.

Setelah selesai:
  pnpm run typecheck
  pnpm run test:e2e:a11y
  python tools/contrast.py
```

---

## LANGKAH 11 — Talking-Catalog (MENENGAH)

**Sesi baru.**

```
Baca AGENTS.md dan docs/adr/ADR-005-avatar-engine.md.

Lalu baca:
1. docs/spec/FEATURE-SPECS.md bagian F3
2. docs/spec/API-CONTRACT.md bagian 10 (GET /public/catalog/:slug)

Tugas: bangun Talking-Catalog — avatar 2D + TTS + subtitle.

Tulis di:
- components/catalog/TalkingCatalog.tsx → pemutaran, jeda, ulang
- components/catalog/Avatar.tsx → SVG dengan gerak mulut dari amplitudo
- components/catalog/Subtitles.tsx → teks tersinkron, menyorot kalimat aktif
- app/catalog/[slug]/page.tsx → halaman publik

Aturan WAJIB:
- Subtitle tersinkron ±200 ms.
- Berfungsi TANPA suara (subtitle saja).
- Berfungsi TANPA gambar (audio saja).
- Kendali dapat dijangkau KEYBOARD.
- Animasi berhenti di prefers-reduced-motion.
- Subtitle adalah TEKS nyata (dapat disalin), bukan piksel.
- LCP halaman publik < 2,5 detik pada 4G.

Setelah selesai: pnpm run typecheck && npx eslint .
```

---

## LANGKAH 12 — Ekspor (BIASA)

**Sesi baru.**

```
Baca AGENTS.md.
Baca docs/spec/API-CONTRACT.md bagian 10.
Baca docs/spec/FEATURE-SPECS.md bagian F4.

Tugas: tulis modul worker/export.

Tulis di:
- worker/export/pdf.ts → PDF dengan tag struktur dan alt text
- worker/export/csv.ts → feed CSV format Google Merchant Center
- worker/export/index.ts
- worker/export/*.test.ts

Setelah selesai: pnpm run test && npx eslint worker/export/
```

---

## LANGKAH 13 — Studio Agent (FRONTIER jika Gemini aktif)

**Sesi baru.**

```
Baca AGENTS.md.
Baca docs/adr/ADR-004-image-provider.md LENGKAP.
Baca docs/spec/API-CONTRACT.md bagian 8.
Baca docs/ops/MODEL-ROUTING.md prompt P3.

Tugas: tulis Studio Agent di agent/.

PERINGATAN: pakai akun Google TERPISAH. Sanksi ToS mencakup penghapusan
seluruh akun termasuk Gmail dan Drive.

Tulis di:
- agent/index.js → proses utama
- agent/chrome.js → jalankan Chrome asli via subprocess, connectOverCDP
- agent/heartbeat.js → kirim heartbeat setiap 15 detik
- agent/worker.js → ambil pekerjaan, generate, unggah hasil

JANGAN pakai:
- Chromium bawaan Playwright (TERBUKTI diblokir Google)
- Camoufox (ada laporan terdeteksi)
- undetected-chromedriver (tidak terpelihara sejak Juli 2025)

PAKAI: Chrome asli + --remote-debugging-port + --user-data-dir yang
sudah login MANUAL.

Setelah selesai: node agent/index.js --health-check
```

---

## LANGKAH 14 — E2E testing

**Sesi baru.**

```
Baca AGENTS.md.
Baca docs/testing/TEST-PLAN.md bagian 5 (E2E).

Tugas: tulis seluruh pengujian Playwright di e2e/.

File:
- e2e/create-catalog.spec.ts → TC-E2E-01..03
- e2e/caregiver.spec.ts → TC-E2E-04, 05
- e2e/public-catalog.spec.ts → TC-E2E-06
- e2e/export.spec.ts → TC-E2E-07, 08, 09
- e2e/fallback.spec.ts → TC-E2E-10..18
- e2e/error-messages.spec.ts → TC-E2E-20..22
- e2e/auto-save.spec.ts → TC-E2E-23, 24
- e2e/guided-nav.spec.ts → TC-E2E-25
- e2e/notification.spec.ts → TC-E2E-26
- e2e/a11y.spec.ts → TC-A11Y-01..12 (axe-core)

Setiap tes memuat ID kasus uji di komentar.
Viewport utama 360×800 (Android kelas menengah).
Pakai @axe-core/playwright untuk a11y.

Setelah selesai: pnpm run test:e2e
```

---

## LANGKAH 15 — Pengerasan dan verifikasi akhir

**Sesi baru.**

```
Baca AGENTS.md.
Baca docs/testing/TEST-PLAN.md bagian 11 (kriteria kelulusan).

Tugas: jalankan SELURUH verifikasi dan perbaiki yang gagal.

Jalankan berurutan:
1. pnpm run typecheck
2. npx eslint .
3. pnpm run test
4. pnpm run test:integration
5. pnpm run test:e2e
6. python tools/contrast.py
7. python tools/check_refs.py

Laporkan status setiap langkah. Perbaiki yang gagal.
JANGAN melemahkan tes agar lolos.
JANGAN menambah @ts-ignore atau any.
JANGAN mematikan aturan lint.

Setelah semua hijau, jalankan: git add -A && git status
Laporkan daftar file yang berubah.
```

---

## Tips penting

### Kapan pakai frontier vs biasa

| Model | Untuk langkah |
|---|---|
| **Frontier** (Opus, GPT-5.6 Sol) | 1, 2, 3, 4, 10, 13 |
| Menengah (Sonnet, GPT-5.6 Luna) | 5, 6, 7, 8, 9, 11, 14 |
| Biasa (Haiku, GPT-4.1) | 12, 15 |

### Tanda hasil agen perlu DITOLAK

- Ada `any` atau `@ts-ignore`
- Tes diubah agar lolos (tes melemah, bug tetap ada)
- `catch` kosong atau hanya `console.log`
- Pesan error memuat istilah teknis ("Error 500", "Failed")
- Warna mentah (#2E1F17) bukan token (var(--clay-900))
- Impor menembus modul (import dari `../rbac/internal/x`)

### Setelah setiap langkah selesai

```powershell
pnpm run verify
git add -A
git commit -m "langkah N: deskripsi singkat"
git push
```

### Kalau agen berhalusinasi

Gejala: mengarang endpoint yang tidak ada di API-CONTRACT.md, atau menulis error code yang tidak
ada di lib/errors.ts.

Solusi: tempel kalimat ini di awal prompt:
```
JANGAN mengarang endpoint atau error code. Semua bentuk API ada di
docs/spec/API-CONTRACT.md. Semua error code ada di lib/errors.ts.
Kalau Anda butuh yang belum ada, TANYA dulu, jangan buat sendiri.
```
