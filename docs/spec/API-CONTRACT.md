# Kontrak API KATAVIS

**Versi** 1.0 · **Tanggal** 15 September 2026

Dokumen ini mengikat. Frontend dan backend ditulis terhadap kontrak ini, bukan terhadap asumsi.
Perubahan kontrak menuntut pembaruan dokumen ini lebih dulu, bukan sesudah kode berubah.

---

## 1. Aturan umum

```
Basis URL   /api/v1
Format      application/json, kecuali unggah biner
Waktu       epoch milidetik (integer), bukan string ISO
ID          ULID 26 karakter
Bahasa      kode BCP-47: id, en, ja, zh, ar
```

### Bentuk respons — seragam tanpa kecuali

Berhasil:
```json
{ "ok": true, "data": { } }
```

Gagal:
```json
{
  "ok": false,
  "error": {
    "code": "ASR_NO_SPEECH",
    "message": "Suara belum terdengar jelas. Silakan rekam lagi di tempat yang lebih tenang.",
    "action": "RETRY_RECORD",
    "workSafe": true
  }
}
```

Tiga bidang pada `error` bersifat wajib dan menegakkan ketentuan `Fitur pendukung.pdf` hal. 6–7:

| Bidang | Arti | Mengapa wajib |
|---|---|---|
| `message` | Kalimat untuk pengrajin | Tidak pernah memuat istilah teknis, kode, atau nomor status |
| `action` | Langkah berikutnya | Antarmuka memetakannya ke tombol |
| `workSafe` | Apakah pekerjaan pengguna aman | Pertanyaan pertama pengguna saat gagal |

`code` dipakai frontend untuk logika, tidak pernah ditampilkan.

### Autentikasi

```
Authorization: Bearer <access_token>
```

Access token berumur 15 menit. Refresh token berumur 30 hari sejak aktivitas terakhir.

### Header wajib pada permintaan yang mengubah data

```
Idempotency-Key: <ULID>
```

Mencegah pekerjaan ganda saat jaringan buruk — kondisi yang lazim pada pengguna sasaran.
Kunci yang sama dalam 24 jam mengembalikan respons pertama, bukan membuat entitas baru.

---

## 2. Auth

### `POST /auth/otp/request`

```json
// Permintaan
{ "phone": "+628123456789" }

// Respons — SELALU bentuk ini, terdaftar maupun tidak
{ "ok": true, "data": { "expiresAt": 1757900000000, "resendAfter": 1757899940000 } }
```

Respons seragam mencegah pemetaan nomor pengguna. Diuji di TC-SEC-14.

Batas: 3 permintaan per nomor per jam, 10 per IP per jam. Terlampaui → `429`, `RATE_LIMITED`.

### `POST /auth/otp/verify`

```json
// Permintaan
{ "phone": "+628123456789", "code": "123456" }

// Respons
{
  "ok": true,
  "data": {
    "accessToken": "...", "refreshToken": "...", "expiresIn": 900,
    "user": {
      "id": "01J...", "displayName": "Irsyad", "role": "artisan",
      "locale": "id", "a11yProfile": null, "isNewUser": false
    }
  }
}
```

Salah 5 kali → terkunci 15 menit, `ACCOUNT_LOCKED`. Diuji di TC-SEC-13.

### `POST /auth/pin/set` · `POST /auth/pin/verify`

PIN 6 digit sebagai alternatif untuk pengguna dengan keterbatasan kognitif
(`Fitur pendukung.pdf` hal. 6). Disimpan sebagai hash Argon2id, tidak pernah plaintext.

### `POST /auth/refresh` · `POST /auth/logout` · `POST /auth/logout-all`

`logout-all` membatalkan seluruh refresh token milik pengguna.

---

## 3. Persetujuan

### `POST /consent`

```json
// Permintaan
{ "kind": "audio_processing", "granted": true }
// kind: "audio_processing" | "publication"
```

Server menolak `POST /products/:id/audio` tanpa `audio_processing`, dan
`POST /products/:id/publish` tanpa `publication`. Diuji di TC-I-14, TC-I-15.

### `GET /consent`

```json
{ "ok": true, "data": { "audioProcessing": { "granted": true, "grantedAt": 175... },
                        "publication": { "granted": false, "grantedAt": null } } }
```

---

## 4. Produk

### `POST /products`

```json
// Permintaan
{}

// Respons
{ "ok": true, "data": { "id": "01J...", "status": "draft", "progress": 0, "createdAt": 175... } }
```

Membuat draf kosong. Wajib memakai `Idempotency-Key`.

### `GET /products?status=&cursor=&limit=`

```json
{
  "ok": true,
  "data": {
    "items": [ { "id": "01J...", "status": "published", "name": "Tas Kulit Nusantara",
                 "primaryPhotoUrl": "https://...", "progress": 100, "updatedAt": 175... } ],
    "nextCursor": "01J..."
  }
}
```

`limit` maksimum 20. Paginasi berbasis kursor, bukan offset — `OFFSET` yang besar menghabiskan
jatah kueri D1.

### `GET /products/:id`

```json
{
  "ok": true,
  "data": {
    "id": "01J...", "status": "review", "progress": 80,
    "content": {
      "id": { "name": "Tas Kulit Nusantara", "story": "...", "specs": ["Kulit sapi nabati"],
              "socialCopy": "...", "seoKeywords": ["tas kulit"], "source": "ai_edited" },
      "en": { "...": "..." }
    },
    "media": [ { "id": "01J...", "kind": "photo_studio", "url": "https://...",
                 "altText": "Tas kulit cokelat di atas marmer", "isPrimary": true,
                 "provider": "workers_ai" } ],
    "jobs": [ { "id": "01J...", "kind": "image", "status": "succeeded", "provider": "workers_ai" } ],
    "transcript": { "text": "...", "edited": true, "locale": "id" }
  }
}
```

Satu panggilan mengembalikan seluruh yang dibutuhkan layar. Ini disengaja: batas D1 free adalah
**50 kueri per invocation**, sehingga endpoint yang memaksa frontend memanggil berulang justru
berbahaya. Implementasi wajib memakai `batch()`. Diuji di TC-PERF-04.

### `PATCH /products/:id/content/:locale`

```json
{ "name": "Tas Kulit Nusantara", "story": "...", "specs": ["..."],
  "socialCopy": "...", "seoKeywords": ["..."] }
```

Seluruh bidang opsional. Yang dikirim diperbarui; `source` otomatis menjadi `ai_edited`.

### `POST /products/:id/submit`

Mengajukan produk untuk ditinjau: status `processing` menjadi `review`.
Tanpa memanggil endpoint ini, `POST .../publish` selalu menolak dengan
`FORBIDDEN` karena transisi `processing → published` tidak ada.

```json
// Permintaan
{}

// Respons
{ "ok": true, "data": { "id": "01J...", "status": "review" } }
```

Menolak bila: pemanggil bukan pemilik atau pendamping berizin
`submit_review` (`FORBIDDEN`), atau status bukan `processing` (`FORBIDDEN`).

### `POST /products/:id/publish`

```json
// Permintaan
{ "consentConfirmed": true }
```
Menolak bila: persetujuan publikasi belum ada (`CONSENT_REQUIRED`), konten `id` belum lengkap
(`CONTENT_INCOMPLETE`), tidak ada foto utama (`PHOTO_REQUIRED`), atau pemanggil adalah pendamping
(`FORBIDDEN`).

**Pendamping tidak pernah dapat menerbitkan.** Diuji di TC-U-RBAC-04.

### `DELETE /products/:id`

Hanya pemilik. Pendamping ditolak — TC-U-RBAC-07. Wajib `?confirm=true`.

---

## 5. Media

### `POST /products/:id/media/upload-url`

```json
// Permintaan
{ "kind": "photo_original", "mimeType": "image/jpeg", "bytes": 2400000 }

// Respons
{ "ok": true, "data": { "mediaId": "01J...", "uploadUrl": "https://...", "expiresAt": 175... } }
```

Klien melakukan `PUT` biner langsung ke `uploadUrl`. `uploadUrl` adalah URL bertanda tangan milik
Worker: HMAC-SHA256 atas kunci objek, jenis MIME, dan masa berlaku. Rute itu meneruskan isi
permintaan ke R2 **tanpa membuffer**, sehingga batas 10 MB per berkas berada jauh di dalam batas
ukuran permintaan Workers.

*Catatan revisi 17 September 2026.* Kalimat sebelumnya menyatakan "Worker tidak pernah menyalurkan
berkas". Yang memenuhi pernyataan itu adalah presigned URL dari API S3 R2, dan ia tidak dipakai
karena menuntut kredensial R2 yang belum ada sekaligus tidak dapat diuji di Miniflare — Miniflare
tidak menyediakan API S3. Untuk berkas maksimal 10 MB, meneruskan isi permintaan sebagai stream
tidak menahan berkas di memori isolat.

URL berumur 15 menit. Diuji di TC-I-06, TC-SEC-11.

Validasi server:

| Aturan | Galat |
|---|---|
| `bytes` > 10 MB | `FILE_TOO_LARGE` |
| MIME bukan `image/jpeg`, `image/png`, `image/webp` | `UNSUPPORTED_FORMAT` |
| MIME `image/svg+xml` | `UNSUPPORTED_FORMAT` — SVG dapat memuat skrip |

### Membaca berkas media — `GET /media/:token`

Bukan endpoint yang dinamai klien, melainkan pasangan baca dari URL bertanda tangan di atas. Ia
muncul di dua tempat sebagai nilai `media[].url`: detail produk (§4) dan katalog publik (§10).

```json
// Yang diterima klien pada media[].url
"http://127.0.0.1:8787/api/v1/media/eyJrZXkiOiJ...fQ.LLZPLH_H1mHfZ0UTWydS9XpLTr5cA-lQocDiwSouXQE"
```

Tokennya berisi kunci objek R2 dan masa berlakunya, ditandatangani HMAC-SHA256 dengan kunci yang
sama seperti token unggah. Tiga konsekuensi yang perlu diketahui klien:

| Sifat | Nilai |
|---|---|
| Masa berlaku | 24 jam — jauh lebih panjang dari URL unggah |
| Sumber | ditandatangani saat tanggapan dibuat, jadi `url` dapat berubah antarpermintaan |
| Kegagalan | `403 FORBIDDEN` bila tanda tangan tidak sah, kedaluwarsa, atau kuncinya di luar `products/`; `404 NOT_FOUND` bila objeknya memang sudah tidak ada |

*Alasan umurnya 24 jam, bukan 15 menit.* URL ini tertanam di HTML katalog yang di-cache dan
dikirim lewat WhatsApp; tautan yang mati dalam seperempat jam membuat pembeli melihat gambar rusak
keesokan harinya. URL unggah tidak mengalami masalah itu karena hanya dipakai sekali, detik itu
juga, oleh klien yang baru saja memintanya.

*Catatan revisi 21 September 2026.* Sebelum ini `media[].url` berisi kunci R2 mentah
(`products/01J.../foto-asli.jpg`) dan tidak ada satu pun rute yang melayani pembacaan byte dari
R2. Akibatnya setiap gambar produk di demo menampilkan gambar rusak. Rute ini menutupnya, dan
`CatalogMediaSchema` di `components/catalog/timeline.ts` kini menolak nilai yang bukan URL absolut
— kunci R2 mentah juga berupa teks yang sah, dan justru itulah sebabnya cacat tersebut sempat lolos.

### `POST /products/:id/media/:mediaId/confirm`

Dipanggil setelah `PUT` berhasil. Server memeriksa **magic bytes**, bukan ekstensi atau MIME yang
dikirim klien. Berkas berekstensi `.jpg` berisi HTML ditolak dengan `CONTENT_MISMATCH`.
Diuji di TC-U-CAT-06.

### `PATCH /products/:id/media/:mediaId`

```json
{ "altText": "Tas kulit cokelat di atas meja marmer", "isPrimary": true }
```

---

## 6. Audio dan transkrip

### `POST /products/:id/audio`

`multipart/form-data`, bidang `audio`, maksimum 10 MB.

```json
{ "ok": true, "data": { "jobId": "01J...", "kind": "asr", "status": "queued" } }
```

Ditolak bila persetujuan `audio_processing` belum ada → `CONSENT_REQUIRED`.

| Aturan | Galat |
|---|---|
| Durasi < 10 detik | `ASR_TOO_SHORT` |
| Durasi > 60 detik | `ASR_TOO_LONG` |
| Tanpa ucapan terdeteksi | `ASR_NO_SPEECH` |

### `GET /products/:id/transcript`

```json
{ "ok": true, "data": { "text": "Ini tas dari kulit sapi...", "locale": "id",
                        "edited": false, "provider": "groq", "durationMs": 31200 } }
```

### `PUT /products/:id/transcript`

```json
{ "text": "Ini tas dari kulit sapi samak nabati..." }
```

**Langkah wajib sebelum generate konten.** Memanggil `POST /products/:id/generate` tanpa transkrip
yang ditinjau mengembalikan `TRANSCRIPT_NOT_REVIEWED`. Ini menegakkan ADR-008 di tingkat server,
bukan hanya di antarmuka.

Menekan "Sudah benar" tanpa perubahan tetap memanggil endpoint ini dengan teks yang sama. Yang
ditandai adalah tindakan meninjau, bukan tindakan menyunting.

---

## 7. Pekerjaan AI

### `POST /products/:id/generate`

```json
// Permintaan
{ "tasks": ["copy", "image"], "locales": ["id", "en"], "imageStyle": "marble_light", "imagePrompt": "Letakkan produk di atas..." }
```

`imageStyle`: `marble_light` | `wood_warm` | `dark_gradient` | `rattan_natural` | `clay_minimal`

`imagePrompt` (opsional, maks 2000 karakter): prompt studio final, biasanya
hasil penajaman AI atas keinginan pengrajin. Bila ada, dipakai apa adanya
untuk pekerjaan gambar. Bila kosong, server menyusun prompt otomatis dari
transkrip dan gaya — sehingga prompt selalu menyesuaikan produk.

```json
// Respons
{ "ok": true, "data": { "jobs": [ { "id": "01J...", "kind": "copy", "status": "queued" },
                                  { "id": "01J...", "kind": "image", "status": "queued" } ] } }
```

### `POST /products/:id/image-prompt`

Menyusun prompt foto studio final sebelum generate. Tiga mode dalam satu
endpoint: tanpa `manual`, jawabannya prompt otomatis dari transkrip (mode
`"auto"`); dengan `manual`, AI mempertajam keinginan pengrajin (mode
`"sharpened"`).

Endpoint ini tidak pernah gagal dengan galat AI: bila seluruh lapis teks
gagal, jawabannya adalah prompt otomatis.

```json
// Permintaan
{ "style": "wood_warm", "manual": "latar sawah sore hari" }

// Respons
{ "ok": true, "data": { "prompt": "Edit foto produk yang ...", "mode": "sharpened", "style": "wood_warm" } }
```

### `GET /products/:id/jobs`

Polling setiap 2 detik saat ada pekerjaan berjalan.

```json
{
  "ok": true,
  "data": {
    "jobs": [
      { "id": "01J...", "kind": "copy", "status": "succeeded", "provider": "9router",
        "progress": 100, "startedAt": 175..., "completedAt": 175... },
      { "id": "01J...", "kind": "image", "status": "running", "provider": "gemini_web",
        "progress": 45, "attempt": 1, "startedAt": 175... }
    ],
    "overallProgress": 72
  }
}
```

`provider` berubah saat fallback aktif: `gemini_web` → `workers_ai`. Antarmuka tidak menampilkan
nilai ini ke pengrajin, tetapi berguna saat demo dan wajib tercatat di log.

Pekerjaan gagal menyertakan bentuk `error` yang sama seperti bagian 1.

### `POST /products/:id/jobs/:jobId/retry`

Maksimum 3 percobaan per pekerjaan. Terlampaui → `MAX_RETRIES_EXCEEDED`.

---

## 8. Antrian Studio Agent

Dipakai Studio Agent di laptop, bukan browser. Autentikasi memakai kunci agen terpisah.

```
X-Agent-Key: <secret>
```

### `POST /agent/heartbeat`

```json
// Permintaan
{ "agentId": "laptop-01", "healthy": true, "selectorsOk": true, "chromeSessionOk": true }

// Respons
{ "ok": true, "data": { "acknowledged": true } }
```

Dikirim setiap 15 detik. **Tanpa heartbeat sehat selama 30 detik, pekerjaan gambar langsung menuju
Workers AI tanpa menunggu batas 45 detik.** Ini yang membuat TC-SA-02 lolos: agen yang mati tidak
memperlambat siapa pun.

### `POST /agent/jobs/claim`

```json
// Permintaan
{ "agentId": "laptop-01", "max": 1 }

// Respons
{ "ok": true, "data": { "jobs": [ { "id": "01J...", "productId": "01J...",
    "sourceImageUrl": "https://...", "prompt": "...", "deadlineAt": 175... } ] } }
```

`max` dibatasi 1. Satu peramban tidak menjalankan dua pekerjaan bersamaan — TC-SA-05.

`deadlineAt` adalah waktu absolut, bukan durasi. Agen yang jamnya bergeser tetap tahu kapan berhenti.

### `POST /agent/jobs/:jobId/complete` · `POST /agent/jobs/:jobId/fail`

```json
// complete
{ "r2Key": "products/01J.../studio-1.webp", "durationMs": 28400 }

// fail
{ "reason": "selector_not_found", "durationMs": 45000 }
```

`reason`: `selector_not_found` | `session_expired` | `timeout` | `generation_refused` | `unknown`

Kegagalan mengembalikan pekerjaan ke antrian dengan penanda `gemini_failed`, lalu consumer
Workers AI mengambilnya.

### `POST /agent/jobs/:jobId/upload-url`

Menerbitkan URL unggah untuk hasil Studio Agent. Cerminan rute sesi
`POST /products/:id/media/upload-url`, tetapi berotorisasi kunci agen:
agen tidak memegang token sesi pengrajin. Jenis aset selalu
`photo_studio` milik produk pada pekerjaan itu.

```json
// Permintaan
{ "mimeType": "image/png", "bytes": 184320 }

// Respons
{ "ok": true, "data": { "mediaId": "01J...", "uploadUrl": "https://...", "expiresAt": 175... } }
```

### `POST /agent/jobs/:jobId/confirm-upload`

Mengonfirmasi berkas yang baru diunggah agen (magic bytes, lalu
`confirmed`) dan mengembalikan `r2Key` untuk dipakai pada `/complete`.
Menolak aset milik produk lain dengan `NOT_FOUND`.

```json
// Permintaan
{ "mediaId": "01J..." }

// Respons
{ "ok": true, "data": { "mediaId": "01J...", "r2Key": "products/01J.../studio-01J....png", "bytes": 184320 } }
```

### `GET /agent/jobs/:jobId/source-image`

Mengunduh foto asli produk sebagai biner, supaya agen dapat melampirkannya
ke Gemini web. Tanpa foto terlampir, Gemini mengarang produk lain.

Merupakan `image/jpeg`/`png`/`webp` sesuai yang diunggah pengrajin.

---

## 9. Pendamping

### `POST /caregivers/invite`

```json
// Permintaan
{ "phone": "+628123456789", "permissions": ["edit_draft", "upload_media"] }
```

Izin yang tersedia: `edit_draft`, `upload_media`, `submit_review`.
**`publish` dan `delete` tidak ada dalam daftar** — keduanya tidak dapat didelegasikan.

Seluruh izin mati secara bawaan. Undangan berlaku 24 jam, sekali pakai.
Diuji di TC-U-RBAC-13, TC-SEC-15.

### `POST /caregivers/accept`

```json
{ "token": "..." }
```

### `GET /caregivers` · `DELETE /caregivers/:linkId`

**Pencabutan wajib membatalkan token aktif pendamping seketika**, bukan sekadar mengubah status
baris. Implementasi menaikkan `tokenVersion` pengguna dan memeriksa nilainya pada setiap permintaan.

Ini pengujian keamanan terpenting di sistem — TC-I-04, TC-SEC-16, TC-E2E-05.

---

## 10. Ekspor dan katalog publik

### `POST /products/:id/export`

```json
{ "format": "pdf", "locale": "id" }
// format: "pdf" | "csv_merchant" | "json"
```

### `GET /public/catalog/:slug?locale=id`

Tanpa autentikasi. Hanya produk `published`. Produk `draft` mengembalikan `404`, bukan `403` —
`403` membocorkan keberadaan produk.

`locale` opsional, bawaannya `"id"`. Salah satu dari `id` | `en` | `ja` | `zh` | `ar` (§1). Nilai di
luar daftar itu mengembalikan `404`, bukan `400`: titik akhir ini publik, dan membedakan "bahasa
salah" dari "produk tidak ada" hanya memberi tahu penebak bahwa slug-nya benar. Bahasa yang sah
tetapi belum punya baris konten di basis data juga mengembalikan `404`.

```json
{
  "ok": true,
  "data": {
    "name": "Tas Kulit Nusantara", "story": "...", "specs": ["..."],
    "artisan": { "displayName": "Irsyad" },
    "media": [ { "url": "...", "altText": "..." } ],
    "narration": { "audioUrl": "https://...", "captions": [
      { "startMs": 0, "endMs": 3200, "text": "Tas ini dibuat dari kulit sapi pilihan." } ] },
    "availableLocales": ["id", "en"],
    "locale": "id"
  }
}
```

`locale` pada respons adalah bahasa yang benar-benar dilayani, bukan yang diminta. Klien memakainya
untuk menyoroti pilihan yang sedang terbuka: `availableLocales` hanya menyebut bahasa apa saja yang
ada dan urutannya tidak menjanjikan apa pun.

`captions` adalah teks dengan waktu, bukan berkas video. Ini yang memungkinkan subtitle dipilih,
disalin, dan dibaca screen reader — TC-A11Y-28.

`artisan` hanya memuat nama tampilan. Nomor telepon dan identitas lain tidak pernah dikirim ke
titik akhir publik.

---

## 11. Preferensi aksesibilitas

### `PUT /me/a11y-profile`

```json
{ "visual": true, "hearing": false, "motor": true, "cognitive": false, "voice": false }
```

Profil dapat digabung. Tersimpan di server agar berlaku lintas perangkat — TC-I-13.

---

## 12. Daftar error code lengkap

Frontend memetakan `code` ke tampilan. `message` dari server sudah siap tampil, tetapi frontend
boleh menimpanya untuk keperluan i18n.

Kolom `action` adalah kode mesin. Label tombolnya ada di `lib/errors.ts` (`ACTION_LABELS`), dan
tipe `Record<ErrorAction, string>` membuat kode aksi baru tanpa label gagal saat typecheck.

| `code` | HTTP | `action` | `workSafe` | Pesan |
|---|---|---|---|---|
| `UNAUTHENTICATED` | 401 | `LOGIN` | true | Sesi Anda sudah berakhir. Pekerjaan Anda tetap tersimpan. Silakan masuk lagi. |
| `FORBIDDEN` | 403 | `NONE` | true | Anda tidak punya akses untuk tindakan ini. Pekerjaan Anda tetap aman. Kembali ke halaman sebelumnya. |
| `NOT_FOUND` | 404 | `GO_BACK` | true | Halaman tidak ditemukan. Pekerjaan Anda tidak hilang. Kembali ke halaman sebelumnya. |
| `RATE_LIMITED` | 429 | `WAIT` | true | Terlalu banyak percobaan. Pekerjaan Anda tetap tersimpan. Coba lagi beberapa menit lagi. |
| `ACCOUNT_LOCKED` | 423 | `WAIT` | true | Akun terkunci sementara. Pekerjaan Anda tetap tersimpan. Coba lagi 15 menit lagi. |
| `CONSENT_REQUIRED` | 403 | `GIVE_CONSENT` | true | Perlu persetujuan Anda sebelum melanjutkan. Katalog Anda tetap utuh. |
| `FILE_TOO_LARGE` | 413 | `PICK_OTHER_FILE` | true | Foto terlalu besar, maksimal 10 MB. Pekerjaan Anda tetap tersimpan. Pilih foto lain. |
| `UNSUPPORTED_FORMAT` | 415 | `PICK_OTHER_FILE` | true | Format foto tidak didukung. Pekerjaan Anda tetap tersimpan. Gunakan JPG atau PNG. |
| `CONTENT_MISMATCH` | 400 | `PICK_OTHER_FILE` | true | Berkas ini bukan foto. Pekerjaan Anda tetap tersimpan. Silakan pilih foto lain. |
| `ASR_TOO_SHORT` | 400 | `RETRY_RECORD` | true | Rekaman terlalu pendek. Cerita Anda tidak hilang. Rekam lagi sekitar 30 detik. |
| `ASR_TOO_LONG` | 400 | `RETRY_RECORD` | true | Rekaman terlalu panjang. Cerita Anda tidak hilang. Rekam lagi maksimal 60 detik. |
| `ASR_NO_SPEECH` | 422 | `RETRY_RECORD` | true | Suara belum terdengar jelas. Cerita Anda tidak hilang. Rekam lagi di tempat lebih tenang. |
| `TRANSCRIPT_NOT_REVIEWED` | 409 | `REVIEW_TRANSCRIPT` | true | Periksa dulu hasil transkrip Anda. Draf Anda tetap tersimpan. |
| `CONTENT_INCOMPLETE` | 409 | `COMPLETE_CONTENT` | true | Katalog belum lengkap. Draf Anda tetap tersimpan. Lengkapi dulu nama dan cerita produk. |
| `PHOTO_REQUIRED` | 409 | `ADD_PHOTO` | true | Tambahkan minimal satu foto produk. Draf Anda tetap tersimpan. |
| `IMAGE_GENERATE_FAILED` | 502 | `RETRY_OR_USE_ORIGINAL` | **true** | Foto studio belum berhasil dibuat. Foto asli Anda tetap tersimpan. Coba lagi atau pakai foto asli. |
| `COPY_GENERATE_FAILED` | 502 | `RETRY` | **true** | Cerita belum berhasil dibuat. Rekaman Anda tetap tersimpan. Coba lagi. |
| `MAX_RETRIES_EXCEEDED` | 429 | `USE_ORIGINAL` | true | Sudah dicoba beberapa kali. Foto asli Anda tetap tersimpan. Pakai foto asli. |
| `QUOTA_EXCEEDED` | 503 | `WAIT` | true | Sistem sedang sibuk. Pekerjaan Anda tetap tersimpan. Tunggu sebentar lalu coba lagi. |
| `NETWORK_OFFLINE` | — | `WAIT_ONLINE` | true | Tidak ada koneksi. Pekerjaan Anda tetap tersimpan dan akan dilanjutkan. Tunggu sampai tersambung kembali. |
| `INVITE_EXPIRED` | 410 | `REQUEST_NEW_INVITE` | true | Undangan sudah kedaluwarsa. Pekerjaan Anda tetap tersimpan. Minta undangan baru. |
| `INVITE_ALREADY_USED` | 409 | `NONE` | true | Undangan ini sudah dipakai. Pekerjaan Anda tetap tersimpan. Kembali dan masuk dengan akun Anda. |
| `INTERNAL_ERROR` | 500 | `RETRY` | true | Terjadi gangguan. Pekerjaan Anda tetap tersimpan. Coba lagi. |

**Seluruh baris bernilai `workSafe: true`.** Ini bukan kebetulan melainkan invarian sistem:
kegagalan apa pun tidak boleh menghilangkan pekerjaan pengguna. Bila suatu saat muncul galat yang
memaksa `workSafe: false`, itu pertanda cacat rancangan, bukan alasan menambah baris baru.

Diuji di TC-E2E-20 sampai TC-E2E-22.

---

## 13. Yang secara sadar tidak ada

| Tidak ada | Alasan |
|---|---|
| WebSocket / SSE untuk progres | Polling 2 detik cukup untuk pekerjaan 60 detik dan jauh lebih sederhana. Durable Objects untuk ini adalah biaya tanpa imbalan. |
| Endpoint pembayaran | Di luar lingkup rilis — PRD bagian 5.3 |
| GraphQL | Satu klien, kebutuhan pengambilan data tetap. REST cukup. |
| Endpoint admin batch | Volume produk tidak menuntutnya sebelum final. |
