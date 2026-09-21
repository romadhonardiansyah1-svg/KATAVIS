-- Migrasi 0002 — penyimpanan autentikasi
-- Sumber: docs/ARCHITECTURE.md bagian 6, docs/spec/API-CONTRACT.md bagian 2
-- Disetujui pemilik proyek, 17 September 2026.
-- Dijalankan: pnpm run db:migrate:local
--
-- Migrasi 0001 tidak punya tempat untuk tiga hal yang dituntut prompt P4:
-- kode OTP, hitungan batas laju, dan penguncian PIN. Ketiganya harus
-- bertahan melewati restart isolat. Batas laju yang hidup di memori Worker
-- adalah batas laju yang tidak ada — isolat dapat dimatikan kapan saja dan
-- hitungannya hilang bersama prosesnya.

CREATE TABLE IF NOT EXISTS otp_codes (
  phone       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Satu nomor punya paling banyak satu kode aktif, jadi phone menjadi kunci
-- utama: permintaan baru menimpa yang lama, bukan menumpuk. Tanpa ini,
-- tiga permintaan berturut-turut meninggalkan tiga kode yang semuanya
-- masih sah.
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);

-- Kode OTP tidak pernah disimpan mentah. Yang disimpan adalah SHA-256-nya,
-- dan perbandingannya berwaktu tetap.

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key          TEXT NOT NULL,
  occurred_at  INTEGER NOT NULL
);

-- Satu baris per kejadian. Jendela dihitung dengan COUNT sejak waktu
-- tertentu, sehingga batasnya bergeser mengikuti waktu, bukan mengikuti
-- jam dinding: tiga permintaan pada 14.59 tidak membuka jendela baru pada
-- 15.00.
CREATE INDEX IF NOT EXISTS idx_rate_key_time ON auth_rate_limits(key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_rate_time ON auth_rate_limits(occurred_at);

-- Kolom penguncian PIN. Ditaruh di users karena keadaannya per pengguna,
-- dan karena `users` sudah memuat `token_version` — satu baris, satu
-- pemeriksaan, tanpa kueri tambahan pada jalur masuk.
--
-- `pin_attempts` mengulang dari nol setiap PIN yang benar, sehingga
-- pengguna yang salah mengetik dua kali lalu benar tidak membawa sisa
-- hitungan ke sesi berikutnya.
ALTER TABLE users ADD COLUMN pin_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pin_locked_until INTEGER;
