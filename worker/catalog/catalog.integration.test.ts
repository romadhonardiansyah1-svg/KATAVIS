/**
 * Uji integrasi modul catalog — TC-I-02, TC-I-15, dan gerbang ADR-008.
 *
 * Dijalankan di workerd dengan D1 Miniflare yang sesungguhnya. Yang diuji di
 * sini adalah hal-hal yang hanya terbukti terhadap basis data nyata:
 * `COALESCE` benar-benar mempertahankan bidang yang tidak dikirim, kunci
 * idempotensi benar-benar mencegah baris kedua, `ON DELETE CASCADE` benar-
 * benar menghapus baris anak, dan gerbang ADR-008 benar-benar menahan
 * pekerjaan sebelum ditulis.
 *
 * Dijalankan dengan: pnpm run test:integration
 */

import { applyD1Migrations, env } from "cloudflare:test";
import { ulid } from "ulid";
import { beforeAll, describe, expect, it } from "vitest";

import { LIMITS } from "../../lib/schemas";
import { assertWithinBudget, createDb, createQueryCounter } from "../db";
import { findPublicCatalogEntry } from "../db/queries";
import type { Actor } from "../rbac";

import { isContentComplete, patchContent } from "./content";
import { requireConsent, setConsent } from "./consent";
import { buildCaptions } from "./narration";
import {
  createProduct,
  deleteProduct,
  loadProduct,
  publishProduct,
  requestGeneration,
} from "./products";
import { storeAsrTranscript, submitTranscript } from "./transcript";

const NOW_MS = 1_700_000_000_000;

const counter = createQueryCounter();
const db = createDb(env.DB, counter);

function artisanId(index: number): string {
  return `01J8ZQFX9K7YWVTN3MABCDEFGH${String(index).padStart(3, "0")}`;
}

function actorFor(index: number): Actor {
  return {
    id: artisanId(index),
    role: "artisan",
    sessionTokenVersion: 0,
    currentTokenVersion: 0,
  };
}

async function seedArtisan(index: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, phone, display_name, role, created_at)
     VALUES (?, ?, ?, 'artisan', ?)`,
  )
    .bind(artisanId(index), `+6281100${String(index).padStart(5, "0")}`, "Pengrajin Uji", NOW_MS)
    .run();
}

/** Membuat produk lalu memindahkannya langsung ke status yang dibutuhkan uji. */
async function seedProduct(
  index: number,
  status: string,
  options: { readonly content?: boolean; readonly photo?: boolean } = {},
): Promise<string> {
  const created = await createProduct(db, artisanId(index), ulid(), NOW_MS);
  if (!created.ok) throw new Error("Pembuatan produk uji gagal");
  const productId = created.product.id;

  await env.DB.prepare("UPDATE products SET status = ? WHERE id = ?")
    .bind(status, productId)
    .run();

  if (options.content === true) {
    await env.DB.prepare(
      `INSERT INTO product_content
         (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
       VALUES (?, ?, 'id', ?, ?, ?, ?, ?, 'ai', ?)`,
    )
      .bind(
        ulid(),
        productId,
        "Tas Kulit Nusantara",
        "Dibuat dari kulit sapi nabati selama dua minggu.",
        '["Kulit sapi nabati"]',
        "Tas kulit asli.",
        '["tas kulit"]',
        NOW_MS,
      )
      .run();
  }

  if (options.photo === true) {
    await env.DB.prepare(
      `INSERT INTO media_assets
         (id, product_id, kind, r2_key, mime_type, bytes, alt_text, provider, is_primary, upload_status, created_at)
       VALUES (?, ?, 'photo_studio', ?, 'image/webp', 184320, ?, 'workers_ai', 1, 'confirmed', ?)`,
    )
      .bind(ulid(), productId, `products/${productId}/studio-1.webp`, "Tas kulit", NOW_MS)
      .run();
  }

  return productId;
}

async function countRows(table: string, productId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM ${table} WHERE product_id = ?`,
  )
    .bind(productId)
    .first<{ total: number }>();

  return row?.total ?? 0;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("catalog — gerbang ADR-008", () => {
  it("menahan pemrosesan sampai transkrip ditinjau pengrajin", async () => {
    await seedArtisan(1);
    const created = await createProduct(db, artisanId(1), ulid(), NOW_MS);
    if (!created.ok) throw new Error("Pembuatan produk uji gagal");
    const productId = created.product.id;

    await storeAsrTranscript(
      db,
      productId,
      { text: "Saya membuat tas dari kulit kerbau.", locale: "id", provider: "groq", durationMs: 28_400 },
      NOW_MS,
    );

    // Belum ditinjau: seluruh permintaan ditolak, bukan sebagian.
    expect(
      await requestGeneration(db, actorFor(1), productId, { tasks: ["copy"], locales: ["id"] }, NOW_MS),
    ).toEqual({ ok: false, code: "TRANSCRIPT_NOT_REVIEWED" });

    // Dan tidak satu pun pekerjaan terbuat.
    expect(await countRows("jobs", productId)).toBe(0);

    // Pengrajin menekan "Sudah benar, lanjutkan".
    const submitted = await submitTranscript(
      db,
      productId,
      "Saya membuat tas dari kulit kerbau samak nabati.",
      NOW_MS,
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.transcript?.reviewed).toBe(true);
    expect(submitted.transcript?.edited).toBe(true);

    const generated = await requestGeneration(
      db,
      actorFor(1),
      productId,
      { tasks: ["copy", "image"], locales: ["id", "en"] },
      NOW_MS,
    );

    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    // Satu pekerjaan per bahasa untuk copy, satu pekerjaan gambar.
    expect(generated.jobs.map((job) => job.kind)).toEqual(["copy", "copy", "image"]);
    expect(await countRows("jobs", productId)).toBe(3);
    expect((await loadProduct(db, productId))?.status).toBe("processing");
  });

  it("mengulang gerbang saat rekaman baru masuk", async () => {
    await seedArtisan(2);
    const created = await createProduct(db, artisanId(2), ulid(), NOW_MS);
    if (!created.ok) throw new Error("Pembuatan produk uji gagal");
    const productId = created.product.id;

    await storeAsrTranscript(
      db,
      productId,
      { text: "Rekaman pertama.", locale: "id", provider: "groq", durationMs: 28_400 },
      NOW_MS,
    );
    await submitTranscript(db, productId, "Rekaman pertama.", NOW_MS);
    expect(
      (await requestGeneration(db, actorFor(2), productId, { tasks: ["copy"], locales: ["id"] }, NOW_MS)).ok,
    ).toBe(true);

    // Merekam ulang menghasilkan teks baru yang belum pernah dibaca siapa pun.
    await storeAsrTranscript(
      db,
      productId,
      { text: "Rekaman kedua.", locale: "id", provider: "groq", durationMs: 30_000 },
      NOW_MS + 1000,
    );

    expect(
      await requestGeneration(db, actorFor(2), productId, { tasks: ["copy"], locales: ["id"] }, NOW_MS + 1000),
    ).toEqual({ ok: false, code: "TRANSCRIPT_NOT_REVIEWED" });
  });
});

describe("catalog — persetujuan", () => {
  it("menolak perekaman tanpa persetujuan audio_processing", async () => {
    await seedArtisan(3);

    expect(await requireConsent(db, artisanId(3), "audio_processing")).toBe("CONSENT_REQUIRED");

    await setConsent(db, artisanId(3), { kind: "audio_processing", granted: true }, NOW_MS);

    expect(await requireConsent(db, artisanId(3), "audio_processing")).toBeNull();
    // Persetujuan lain tidak ikut menyala.
    expect(await requireConsent(db, artisanId(3), "publication")).toBe("CONSENT_REQUIRED");
  });

  it("menolak penerbitan tanpa persetujuan publication", async () => {
    // TC-I-15
    await seedArtisan(4);
    const productId = await seedProduct(4, "review", { content: true, photo: true });

    const rejected = await publishProduct(
      db,
      actorFor(4),
      productId,
      { consentConfirmed: true },
      NOW_MS,
    );

    expect(rejected).toEqual({ ok: false, code: "CONSENT_REQUIRED" });
    // Status tetap review.
    expect((await loadProduct(db, productId))?.status).toBe("review");
  });
});

describe("catalog — penerbitan", () => {
  it("menerbitkan saat seluruh syarat terpenuhi", async () => {
    await seedArtisan(5);
    const productId = await seedProduct(5, "review", { content: true, photo: true });
    await setConsent(db, artisanId(5), { kind: "publication", granted: true }, NOW_MS);

    const published = await publishProduct(
      db,
      actorFor(5),
      productId,
      { consentConfirmed: true },
      NOW_MS,
    );

    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.product.status).toBe("published");

    const row = await env.DB.prepare(
      "SELECT status, progress, published_at FROM products WHERE id = ?",
    )
      .bind(productId)
      .first<{ status: string; progress: number; published_at: number | null }>();

    expect(row?.status).toBe("published");
    expect(row?.progress).toBe(100);
    expect(row?.published_at).toBe(NOW_MS);
  });

  it("menolak penerbitan saat konten belum lengkap", async () => {
    await seedArtisan(6);
    const productId = await seedProduct(6, "review", { photo: true });
    await setConsent(db, artisanId(6), { kind: "publication", granted: true }, NOW_MS);

    expect(
      await publishProduct(db, actorFor(6), productId, { consentConfirmed: true }, NOW_MS),
    ).toEqual({ ok: false, code: "CONTENT_INCOMPLETE" });
  });

  it("menolak penerbitan tanpa foto utama", async () => {
    await seedArtisan(7);
    const productId = await seedProduct(7, "review", { content: true });
    await setConsent(db, artisanId(7), { kind: "publication", granted: true }, NOW_MS);

    expect(
      await publishProduct(db, actorFor(7), productId, { consentConfirmed: true }, NOW_MS),
    ).toEqual({ ok: false, code: "PHOTO_REQUIRED" });
  });

  it("menolak penerbitan oleh pengrajin lain", async () => {
    await seedArtisan(8);
    await seedArtisan(9);
    const productId = await seedProduct(8, "review", { content: true, photo: true });
    await setConsent(db, artisanId(8), { kind: "publication", granted: true }, NOW_MS);

    // Izin diperiksa lebih dulu, sebelum keadaan produk terbaca.
    expect(
      await publishProduct(db, actorFor(9), productId, { consentConfirmed: true }, NOW_MS),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("menolak penerbitan tanpa consentConfirmed", async () => {
    await seedArtisan(10);
    const productId = await seedProduct(10, "review", { content: true, photo: true });
    await setConsent(db, artisanId(10), { kind: "publication", granted: true }, NOW_MS);

    for (const input of [{}, { consentConfirmed: false }, { consentConfirmed: "ya" }]) {
      expect(await publishProduct(db, actorFor(10), productId, input, NOW_MS)).toEqual({
        ok: false,
        code: "CONSENT_REQUIRED",
      });
    }
  });

  it("tetap di bawah anggaran 25 kueri per invocation", async () => {
    // TC-PERF-04
    await seedArtisan(11);
    const productId = await seedProduct(11, "review", { content: true, photo: true });
    await setConsent(db, artisanId(11), { kind: "publication", granted: true }, NOW_MS);

    counter.reset();
    const published = await publishProduct(
      db,
      actorFor(11),
      productId,
      { consentConfirmed: true },
      NOW_MS,
    );

    expect(published.ok).toBe(true);
    assertWithinBudget(counter);
    expect(counter.total()).toBeLessThan(LIMITS.MAX_D1_QUERIES_PER_REQUEST);
    // Rute penerbitan menyentuh lima tabel; jumlahnya tetap, bukan tumbuh
    // seiring jumlah bahasa atau jumlah media.
    expect(counter.total()).toBeLessThanOrEqual(10);
  });
});

describe("catalog — konten", () => {
  it("mengubah source menjadi ai_edited dan mempertahankan bidang lain", async () => {
    await seedArtisan(12);
    const productId = await seedProduct(12, "draft", { content: true });

    const before = await env.DB.prepare(
      "SELECT name, story, specs, source FROM product_content WHERE product_id = ? AND locale = 'id'",
    )
      .bind(productId)
      .first<{ name: string; story: string; specs: string; source: string }>();
    expect(before?.source).toBe("ai");

    const patched = await patchContent(db, productId, "id", { name: "Tas Kulit Baru" }, NOW_MS);
    expect(patched.ok).toBe(true);

    const after = await env.DB.prepare(
      "SELECT name, story, specs, source FROM product_content WHERE product_id = ? AND locale = 'id'",
    )
      .bind(productId)
      .first<{ name: string; story: string; specs: string; source: string }>();

    expect(after?.name).toBe("Tas Kulit Baru");
    // Yang tidak dikirim tidak tersentuh — inilah kerja COALESCE.
    expect(after?.story).toBe("Dibuat dari kulit sapi nabati selama dua minggu.");
    expect(after?.specs).toBe('["Kulit sapi nabati"]');
    expect(after?.source).toBe("ai_edited");
  });

  it("menyimpan suntingan tanpa mengganggu bahasa lain", async () => {
    await seedArtisan(13);
    const productId = await seedProduct(13, "draft", { content: true });

    await env.DB.prepare(
      `INSERT INTO product_content
         (id, product_id, locale, name, story, source, updated_at)
       VALUES (?, ?, 'en', 'Nusantara Bag', 'Made from cowhide.', 'ai', ?)`,
    )
      .bind(ulid(), productId, NOW_MS)
      .run();

    await patchContent(db, productId, "en", { name: "Nusantara Leather Bag" }, NOW_MS);

    const rows = await env.DB.prepare(
      "SELECT locale, name, source FROM product_content WHERE product_id = ? ORDER BY locale",
    )
      .bind(productId)
      .all<{ locale: string; name: string; source: string }>();

    expect(rows.results).toEqual([
      { locale: "en", name: "Nusantara Leather Bag", source: "ai_edited" },
      { locale: "id", name: "Tas Kulit Nusantara", source: "ai" },
    ]);
  });

  it("menilai kelengkapan dari baris yang benar-benar tersimpan", async () => {
    await seedArtisan(14);
    const productId = await seedProduct(14, "draft");

    expect(isContentComplete(null)).toBe(false);

    await patchContent(db, productId, "id", { name: "Tas" }, NOW_MS);
    const partial = await env.DB.prepare(
      "SELECT name, story FROM product_content WHERE product_id = ? AND locale = 'id'",
    )
      .bind(productId)
      .first<{ name: string | null; story: string | null }>();
    expect(isContentComplete(partial)).toBe(false);

    await patchContent(db, productId, "id", { story: "Cerita lengkap." }, NOW_MS);
    const complete = await env.DB.prepare(
      "SELECT name, story FROM product_content WHERE product_id = ? AND locale = 'id'",
    )
      .bind(productId)
      .first<{ name: string | null; story: string | null }>();
    expect(isContentComplete(complete)).toBe(true);
  });
});

describe("catalog — idempotensi dan penghapusan", () => {
  it("tidak membuat produk kedua untuk kunci yang sama", async () => {
    await seedArtisan(15);
    const key = ulid();

    const first = await createProduct(db, artisanId(15), key, NOW_MS);
    const second = await createProduct(db, artisanId(15), key, NOW_MS + 1000);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.product.id).toBe(first.product.id);
    expect(second.replayed).toBe(true);

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM products WHERE artisan_id = ?",
    )
      .bind(artisanId(15))
      .first<{ total: number }>();
    expect(rows?.total).toBe(1);
  });

  it("tidak membocorkan respons milik pengguna lain lewat kunci yang sama", async () => {
    await seedArtisan(16);
    await seedArtisan(17);
    const key = ulid();

    const mine = await createProduct(db, artisanId(16), key, NOW_MS);
    const theirs = await createProduct(db, artisanId(17), key, NOW_MS);

    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) return;

    // Kunci yang sama, pengguna berbeda: produknya harus berbeda.
    expect(theirs.product.id).not.toBe(mine.product.id);
    expect(theirs.replayed).toBe(false);
  });

  it("menghapus baris anak saat produk dihapus", async () => {
    // TC-I-02
    await seedArtisan(18);
    const productId = await seedProduct(18, "draft", { content: true, photo: true });

    await env.DB.prepare(
      `INSERT INTO jobs (id, product_id, kind, status, attempt, progress, created_at)
       VALUES (?, ?, 'copy', 'queued', 0, 0, ?)`,
    )
      .bind(ulid(), productId, NOW_MS)
      .run();
    await env.DB.prepare(
      `INSERT INTO transcripts (id, product_id, text, locale, reviewed, edited, created_at)
       VALUES (?, ?, 'Teks.', 'id', 1, 0, ?)`,
    )
      .bind(ulid(), productId, NOW_MS)
      .run();

    for (const table of ["product_content", "media_assets", "jobs", "transcripts"]) {
      expect(await countRows(table, productId)).toBeGreaterThan(0);
    }

    expect(await deleteProduct(db, actorFor(18), productId, true)).toEqual({ ok: true });

    for (const table of ["product_content", "media_assets", "jobs", "transcripts"]) {
      expect(await countRows(table, productId)).toBe(0);
    }
    expect(await loadProduct(db, productId)).toBeNull();
  });
});

/**
 * Kemampuan memilih bahasa pada katalog publik (kontrak API bagian 10).
 *
 * Diuji terhadap D1 sungguhan, dan bukan lewat tiruan, karena yang
 * dipertaruhkan ada di dalam SQL-nya sendiri: `LEFT JOIN ... AND c.locale = ?`
 * dengan `NULL` tidak sama dengan tanpa `LEFT JOIN`, dan `name IS NOT NULL`
 * pada penghitungan `availableLocales` menentukan bahasa mana yang benar-
 * benar dapat dibuka. Tiruan yang menjawab dari objek JavaScript tidak akan
 * pernah menangkap keduanya.
 */
describe("catalog publik — pilihan bahasa", () => {
  /**
   * Produk terbit dengan tiga baris konten: `id`, `en` berisi, dan `ja`
   * yang namanya masih `NULL` — keadaan nyata selama penerjemahan berjalan,
   * karena baris dibuat lebih dulu sebelum hasilnya diisi.
   */
  async function seedPublishedWithLocales(index: number): Promise<string> {
    await seedArtisan(index);
    const productId = await seedProduct(index, "published", { content: true, photo: true });

    await env.DB.prepare(
      `UPDATE products SET slug = ? WHERE id = ?`,
    )
      .bind(`tas-uji-${index}`, productId)
      .run();

    for (const [locale, name, story] of [
      ["en", "Nusantara Leather Bag", "Hand-stitched vegetable-tanned cowhide."],
      ["ja", null, null],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO product_content
           (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
         VALUES (?, ?, ?, ?, ?, '[]', NULL, '[]', 'ai', ?)`,
      )
        .bind(ulid(), productId, locale, name, story, NOW_MS)
        .run();
    }

    return productId;
  }

  it("mengembalikan versi bahasa yang diminta, bukan versi Indonesia", async () => {
    await seedPublishedWithLocales(20);

    const english = await findPublicCatalogEntry(db, "tas-uji-20", "en");
    expect(english?.name).toBe("Nusantara Leather Bag");
    expect(english?.story).toBe("Hand-stitched vegetable-tanned cowhide.");

    const indonesian = await findPublicCatalogEntry(db, "tas-uji-20", "id");
    expect(indonesian?.name).toBe("Tas Kulit Nusantara");

    // Dua respons yang sungguh berbeda — bukan satu bahasa yang ditampilkan
    // berkali-kali dengan label berbeda.
    expect(english?.name).not.toBe(indonesian?.name);
  });

  it("mengembalikan entri tanpa nama saat barisnya ada tetapi belum diisi", async () => {
    // `ja` ada di basis data, tetapi belum diterjemahkan. Barisnya kembali
    // dengan `name: null` supaya lapisan rute dapat memutuskan jawabannya;
    // yang TIDAK boleh terjadi adalah baris itu menghilang tanpa jejak,
    // karena penghapusan berarti "bahasa ini tidak ada" — dua hal berbeda.
    await seedPublishedWithLocales(21);

    const japanese = await findPublicCatalogEntry(db, "tas-uji-21", "ja");
    expect(japanese).not.toBeNull();
    expect(japanese?.name).toBeNull();
  });

  it("mengembalikan null untuk bahasa yang tidak punya baris sama sekali", async () => {
    await seedPublishedWithLocales(22);

    // `ar` dan `zh` sah menurut skema, tetapi tidak ada barisnya. `LEFT JOIN`
    // membuat baris produk tetap kembali dengan kolom konten kosong; itulah
    // yang membedakan "produk tidak ada" dari "bahasa belum ada".
    for (const locale of ["ar", "zh"] as const) {
      const entry = await findPublicCatalogEntry(db, "tas-uji-22", locale);
      expect(entry, `bahasa ${locale} seharusnya tanpa konten`).not.toBeNull();
      expect(entry?.name).toBeNull();
    }
  });

  it("menghitung availableLocales hanya dari bahasa yang sudah berisi", async () => {
    await seedPublishedWithLocales(23);

    const entry = await findPublicCatalogEntry(db, "tas-uji-23", "id");

    // Urutannya tidak dijanjikan SQL, jadi dibandingkan sebagai himpunan.
    // Yang penting: `ja` yang namanya `NULL` tidak ikut, karena pemilih
    // bahasa yang menawarkannya akan membawa pembeli ke halaman kosong.
    expect([...(entry?.availableLocales ?? [])].sort()).toEqual(["en", "id"]);
    expect(entry?.availableLocales).not.toContain("ja");
  });

  it("tetap hanya melayani produk yang terbit untuk bahasa apa pun", async () => {
    // Draf berbahasa Inggris pun tidak boleh bocor lewat parameter bahasa.
    await seedArtisan(24);
    const draftId = await seedProduct(24, "draft", { content: true });
    await env.DB.prepare(
      `INSERT INTO product_content
         (id, product_id, locale, name, story, specs, social_copy, seo_keywords, source, updated_at)
       VALUES (?, ?, 'en', 'Draft Bag', 'Not published yet.', '[]', NULL, '[]', 'ai', ?)`,
    )
      .bind(ulid(), draftId, NOW_MS)
      .run();

    expect(await findPublicCatalogEntry(db, "tas-uji-24", "en")).toBeNull();
  });

  it("menyediakan cerita yang dapat diturunkan menjadi naskah berwaktu", async () => {
    // Rantai yang dijaga di sini: entri publik wajib membawa `story` yang
    // tidak kosong, karena `buildCaptions` bekerja dari cerita itu dan
    // `TalkingCatalog` mengembalikan `null` bila kalimatnya kosong. Cerita
    // yang kosong berarti fitur F3 hilang dari layar tanpa galat apa pun —
    // kegagalan senyap yang justru paling mahal saat demo.
    await seedPublishedWithLocales(25);

    const entry = await findPublicCatalogEntry(db, "tas-uji-25", "id");
    expect(entry).not.toBeNull();

    const captions = buildCaptions(entry?.story ?? null);
    expect(captions.length).toBeGreaterThan(0);
    expect(captions[0]?.text.trim().length).toBeGreaterThan(0);
  });

  it("menghasilkan naskah yang berbeda untuk tiap bahasa", async () => {
    // Naskahnya diturunkan dari cerita bahasa itu, bukan dari satu bahasa
    // yang dipakai berulang. Kalau tidak, halaman berbahasa Inggris akan
    // menyorot kalimat Indonesia.
    await seedPublishedWithLocales(26);

    const english = await findPublicCatalogEntry(db, "tas-uji-26", "en");
    const indonesian = await findPublicCatalogEntry(db, "tas-uji-26", "id");

    const englishCaptions = buildCaptions(english?.story ?? null);
    const indonesianCaptions = buildCaptions(indonesian?.story ?? null);

    expect(englishCaptions[0]?.text).not.toBe(indonesianCaptions[0]?.text);
  });
});
