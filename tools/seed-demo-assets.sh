#!/usr/bin/env bash
#
# Menyemai aset demo KATAVIS lewat API Worker yang SEDANG BERJALAN.
#
# MENGAPA LEWAT API, BUKAN `wrangler r2 object put`
# ------------------------------------------------
# `wrangler r2 object put --local` dan `wrangler dev` menulis ke dua tata
# letak penyimpanan yang BERBEDA meski versinya sama:
#
#   CLI      .wrangler/state/v3/r2/katavis-media/blobs/<hash>
#   dev      .wrangler/state/v3/r2/miniflare-R2BucketObject/<bucket-hash>.sqlite
#
# Objek yang diunggah CLI karena itu tidak terlihat oleh server yang sedang
# melayani permintaan, dan hasilnya tetap 404 tanpa penjelasan. Gejalanya
# persis sama dengan "berkasnya belum pernah ada", sehingga mudah disalah
# artikan sebagai kesalahan kunci atau kesalahan tanda tangan.
#
# Mengunggah lewat API menutup seluruh kemungkinan itu: yang menulis adalah
# server yang sama yang nanti membacanya, ke penyimpanan yang sama.
#
# PRASYARAT
#   1. `pnpm run dev:worker` sudah berjalan di :8787
#   2. `DEMO_MODE=true` di `.dev.vars`  — tanpanya kode OTP tidak dicatat
#      ke log, dan skrip ini tidak punya cara memperolehnya. Itu bukan
#      keterbatasan skrip, melainkan perilaku produk yang disengaja.
#
# PEMAKAIAN
#   bash tools/seed-demo-assets.sh
#
# Idempoten: semai D1 memakai INSERT OR REPLACE, dan unggahan ke kunci yang
# sama hanya menimpa objeknya.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE="http://127.0.0.1:8787/api/v1"
PHONE="+6281200000001"          # pengrajin di e2e/fixtures/seed-local-d1.sql
PRODUCT="01J8ZQFX9K7YWVTN3MABCDP012"
PHOTO="e2e/fixtures/foto-demo.png"

# Diekstrak dari log Worker. `DEMO_MODE=true` mencetaknya sebagai
# `[demo] Kode OTP untuk +62...: 123456`.
LOG_FILE="${KATAVIS_WORKER_LOG:-test-output/worker-demo.log}"

die() { echo "GAGAL: $*" >&2; exit 1; }

json() { C:/Users/Dian\ Ganteng/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

# `curl -o /dev/null` keluar dengan kode 23 di Git Bash pada Windows, dan
# `-f` kemudian melaporkan kegagalan yang tidak pernah terjadi. Seluruh
# pemeriksaan karena itu menulis ke berkas sungguhan di `test-output/tmp`,
# bukan ke `/dev/null`.
TMP="test-output/tmp"
mkdir -p "$TMP"

http_code() { curl -s -o "$TMP/probe.out" -w "%{http_code}" "$1"; }

# --- 1. Pastikan Worker hidup -------------------------------------------------

[[ "$(http_code "$BASE/health")" == "200" ]] \
  || die "Worker tidak menjawab di $BASE. Jalankan 'pnpm run dev:worker' lebih dulu."
echo "Worker hidup."

# --- 2. Dapatkan token akses --------------------------------------------------
#
# Urutannya disengaja: token yang sudah tersimpan dipakai lebih dulu, dan
# OTP hanya diminta bila belum ada. Permintaan OTP dibatasi 3 per nomor per
# jam (DEFAULT_OTP_POLICY), dan setiap permintaan MENGGANTI kode sebelumnya
# — menjalankan skrip ini berulang kali tanpa memakai ulang token akan
# menghabiskan kuota lalu gagal dengan pesan yang membingungkan.
TOKEN_FILE="test-output/tmp/demo-access-token.txt"
ACCESS=""
if [[ -f "$TOKEN_FILE" ]]; then
  ACCESS="$(cat "$TOKEN_FILE")"
  # Token akses berumur 15 menit. Yang kedaluwarsa akan ditolak pada
  # pemakaian pertama, dan di situ kita jatuh ke jalur OTP.
  if [[ "$(curl -s -o "$TMP/probe.out" -w "%{http_code}" \
        -H "Authorization: Bearer $ACCESS" "$BASE/consent")" == "200" ]]; then
    echo "Memakai token tersimpan yang masih berlaku."
  else
    echo "Token tersimpan sudah kedaluwarsa."
    ACCESS=""
  fi
fi

if [[ -z "$ACCESS" ]]; then
  echo "Meminta kode OTP untuk $PHONE..."
  curl -s -X POST "$BASE/auth/otp/request" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$PHONE\"}" -o "$TMP/otp-request.out"

  if grep -q "RATE_LIMITED" "$TMP/otp-request.out" 2>/dev/null; then
    cat <<EOF

GAGAL: batas laju OTP tercapai (3 permintaan per nomor per jam).

Ini bukan cacat — batasnya memang bekerja. Pilihan Anda:

  1. Tunggu hingga satu jam, lalu jalankan lagi.
  2. Pakai nomor lain: ubah PHONE di skrip ini. Pengrajin baru akan
     dibuat otomatis, dan produk tersemai tetap milik pengrajin lama.
  3. Pakai token yang sudah ada: salin nilai berikut ke
     $TOKEN_FILE lalu jalankan lagi.

Cara memperoleh token tanpa OTP, dari konsol peramban pada alur yang
sudah berjalan:

  copy(localStorage.getItem('katavis.accessToken'))
EOF
    exit 1
  fi

  sleep 1

  CODE="$(grep -oE "Kode OTP untuk .*: [0-9]{6}" "$LOG_FILE" 2>/dev/null \
    | tail -1 | grep -oE "[0-9]{6}$" || true)"

  if [[ -z "$CODE" ]]; then
    cat <<EOF

Kode OTP tidak ditemukan di $LOG_FILE.

Skrip ini perlu membaca log Worker. Jalankan Worker sambil menuliskan
lognya ke berkas, lalu jalankan skrip ini di terminal lain:

  pnpm run dev:worker 2>&1 | tee $LOG_FILE

Pastikan juga DEMO_MODE=true di .dev.vars — tanpanya produk memang tidak
pernah mencetak kode OTP, dan itu disengaja (penyedia SMS belum ada).
EOF
    exit 1
  fi

  echo "Kode OTP terbaca: $CODE"

  ACCESS="$(curl -s -X POST "$BASE/auth/otp/verify" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}" | json "['data']['accessToken']")"

  if [[ -z "$ACCESS" || "$ACCESS" == "None" ]]; then
    die "Verifikasi OTP tidak mengembalikan accessToken."
  fi

  mkdir -p "$(dirname "$TOKEN_FILE")"
  printf '%s' "$ACCESS" > "$TOKEN_FILE"
  echo "Sesi diperoleh dan disimpan ke $TOKEN_FILE."
fi

echo
echo "Token untuk menguji alur dari konsol peramban:"
echo
echo "  localStorage.setItem('katavis.accessToken', '$ACCESS')"
echo

# --- 4. Unggah foto demo lewat jalur resmi produk ----------------------------

BYTES="$(wc -c < "$PHOTO" | tr -d ' ')"

TICKET="$(curl -s -X POST "$BASE/products/$PRODUCT/media/upload-url" \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d "{\"kind\":\"photo_original\",\"mimeType\":\"image/png\",\"bytes\":$BYTES}")"

UPLOAD_URL="$(echo "$TICKET" | json "['data']['uploadUrl']")"
MEDIA_ID="$(echo "$TICKET" | json "['data']['mediaId']")"

[[ -n "$UPLOAD_URL" ]] || die "Tidak memperoleh uploadUrl. Jawaban: $TICKET"

echo "Mengunggah $PHOTO ($BYTES bita) sebagai media baru $MEDIA_ID..."
curl -s -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/png" \
  --data-binary "@$PHOTO" -o "$TMP/upload.out"

echo "Mengonfirmasi unggahan (pemeriksaan magic bytes di server)..."
curl -s -X POST "$BASE/products/$PRODUCT/media/$MEDIA_ID/confirm" \
  -H "Authorization: Bearer $ACCESS" -o "$TMP/confirm.out"

# Konfirmasi yang gagal berarti magic bytes tidak cocok. Itu kegagalan yang
# harus terlihat, bukan dilewati — berkasnya tidak akan pernah tersaji.
if grep -q '"ok": *false' "$TMP/confirm.out" 2>/dev/null; then
  die "Konfirmasi media ditolak: $(cat "$TMP/confirm.out")"
fi

# --- 5. Periksa hasilnya ------------------------------------------------------

echo
echo "Memeriksa katalog publik..."
CATALOG_URL="$(curl -s "$BASE/public/catalog/tas-kulit-nusantara" | json "['data']['media'][0]['url']")"

if [[ -z "$CATALOG_URL" || "$CATALOG_URL" == "None" ]]; then
  die "Katalog publik tidak mengembalikan URL media."
fi

HTTP="$(http_code "$CATALOG_URL")"
SIZE="$(wc -c < "$TMP/probe.out" | tr -d ' ')"

echo "  URL   : $CATALOG_URL"
echo "  Status: HTTP $HTTP"
echo "  Ukuran: $SIZE bita"

if [[ "$HTTP" == "200" && "$SIZE" -gt 1000 ]]; then
  echo
  echo "Selesai — foto katalog publik sekarang benar-benar dapat dimuat."
else
  die "URL media belum mengembalikan gambar (HTTP $HTTP, $SIZE bita)."
fi
