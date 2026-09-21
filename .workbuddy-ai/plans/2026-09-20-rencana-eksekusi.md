# Rencana Eksekusi — 20 September 2026

Disetujui pemilik proyek pada 20 September 2026 ("setujui semua itu, langsung kerjakan").
Setiap klaim di bawah menunjuk berkas dan baris yang benar-benar ada di repositori ini.

---

## 1. Prinsip kerja

1. Tidak mengarang endpoint, kode galat, skema, atau bentuk API. Semua mengikuti
   `docs/spec/API-CONTRACT.md`, `lib/errors.ts`, dan `lib/schemas.ts`.
2. Tidak melemahkan pengujian agar lolos. Bila pengujian gagal karena produk belum memenuhi
   kontrak, yang diperbaiki adalah produknya.
3. Bila sebuah perubahan menyentuh kontrak, skema, atau dependensi, teks usulannya ditulis
   lengkap di rencana ini lebih dulu supaya dapat ditinjau, bukan diterapkan diam-diam.
4. Satu proses berat pada satu waktu. Mesin ini menyisakan 1,7 GB RAM (AGENTS.md).

---

## 2. Fakta terverifikasi

| Fakta | Sumber |
|---|---|
| Agen menjalankan Chrome **asli** sebagai proses terpisah dengan `--remote-debugging-port` dan `--user-data-dir`, lalu menyambung lewat `connectOverCDP` | `agent/chrome.js:4-5, 192-206` |
| Profil agen terpisah: `agent/chrome-profile/` — sudah pernah dibuka (`Default` ada), **belum masuk akun** | pemeriksaan kesehatan 20 Sep, `agent/index.js:124-133` |
| Chromium bawaan Playwright **tidak boleh** dipakai: Google memblokirnya dengan "This browser or app may not be secure" | `agent/.env.example:31-33` |
| Profil agen diabaikan git | `.gitignore:24` |
| Agen **tidak dapat mengambil pekerjaan** sebelum pernah melapor: rute klaim menolak `FORBIDDEN` bila heartbeat tidak ada atau `agentId` tidak cocok | `worker/index.ts:1230-1236` |
| Heartbeat memuat `healthy`, `selectors_ok`, `chrome_session_ok` | `worker/jobs/d1-agent.ts:33-47` |
| Rantai gambar: `gemini_web → workers_ai → cache`; batas 45 detik | `worker/jobs/providers.ts:136-140`, `wrangler.jsonc` |
| `GEMINI_ENABLED` **tidak pernah dibaca** di kode mana pun; hanya `DEMO_MODE` yang dibaca | `worker/index.ts:147-148, 453` |
| CI menjalankan audit sebagai **non-blocking** (`|| true`) | `.github/workflows/ci.yml:49-50` |
| CI **tidak** menjalankan gitleaks, padahal TEST-PLAN §11 menuntutnya | `.github/workflows/ci.yml` (tidak ada langkahnya) |
| CI mengunggah `playwright-report/`, sedangkan konfigurasi menulis `test-output/html` | `ci.yml:106` vs `playwright.config.ts` |
| Katalog galat: 23 kode, 15 aksi unik | `lib/errors.ts:11-127` |

---

## 3. Workstream

### W1 — Cakupan uji ≥80% (disetujui)

**Tujuan:** mengukur gerbang cakupan yang selama ini tidak pernah dapat dijalankan.
`vitest` menjawab `Cannot find dependency '@vitest/coverage-v8'`.

**Langkah**
1. `pnpm add -D @vitest/coverage-v8@4.1.11` — versi disamakan dengan `vitest@4.1.11`.
2. `pnpm exec vitest run --project unit --coverage`.
3. Bandingkan dengan ambang §14: ≥80%. Bila kurang, laporkan berkas dengan cakupan terendah —
   **bukan** menurunkan ambang.

**Verifikasi:** uji unit tetap 499 lulus; angka cakupan dilaporkan apa adanya.

**HASIL TERUKUR (20 Sep, setelah dipasang):**

```
All files        |  76.42 stmt | 69.20 branch | 68.75 func | 79.37 line
```

Ambang §14 adalah **≥80%** → **BELUM TERPENUHI** pada pembacaan mana pun (baris 79,37%;
pernyataan 76,42%). Ini temuan, bukan alasan menurunkan ambang.

Modul terlemah, dengan penyebab yang terlihat:

| Berkas | Cakupan baris | Catatan |
|---|---|---|
| `lib/session.ts` | **0%** | tidak tersentuh sama sekali (baris 18-34) |
| `worker/jobs/*` | 55,45% | `chain.ts` sendiri 94,82% — sisanya (`lifecycle`, `d1-agent`, `providers`) yang menahan |
| `worker/catalog/content.ts` | 56,52% | baris 115-148 |
| `worker/db/counter.ts` | 58,06% | baris 135-174 |
| `worker/catalog/products.ts` | 68,53% | baris 240, 289-328, 400-417 |

### W1b — SELESAI (20 Sep): cakupan naik dari 79,37% ke 87,25% baris

Ambang di `vitest.config.ts` — yang ternyata sudah dikonfigurasi sejak awal, bukan sekadar
angka di test plan:

| Cakupan | Sebelum | Sesudah | Ambang | Status |
|---|---|---|---|---|
| Baris (semua) | 79,37% | **87,25%** | 80% | LOLOS |
| Fungsi (semua) | 68,75% | **82,42%** | 80% | LOLOS |
| Cabang (semua) | 69,20% | **77,56%** | 75% | LOLOS |
| `worker/jobs` baris | 55,45% | **100%** | 90% | LOLOS |
| `worker/jobs` fungsi | 51,21% | **100%** | 90% | LOLOS |
| `worker/jobs` cabang | 27,27% | **87,87%** | 85% | LOLOS |
| `worker/rbac` baris | 79,59% | **100%** | 95% | LOLOS |
| `worker/rbac` fungsi | 72% | **100%** | 95% | LOLOS |
| `worker/rbac` cabang | 84,61% | **94,23%** | 90% | LOLOS |

`vitest run --project unit --coverage` kini keluar dengan kode 0. Uji unit: 499 → **571**
(+72 uji baru, tanpa satu pun penanda abaikan dan tanpa menurunkan ambang).

Berkas uji baru: `lib/session.test.ts` (8), `worker/rbac/d1-links.test.ts` (12),
`worker/jobs/d1-agent.test.ts` (20), `worker/jobs/d1-jobs.test.ts` (8),
`worker/jobs/lifecycle.test.ts` (12); ditambah 12 uji pada berkas yang sudah ada
(`worker/db/queries.test.ts` 7 untuk `findPublicCatalogEntry`, `worker/jobs/chain.test.ts` 5
untuk keterangan galat dan rantai transkripsi, `worker/rbac/permissions.test.ts` 3 untuk
penjaga sesi).

**Kendala yang ditemukan dan harus diketahui:** cakupan proyek `worker` (integrasi) **tidak
dapat dikumpulkan** — `vitest run --coverage` dengan pool workerd hanya menjalankan proyek unit.
Karena `coverage.include` mencakup seluruh `worker/**` + `lib/**`, ambang di `vitest.config.ts`
secara efektif diukur oleh suite **unit** saja. Itulah sebabnya ambang `worker/jobs` 90% dan
`worker/rbac` 95% masuk akal: keduanya memang harus dicapai uji unit.

### W1b (asli) — daftar berkas yang menahan, untuk catatan
Menulis uji unit baru untuk jalur yang belum tersentuh — bukan menurunkan ambang, bukan
menambah penanda abaikan. Prioritas mengikuti AGENTS.md ("jobs ← KRITIS") dan jarak ke ambang:

1. `lib/session.ts` (0% → target >90%): token di penyimpanan, kedaluwarsa, tidak ada sesi.
2. `worker/jobs/lifecycle.ts`, `d1-agent.ts`, `providers.ts`: siklus hidup pekerjaan, klaim,
   heartbeat, dan urutan rantai penyedia.
3. `worker/catalog/content.ts`, `products.ts`, `worker/db/counter.ts`: jalur yang terlewat.
4. `worker/db/queries.ts` baris 418-462 (`findPublicCatalogEntry`) — kini punya data semai nyata
   untuk diuji.

Perkiraan: 40–60 uji baru. Setiap uji wajib mencantumkan ID kasus uji yang sudah ada di
TEST-PLAN (aturan AGENTS.md), dan `check_refs.py` harus tetap lolos.

### W2 — gitleaks dan celah CI (SELESAI 20 Sep)

**Tujuan:** gerbang §11 "gitleaks tanpa temuan" belum ada di mesin maupun di CI.

**Hasil**

1. **`.gitleaks.toml` dibuat** — dua aturan khas proyek (`JWT_SIGNING_KEY` base64 32 byte,
   `AGENT_SHARED_KEY` 64 heksadesimal) plus aturan bawaan gitleaks. Pengecualian dibatasi:
   `.env.example` dan `.dev.vars` (keduanya sudah di `.gitignore`), ditambah penanda yang
   jelas palsu (`test`, `dummy`, `contoh`, pengulangan `aaa…`). Berkas uji **tidak**
   dikecualikan seluruhnya dengan sengaja — kalau diizinkan, kunci nyata yang tertinggal di
   dalamnya ikut lolos.
2. **Langkah gitleaks ditambahkan ke CI** (`verify`), dijalankan lewat image resmi
   `zricethezav/gitleaks:latest` supaya tidak ada biner yang perlu di-commit. `fetch-depth: 0`
   ditambahkan pada `actions/checkout@v4` — tanpa itu checkout dangkal hanya membawa satu
   commit dan riwayat lama tidak pernah tersapu.
3. **`npm audit --audit-level=high || true` → `pnpm audit --audit-level=high`.**
   Dua kesalahan sekaligus: `|| true` membuat langkah itu selalu hijau apa pun hasilnya, dan
   `npm` dipakai padahal kunci dependensinya `pnpm-lock.yaml`. Ambang `high`, bukan
   `moderate`: `moderate` pada dependensi pengembangan muncul lebih sering daripada dapat
   ditindaklanjuti, dan gerbang yang berisik akan dimatikan orang.
4. **Jalur artefak diperbaiki.** CI mengunggah `playwright-report/`, sedangkan
   `playwright.config.ts` menulis laporan HTML ke `test-output/html` — jadi unggahannya
   **selalu kosong** dan tidak ada yang menyadarinya. Sekarang `test-output/html/` +
   `test-output/results.json`.

**Verifikasi:** YAML sah (dibaca ulang dengan parser YAML: `verify` 12 langkah, `integration`
5, `e2e` 8). `pnpm audit --audit-level=high` keluar 0 setelah overrides `sharp`/`qs` di
`pnpm-workspace.yaml` (temuan W1). Pemindaian gitleaks atas pohon kerja **belum dijalankan** —
Docker tidak tersedia di mesin ini; langkahnya baru dapat dibuktikan saat CI berjalan.

**Yang masih terbuka:** gitleaks belum pernah dieksekusi sungguhan (butuh Docker atau biner
gitleaks). Ini dicatat apa adanya, bukan diklaim hijau.

### W3 — Pesan galat: label tombol dan pesan yang menyatakan keselamatan kerja (SELESAI 20 Sep)

**Tujuan:** TC-E2E-20/21/22 hijau dengan memperbaiki produk, bukan melonggarkan pengujian.

**Akar masalah (terverifikasi dari log run terakhir)**
- **TC-E2E-21 gagal pada 7 kode** karena `StepShell` menampilkan `error.action` **mentah**
  sebagai teks (`app/create/StepShell.tsx:129`): `PICK_OTHER_FILE`, `RETRY_RECORD`, dst.
  Kontrak API bagian 12: "`action` — antarmuka memetakannya ke tombol".
- **TC-E2E-22 gagal pada 9 kode**, dan uji seluruh katalog (TC-E2E-20) gagal pada
  `UNAUTHENTICATED`, karena pesannya tidak memuat pernyataan pekerjaan aman.

**Penanda yang dituntut pengujian** (`e2e/support/errors.ts`, mengkodifikasikan S5-04/S5-05):
- langkah berikutnya: coba lagi · rekam lagi · silakan · pilih · tambahkan · lengkapi ·
  masuk lagi · minta · periksa · gunakan · tunggu · kembali · lanjutkan · pakai foto asli
- pekerjaan aman: tersimpan · tetap tersimpan · tidak hilang · aman · utuh

**W3a — peta 15 kode aksi → label tombol** (baru, di `lib/errors.ts`)

| Kode aksi | Label tombol |
|---|---|
| `ADD_PHOTO` | Tambahkan foto |
| `COMPLETE_CONTENT` | Lengkapi katalog |
| `GIVE_CONSENT` | Beri persetujuan |
| `GO_BACK` | Kembali |
| `LOGIN` | Masuk lagi |
| `NONE` | *(tanpa tombol — tidak dirender)* |
| `PICK_OTHER_FILE` | Pilih foto lain |
| `REQUEST_NEW_INVITE` | Minta undangan baru |
| `RETRY` | Coba lagi |
| `RETRY_OR_USE_ORIGINAL` | Coba lagi atau pakai foto asli |
| `RETRY_RECORD` | Rekam lagi |
| `REVIEW_TRANSCRIPT` | Periksa transkrip |
| `USE_ORIGINAL` | Pakai foto asli |
| `WAIT` | Tunggu sebentar |
| `WAIT_ONLINE` | Tunggu sampai tersambung |

**W3b — 23 pesan galat, usulan lengkap** (kanan = teks baru; yang tidak berubah ditandai —)

| Kode | Pesan sekarang | Usulan |
|---|---|---|
| UNAUTHENTICATED | Sesi Anda sudah berakhir. Silakan masuk lagi. | Sesi Anda sudah berakhir. Pekerjaan Anda tetap tersimpan. Silakan masuk lagi. |
| FORBIDDEN | Anda tidak punya akses untuk tindakan ini. | Anda tidak punya akses untuk tindakan ini. Pekerjaan Anda tetap aman. |
| NOT_FOUND | Halaman tidak ditemukan. | Halaman tidak ditemukan. Kembali ke halaman sebelumnya; pekerjaan Anda tidak hilang. |
| RATE_LIMITED | Terlalu banyak percobaan. Coba lagi beberapa menit lagi. | — *(sudah memuat "coba lagi"; tambahkan "Pekerjaan Anda tetap tersimpan.")* |
| ACCOUNT_LOCKED | Akun terkunci sementara. Coba lagi 15 menit lagi. | Akun terkunci sementara. Pekerjaan Anda tetap tersimpan. Coba lagi 15 menit lagi. |
| CONSENT_REQUIRED | Perlu persetujuan Anda sebelum melanjutkan. | Perlu persetujuan Anda sebelum melanjutkan. Katalog Anda tetap utuh. |
| FILE_TOO_LARGE | Foto terlalu besar. Maksimal 10 MB. | Foto terlalu besar. Maksimal 10 MB. Pilih foto lain; pekerjaan Anda tetap tersimpan. |
| UNSUPPORTED_FORMAT | Format foto tidak didukung. Gunakan JPG atau PNG. | Format foto tidak didukung. Gunakan JPG atau PNG; pekerjaan Anda tetap tersimpan. |
| CONTENT_MISMATCH | Berkas ini bukan foto. Silakan pilih foto lain. | Berkas ini bukan foto. Silakan pilih foto lain; pekerjaan Anda tetap tersimpan. |
| ASR_TOO_SHORT | Rekaman terlalu pendek. Ceritakan sekitar 30 detik. | Rekaman terlalu pendek. Rekam lagi sekitar 30 detik; cerita Anda tidak hilang. |
| ASR_TOO_LONG | Rekaman terlalu panjang. Maksimal 60 detik. | Rekaman terlalu panjang. Rekam lagi maksimal 60 detik; cerita Anda tidak hilang. |
| ASR_NO_SPEECH | Suara belum terdengar jelas. Rekam lagi di tempat lebih tenang. | Suara belum terdengar jelas. Rekam lagi di tempat lebih tenang; cerita Anda tidak hilang. |
| TRANSCRIPT_NOT_REVIEWED | Periksa dulu hasil transkrip Anda. | Periksa dulu hasil transkrip Anda; draf Anda tetap tersimpan. |
| CONTENT_INCOMPLETE | Katalog belum lengkap. Lengkapi dulu nama dan cerita produk. | Katalog belum lengkap. Lengkapi dulu nama dan cerita produk; draf Anda tetap tersimpan. |
| PHOTO_REQUIRED | Tambahkan minimal satu foto produk. | Tambahkan minimal satu foto produk; draf Anda tetap tersimpan. |
| IMAGE_GENERATE_FAILED | Foto studio belum berhasil dibuat. Foto asli Anda tetap tersimpan. | — |
| COPY_GENERATE_FAILED | Cerita belum berhasil dibuat. Rekaman Anda tetap tersimpan. | — |
| MAX_RETRIES_EXCEEDED | Sudah dicoba beberapa kali. Anda bisa memakai foto asli. | Sudah dicoba beberapa kali. Pakai foto asli; foto asli Anda tetap tersimpan. |
| QUOTA_EXCEEDED | Sistem sedang sibuk. Pekerjaan Anda tersimpan. | — |
| NETWORK_OFFLINE | Tidak ada koneksi. Pekerjaan Anda tersimpan dan akan dilanjutkan. | — |
| INVITE_EXPIRED | Undangan sudah kedaluwarsa. Minta undangan baru. | Undangan sudah kedaluwarsa. Minta undangan baru; pekerjaan Anda tetap tersimpan. |
| INVITE_ALREADY_USED | Undangan ini sudah dipakai. | Undangan ini sudah dipakai. Kembali dan masuk dengan akun Anda; pekerjaan Anda tetap tersimpan. |
| INTERNAL_ERROR | Terjadi gangguan. Pekerjaan Anda tersimpan. Coba lagi. | — |

**Berkas yang disentuh W3:** `lib/errors.ts` (pesan + peta label), `app/create/StepShell.tsx`
(render tombol berlabel, bukan teks kode), `docs/spec/API-CONTRACT.md` bagian 12 (tabel pesan),
`lib/errors.test.ts` (harapan teks menyesuaikan katalog — bukan dilonggarkan).

**Verifikasi:** `pnpm run test`, lalu TC-E2E-20/21/22 pada android-chrome.

**HASIL W3 (diterapkan):**

- `lib/errors.ts`: 23 pesan diganti; ditambah `ErrorAction`, `ACTION_LABELS`
  (`Record<ErrorAction, string>` — kode aksi baru tanpa label gagal saat typecheck), dan
  `actionLabel()` yang mengembalikan string kosong untuk kode tak dikenal, bukan kodenya sendiri.
- `app/create/StepShell.tsx`: baris `errorAction` kini memuat label manusia; aksi `NONE` dan kode
  tak dikenal tidak dirender sama sekali.
- `docs/spec/API-CONTRACT.md` §12: seluruh 23 baris tabel diselaraskan; ditambah catatan bahwa
  label tombol hidup di `ACTION_LABELS`. Diverifikasi dengan skrip: **23 kode, 0 tidak sinkron**
  antara katalog dan kontrak.
- `lib/errors.test.ts`: satu uji mengunci teks lama secara hardcode; kini membaca
  `ERROR_CATALOG` sehingga tidak dapat menyimpang lagi.

**Validasi sebelum penerapan:** 23 usulan pesan diuji terhadap keempat aturan yang mengikat —
penanda langkah-berikutnya (15 frasa), penanda pekerjaan-aman (5 frasa), daftar istilah terlarang
(9 istilah, dicocokkan sebagai substring), dan diakhiri titik. Hasil: 23 diperiksa, 0 bermasalah.

**Catatan yang masih terbuka:** kontrak menyatakan `action` "dipetakan ke tombol", sedangkan
`StepShell` merendernya sebagai **baris teks berlabel**, bukan tombol yang dapat ditekan. Tombol
per-aksi menuntut setiap layar menyediakan penangan sendiri (apa yang terjadi saat "Coba lagi"
ditekan berbeda di layar foto dan layar proses) — perubahan yang lebih besar dan keputusan
pemilik, bukan sesuatu yang dikarang di sini. Yang diperbaiki sekarang: kode mesin tidak lagi
pernah terlihat pengrajin.

**HASIL E2E W3 (android-chrome):**

```
error-messages.spec.ts + fallback.spec.ts  →  61 lulus, 0 gagal   (2,6 menit)
suite android-chrome penuh                 → 113 lulus, 3 gagal, 10 dilewati  (3,3 menit)
```

Tiga yang tersisa semuanya `TC-E2E-26 notifikasi multimodal` — fitur yang memang belum ada di
produk. Sebelum W3, suite android-chrome menghasilkan 92 lulus / 25 gagal / 10 dilewati dan
memakan 13,8 menit; kini 113 / 3 / 10 dalam 3,3 menit. Kegagalan yang menunggu batas waktunya
adalah kegagalan yang mahal.

**Temuan susulan yang penting (akar TC-E2E-22 yang masih merah setelah katalog diperbaiki):**
`e2e/support/catalog.ts` memuat **salinan** 23 pesan dari katalog, dengan komentar yang menyatakan
salinan itu perlu karena "E2E tidak dapat membaca `lib/errors.ts` tanpa membangun proyek lebih
dulu". Komentar itu keliru — `lib/errors.ts` tidak mengimpor apa pun dan Playwright menjalankan
TypeScript di Node. Salinan itu sudah menyimpang, sehingga yang gagal adalah pengujiannya, bukan
aplikasinya. Kini `ERROR_CASES` **diturunkan** dari `ERROR_CATALOG`, dan `FORBIDDEN_MESSAGE_TERMS`
di `e2e/support/errors.ts` dibaca dari katalog, bukan disalin.

### W4 — Parameter bahasa pada katalog publik (disetujui, menyentuh kontrak)

**Tujuan:** TC-E2E-09 (lima bahasa, kriteria §14) dapat lulus. Sekarang locale dikeraskan:
`findPublicCatalogEntry(context.db, slug, "id")` (`worker/index.ts:968`).

### W4 — Parameter bahasa pada katalog publik (SELESAI 20 Sep)

**Langkah**
1. Terima `?locale=` opsional pada `GET /public/catalog/:slug`; bawaan `"id"`; nilai di luar
   `LocaleSchema` → `NOT_FOUND` (bukan 400, agar tidak membocorkan bentuk internal).
2. `fetchPublicCatalog(slug, locale?)` mengirim parameter itu (`components/catalog/api.ts:41`).
3. Halaman meneruskan `searchParams.locale`; pemilih bahasa menavigasi dengan parameter itu
   (`components/catalog/CatalogNarration.tsx`).
4. Catat perubahan di `docs/spec/API-CONTRACT.md` bagian 10.
5. Hapus gerbang `LOCALE_PARAM_NOT_IMPLEMENTED_REASON` pada `e2e/export.spec.ts`.

**Hasil**

Berkas yang berubah: `worker/index.ts`, `components/catalog/api.ts`,
`components/catalog/CatalogNarration.tsx`, `components/catalog/TalkingCatalog.tsx`,
`components/catalog/useNarration.ts`, `components/catalog/timeline.ts`,
`app/catalog/[slug]/page.tsx` (kini membaca `searchParams`), `docs/spec/API-CONTRACT.md` §10,
`e2e/export.spec.ts`, `e2e/create-catalog.spec.ts`, `e2e/support/flow.ts`.

**Keputusan yang tidak ada di rencana awal, beserta alasannya**

- **`locale` ditambahkan ke muatan respons** (dan ke `PublicCatalogSchema`), bukan hanya ke
  permintaan. `availableLocales` tidak pernah menyebut bahasa mana yang sedang terbuka, dan
  urutannya tidak dijanjikan basis data; tanpa bidang ini pemilih bahasa menyoroti pilihan
  pertama sehingga halaman `?locale=ja` menandai "Bahasa Indonesia" sebagai yang terbuka.
- **Klien memakai `data.locale` sebagai penanda, bukan nilai yang diminta.** Server berhak
  menjawab dengan bahasa lain bila yang diminta tidak tersedia; mempercayai nilai yang diminta
  berarti menyoroti pilihan yang isinya tidak sedang tampil.
- **`aria-current` → `aria-pressed`** pada tombol pemilih bahasa. Ini tombol yang menyalakan
  dirinya sendiri, bukan posisi di dalam alur navigasi; pembaca layar menyebut "halaman saat
  ini" untuk `aria-current` — bunyi yang salah. (`Subtitles.tsx` tetap memakai `aria-current`
  karena di sana memang penanda posisi.)
- **`useNarration` memakai `locale` dari server lebih dulu**, tebakan dari teks hanya cadangan.
  Dipakai untuk memilih kode bahasa suara perangkat; menebak berarti naskah Jepang dapat
  dibacakan dengan aturan pelafalan yang salah.

**Bug kontrak yang ditemukan saat verifikasi**

`?locale=` **kosong** menjawab 404, padahal dokumen menjanjikan bawaan `id`.
Sebabnya: `searchParams.get("locale")` mengembalikan `""` — bukan `null` — untuk `?locale=`,
jadi `?? "id"` tidak pernah berlaku. Perbaikannya di dua tempat sekaligus (Worker dan
`askedLocale` pada halaman) supaya keduanya sepaham. Ditemukan hanya karena diuji lewat HTTP
sungguhan; uji unit tidak akan menangkapnya.

**Verifikasi (semuanya terhadap Worker hidup + D1 tersemai)**

| Kasus | Hasil |
|---|---|
| `?locale=id/en/ja/zh/ar` | lima isi berbeda dan benar (`Tas Kulit Nusantara`, `Nusantara Leather Bag`, `ヌサンタラ革のバッグ`, `努桑塔拉皮革包`, `حقيبة جلدية نوسانتارا`) |
| tanpa parameter, `?locale=` | keduanya `locale=id` — sama persis |
| `?locale=fr`, `=ID`, `=id-ID`, `=xx&locale=en`, `=%20id` | 404 `NOT_FOUND` |
| slug tidak ada dengan/tanpa bahasa | 404 `NOT_FOUND`, muatan identik — penebak tidak dapat membedakan "slug benar, bahasa salah" dari "slug salah" |
| `?LOCALE=id` | 200 — nama parameter peka huruf besar-kecil menurut spesifikasi URL |

Uji: unit **571 lulus**, integrasi **76 → 83 lulus** (5 kasus baru di
`worker/catalog/catalog.integration.test.ts` untuk pilihan bahasa, 2 di
`worker/router.integration.test.ts` untuk `?locale=` kosong dan penyamaran 404),
typecheck bersih, `eslint .` bersih.

**Temuan tambahan (bukan akibat W4):** dua kasus di `e2e/create-catalog.spec.ts`
("Talking-Catalog berjalan", "subtitle dapat dipilih") gagal begitu Worker hidup karena
gerbangnya memakai `NEEDS_LIVE_WORKER`, padahal syarat sebenarnya juga mencakup
`narration.captions` yang tidak kosong. Rantainya terverifikasi: seed `captions: []` →
`TalkingCatalog` mengembalikan `null` (`if (!hasCaptions) return null`) → `Subtitles` tidak
pernah dipasang. Diperbaiki dengan gerbang baru `NEEDS_LIVE_WORKER_WITH_CAPTIONS` yang
menyebut KEDUA syarat di laporannya.

### W5 — Cloudflare remote (perlu `wrangler login` Anda)

Blocker nyata: `wrangler.jsonc` masih memuat
`database_id: "PLACEHOLDER_ISI_SETELAH_wrangler_d1_create"`.

```
wrangler login                                    ← Anda (peramban)
wrangler d1 create katavis                        → salin database_id ke wrangler.jsonc
wrangler r2 bucket create katavis-media
wrangler queues create katavis-jobs
wrangler queues create katavis-jobs-dlq
wrangler d1 migrations apply katavis --remote
wrangler secret put GROQ_API_KEY                  ×5 (GROQ, NINEROUTER, AGENT_SHARED_KEY,
                                                  JWT_SIGNING_KEY, OTP_PROVIDER_KEY)
wrangler deploy
```

Sesudah terbit: verifikasi URL publik, lalu arahkan `agent/.env` `WORKER_URL` ke alamat
`workers.dev` bila agen dijalankan terhadap Worker remote.

**Temuan yang perlu keputusan terpisah:** `GEMINI_ENABLED` tidak dibaca kode mana pun
(`worker/index.ts:147`), padahal DEMO-RUNBOOK baris 25 meminta flag itu diperiksa. Pilihannya:
(a) implementasikan gerbangnya, atau (b) hapus flagnya agar tidak menyesatkan.

### W6 — Login Gemini sekali pakai (perlu Anda; lihat bagian 4)

### W7 — Kebersihan repositori

- `.tmp-fix.py` dan `.tmp-fix2.py` — skrip sekali-pakai; dokumennya sendiri menyatakan
  "Dijalankan sekali, lalu berkasnya dihapus". Usulan: hapus.
- `.workbuddy-ai/` (memori kerja agen) ikut ter-stage; usulan: tambahkan ke `.gitignore`
  atau biarkan sebagai jejak.
- Belum ada commit sama sekali; 193 berkas ter-stage. Keputusan Anda: commit pertama atau tidak.

---

## 4. Login Gemini sekali pakai — penjelasan lengkap

### Pertanyaan: Chromium terisolasi atau tidak?

**Jawaban: Chrome asli, dengan profil yang terpisah — bukan Chromium bawaan Playwright.**

| Aspek | Ketentuan | Sumber |
|---|---|---|
| Peramban | `C:\Program Files\Google\Chrome\Application\chrome.exe` — Chrome asli | `agent/.env` `CHROME_PATH` |
| Chromium Playwright | **Dilarang** — Google menolaknya: "This browser or app may not be secure" | `agent/.env.example:31-33` |
| Isolasi | Ya: `--user-data-dir=agent/chrome-profile` — keranjang kuki terpisah, tidak menyentuh Chrome harian Anda | `agent/chrome.js:192-194` |
| Kendali | `--remote-debugging-port=9222`, disambung lewat CDP | `agent/chrome.js:193`, `agent/.env` |
| Akun | **Akun Google terpisah**, tanpa data penting | `agent/.env.example:13-14`, ADR-004, R-04 |
| Langganan | Kode tidak memerlukan Gemini Pro; ia menggerakkan antarmuka `gemini.google.com/app` | `agent/.env.example:45` |

Peringatan yang tidak boleh dilewati: otomasi Gemini web melanggar Google ToS bagian
"Don't abuse our services". Sanksinya dapat mencakup penghapusan **seluruh** akun Google —
Gmail, Drive, dan Photos pada akun yang sama. Karena itu akun utama tidak boleh dipakai.

### Konfigurasi yang dipakai

`agent/.env` (sudah dibuat, diabaikan git):
`WORKER_URL=http://127.0.0.1:8787` · `AGENT_ID=laptop-01` · `AGENT_SHARED_KEY` (sama dengan
Worker) · `CHROME_PATH` · `CHROME_PROFILE_DIR=./chrome-profile` · `CHROME_DEBUG_PORT=9222` ·
`GEMINI_URL=https://gemini.google.com/app`.

Prasyarat: Worker hidup (`pnpm run dev:worker`) — rute klaim menolak agen yang belum pernah
melapor (`worker/index.ts:1230-1236`).

### Langkah eksekusi login

1. Terminal A: `pnpm run dev:worker` → tunggu `Ready on http://127.0.0.1:8787`.
2. Terminal B: `node agent/index.js` **tanpa argumen** → jendela Chrome terbuka dengan profil
   `agent/chrome-profile` (jendela ini memang harus terlihat; mode kepala tidak dipakai untuk
   login).
3. Di jendela itu: buka `https://gemini.google.com/app`, masuk dengan **akun Google terpisah**.
   Bila Google meminta verifikasi tambahan, selesaikan manual — agen tidak pernah menyentuh
   kredensial.
4. Biarkan jendela terbuka. Terminal B: `node agent/index.js --health-check` → harapan:
   `selectors_ok` dan `chrome_session_ok` terkirim ke Worker, status sehat.
5. Jalankan agen normal: `node agent/index.js` → ia mengirim heartbeat lalu menunggu pekerjaan
   (`POST /agent/jobs/claim`).
6. Uji ujung-ke-ujung: buat produk di aplikasi → jalankan pemrosesan → pekerjaan gambar harus
   diambil agen dan selesai dengan `provider: "gemini_web"`. Bila agen tidak siap, rantai
   otomatis turun ke `workers_ai` lalu `cache` — jadi demo tidak pernah berhenti.

**Catatan sumber daya:** satu jendela Chrome ≈ 300–500 MB. Pada mesin dengan 1,7 GB bebas,
jangan menjalankan agen bersamaan dengan suite E2E penuh.

**Waktu yang disarankan:** login percobaan sekarang untuk memvalidasi selector terhadap DOM
Gemini hari ini, lalu **verifikasi ulang di H-1** (DEMO-RUNBOOK baris 23) karena sesi Google
kedaluwarsa.

---

## 5. Urutan eksekusi

1. W1 cakupan → W2 gitleaks + celah CI (tanpa keputusan tambahan)
2. W3 label + pesan galat → verifikasi TC-E2E-20/21/22
3. W4 parameter bahasa → verifikasi TC-E2E-09 dengan Worker hidup
4. W7 kebersihan repositori (menunggu jawaban Anda soal hapus/commit)
5. W5 Cloudflare remote (menunggu `wrangler login`)
6. W6 login Gemini (menunggu akun terpisah siap)
7. Sapuan verifikasi akhir: tujuh langkah + E2E penuh dengan `E2E_WITH_WORKER=1`

## 6. Definisi selesai

- Tujuh langkah verifikasi hijau, atau merah yang tersisa hanya milik fitur yang belum ada dan
  sudah tercatat dengan alasan yang tepat.
- TC-E2E-20/21/22 hijau (setelah W3); TC-E2E-09 hijau (setelah W4).
- Audit 0 temuan; gitleaks 0 temuan; cakupan terukur dan dilaporkan.
- Worker terbit di URL publik; sesi Gemini terverifikasi; agen mengambil pekerjaan nyata.
