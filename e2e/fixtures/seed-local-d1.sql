-- Semai produk terbit untuk pengujian E2E katalog publik.
--
-- Dipakai bersama `E2E_WITH_WORKER=1`:
--
--   pnpm exec wrangler d1 execute katavis --local --file=e2e/fixtures/seed-local-d1.sql
--   pnpm run dev:worker          # Worker di :8787
--   E2E_WITH_WORKER=1 pnpm run test:e2e
--
-- Mengapa ada: halaman katalog publik adalah Server Component — pengambilannya
-- terjadi di server Next.js, dan `page.route` (yang bekerja di tingkat
-- peramban) tidak pernah melihat permintaan itu. Satu-satunya cara mengujinya
-- adalah dengan Worker yang benar-benar berjalan dan data yang benar-benar ada.
--
-- Isinya mengikuti TEST-PLAN bagian 12: produk kriya nyata dengan teks nyata,
-- bukan lorem. Nama dan cerita sama dengan yang diasersikan `e2e/` sehingga
-- kedua sisi tidak dapat berbeda pendapat.
--
-- Idempoten: baris lama dengan id yang sama diganti, bukan digandakan.

-- Pengrajin. `display_name` inilah satu-satunya identitas yang boleh sampai ke
-- titik akhir publik; nomor telepon tidak pernah dikirim.
INSERT OR REPLACE INTO users
  (id, phone, display_name, role, locale, token_version, created_at)
VALUES
  ('01J8ZQFX9K7YWVTN3MABCDU01', '+6281200000001', 'Irsyad', 'artisan', 'id', 0, 1758000000000);

-- Produk terbit. `slug` harus sama dengan `SLUG` di `e2e/support/flow.ts`.
INSERT OR REPLACE INTO products
  (id, artisan_id, status, slug, progress, created_at, updated_at, published_at)
VALUES
  ('01J8ZQFX9K7YWVTN3MABCDP01', '01J8ZQFX9K7YWVTN3MABCDU01', 'published',
   'tas-kulit-nusantara', 100, 1758000000000, 1758000100000, 1758000100000);

-- Konten lima bahasa. `availableLocales` pada respons dihitung dari baris yang
-- `name`-nya tidak null, jadi kelimanya muncul di pemilih bahasa halaman.
-- `specs` dan `seo_keywords` disimpan sebagai larik JSON — itu yang dibaca
-- `parseStringArray` di `worker/db/queries.ts`.
INSERT OR REPLACE INTO product_content
  (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
VALUES
  ('01J8ZQFX9K7YWVTN3MABCDC01', '01J8ZQFX9K7YWVTN3MABCDP01', 'id',
   'Tas Kulit Nusantara',
   'Tas ini dibuat dari kulit sapi samak nabati, dijahit tangan selama tiga hari.',
   '["Kulit sapi nabati","Dijahit tangan","30 x 20 cm"]',
   'Tas kulit asli, dijahit tangan.',
   '["tas kulit","kerajinan tangan"]', 'ai_edited', 1758000100000),

  ('01J8ZQFX9K7YWVTN3MABCDC02', '01J8ZQFX9K7YWVTN3MABCDP01', 'en',
   'Nusantara Leather Bag',
   'This bag is made from vegetable-tanned cowhide, hand-stitched over three days.',
   '["Vegetable-tanned cowhide","Hand-stitched","30 x 20 cm"]',
   'Genuine leather bag, hand-stitched.',
   '["leather bag","handmade"]', 'ai', 1758000100000),

  ('01J8ZQFX9K7YWVTN3MABCDC03', '01J8ZQFX9K7YWVTN3MABCDP01', 'ja',
   'ヌサンタラ革のバッグ',
   'このバッグは植物タンニンなめしの牛革で作られています。',
   '["植物タンニンなめし牛革","手縫い","30 x 20 cm"]',
   '本革のバッグ、手縫い。',
   '["革のバッグ","手作り"]', 'ai', 1758000100000),

  ('01J8ZQFX9K7YWVTN3MABCDC04', '01J8ZQFX9K7YWVTN3MABCDP01', 'zh',
   '努桑塔拉皮革包',
   '这款包采用植鞣牛皮制成，手工缝制。',
   '["植鞣牛皮","手工缝制","30 x 20 cm"]',
   '真皮包，手工缝制。',
   '["皮包","手工"]', 'ai', 1758000100000),

  ('01J8ZQFX9K7YWVTN3MABCDC05', '01J8ZQFX9K7YWVTN3MABCDP01', 'ar',
   'حقيبة جلدية نوسانتارا',
   'هذه الحقيبة مصنوعة من جلد البقر المدبوغ نباتياً.',
   '["جلد بقري مدبوغ نباتياً","مخيط يدوياً","30 × 20 سم"]',
   'حقيبة جلدية أصلية، مخيطة يدوياً.',
   '["حقيبة جلدية","صناعة يدوية"]', 'ai', 1758000100000);

-- Foto asli yang unggahannya sudah dikonfirmasi. Hanya `upload_status =
-- 'confirmed'` yang dikembalikan titik akhir publik, dan `is_primary = 1`
-- menaruhnya di urutan pertama.
INSERT OR REPLACE INTO media_assets
  (id, product_id, kind, r2_key, mime_type, bytes, alt_text, provider,
   is_primary, upload_status, created_at)
VALUES
  ('01J8ZQFX9K7YWVTN3MABCDM01', '01J8ZQFX9K7YWVTN3MABCDP01', 'photo_original',
   'products/01J8ZQFX9K7YWVTN3MABCDP01/foto-asli.jpg', 'image/jpeg', 184320,
   'Tas kulit cokelat dijahit tangan di atas meja kayu', NULL, 1, 'confirmed',
   1758000000000);
