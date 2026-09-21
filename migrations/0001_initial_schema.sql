-- Migrasi 0001 — skema awal KATAVIS
-- Sumber: docs/ARCHITECTURE.md bagian 6
-- Dijalankan: pnpm run db:migrate:local

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  phone         TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('artisan','caregiver','admin','buyer')),
  pin_hash      TEXT,
  a11y_profile  TEXT,
  locale        TEXT NOT NULL DEFAULT 'id',
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

-- token_version menaik saat logout-all atau pencabutan akses pendamping.
-- Setiap permintaan membandingkan nilai di token dengan nilai di sini.
-- Inilah yang membuat pencabutan berlaku SEKETIKA, bukan sekadar
-- mengubah status baris. Diuji di TC-I-04, TC-SEC-16.

CREATE TABLE IF NOT EXISTS consents (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('audio_processing','publication')),
  granted      INTEGER NOT NULL DEFAULT 0,
  granted_at   INTEGER,
  revoked_at   INTEGER,
  UNIQUE (user_id, kind)
);

CREATE TABLE IF NOT EXISTS caregiver_links (
  id            TEXT PRIMARY KEY,
  artisan_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caregiver_id  TEXT REFERENCES users(id) ON DELETE CASCADE,
  invite_phone  TEXT NOT NULL,
  invite_token  TEXT UNIQUE,
  permissions   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','active','revoked','expired')),
  invited_at    INTEGER NOT NULL,
  granted_at    INTEGER,
  revoked_at    INTEGER,
  expires_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_caregiver_active ON caregiver_links(caregiver_id, status);
CREATE INDEX IF NOT EXISTS idx_caregiver_artisan ON caregiver_links(artisan_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_caregiver_pair
  ON caregiver_links(artisan_id, caregiver_id) WHERE caregiver_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,
  artisan_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('draft','processing','review','published','archived')),
  slug          TEXT UNIQUE,
  progress      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  published_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_products_artisan ON products(artisan_id, status, updated_at);

CREATE TABLE IF NOT EXISTS product_content (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  locale        TEXT NOT NULL,
  name          TEXT,
  story         TEXT,
  specs         TEXT,
  social_copy   TEXT,
  seo_keywords  TEXT,
  source        TEXT NOT NULL CHECK (source IN ('ai','human','ai_edited')),
  updated_at    INTEGER NOT NULL,
  UNIQUE (product_id, locale)
);

-- Dipisah per bahasa agar kegagalan satu bahasa tidak merusak yang lain.
-- Menegakkan kriteria F1-07. Diuji di TC-U-JOB-10.

CREATE TABLE IF NOT EXISTS transcripts (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  locale        TEXT NOT NULL DEFAULT 'id',
  reviewed      INTEGER NOT NULL DEFAULT 0,
  edited        INTEGER NOT NULL DEFAULT 0,
  provider      TEXT,
  duration_ms   INTEGER,
  created_at    INTEGER NOT NULL,
  reviewed_at   INTEGER,
  UNIQUE (product_id)
);

-- reviewed=0 memblokir POST /products/:id/generate dengan
-- TRANSCRIPT_NOT_REVIEWED. Menegakkan ADR-008 di tingkat data,
-- bukan hanya di antarmuka.

CREATE TABLE IF NOT EXISTS media_assets (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('photo_original','photo_studio','audio_raw','audio_tts')),
  r2_key        TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  alt_text      TEXT,
  provider      TEXT,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending','confirmed','failed')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_product ON media_assets(product_id, kind);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('asr','copy','image','tts','export')),
  status        TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  provider      TEXT,
  locale        TEXT,
  attempt       INTEGER NOT NULL DEFAULT 0,
  progress      INTEGER NOT NULL DEFAULT 0,
  error_code    TEXT,
  payload       TEXT,
  claimed_by    TEXT,
  deadline_at   INTEGER,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  completed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_product ON jobs(product_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON jobs(status, kind, deadline_at);

-- error_code, bukan error_message. Kode internal dipetakan ke pesan
-- ramah di lapisan penyajian, sehingga "Error 500" tidak pernah
-- bocor ke pengrajin. Lihat docs/spec/API-CONTRACT.md bagian 12.

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  agent_id           TEXT PRIMARY KEY,
  healthy            INTEGER NOT NULL DEFAULT 0,
  selectors_ok       INTEGER NOT NULL DEFAULT 0,
  chrome_session_ok  INTEGER NOT NULL DEFAULT 0,
  last_seen_at       INTEGER NOT NULL
);

-- Tanpa heartbeat sehat selama 30 detik, pekerjaan gambar langsung
-- menuju Workers AI tanpa menunggu batas 45 detik. Diuji di TC-SA-02.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  response_body TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id            TEXT PRIMARY KEY,
  actor_id      TEXT NOT NULL REFERENCES users(id),
  on_behalf_of  TEXT REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  metadata      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log(actor_id, created_at);

-- on_behalf_of terisi saat pendamping bertindak. Tanpa kolom ini,
-- tindakan pendamping tercatat seolah dilakukan pengrajin, dan
-- pengrajin kehilangan kemampuan mengaudit karyanya sendiri.
-- Menjawab Fitur pendukung.pdf hal. 5.
