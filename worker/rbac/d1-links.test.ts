/**
 * Akses D1 untuk tautan pendamping.
 *
 * Berkas ini 9,09% tercakup sebelum ini, dan itulah satu-satunya yang menahan
 * modul `rbac` di bawah ambangnya (95% baris). Yang diuji di sini bukan D1 —
 * D1 nyata diuji `*.integration.test.ts` di workerd — melainkan SQL dan
 * pemetaan hasilnya: kolom apa yang dibaca, syarat apa yang ada di dalam
 * WHERE, dan apa yang dikembalikan saat tidak ada baris yang berubah.
 *
 * Syarat-syarat itu bukan hiasan. Dua di antaranya adalah pengujian keamanan
 * terpenting di sistem ini:
 *
 *   TC-SEC-15 — undangan sekali pakai. Syarat `status = 'pending'` ADA DI
 *               DALAM WHERE, bukan di kode pemanggil; pemeriksaan yang
 *               bergantung pada pembacaan sebelumnya gagal saat dua
 *               permintaan tiba bersamaan.
 *   TC-I-04   — pencabutan berlaku seketika. `d1RevokeLink` menutup tautan;
 *               `worker/auth` mematikan tokennya. Keduanya wajib.
 */

import { describe, expect, it } from "vitest";

import {
  d1AcceptInvite,
  d1CreateInvite,
  d1FindInviteByToken,
  d1FindLinkById,
  d1FindLinkFor,
  d1ListLinksForArtisan,
  d1RevokeLink,
} from "./d1-links";
import type { CaregiverLinkRow } from "./permissions";

interface Recorded {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/**
 * Tiruan `D1Database` sebatas yang dipakai berkas ini: `prepare().bind()` lalu
 * `run()`, `first()`, atau `all()`.
 *
 * Tidak ada pustaka tiruan: D1 nyata tidak pernah dihadirkan di uji unit
 * (ADR-006), dan tiruan yang terlalu pintar akan menyembunyikan SQL yang
 * salah bentuk.
 */
function fakeD1(config: {
  readonly first?: CaregiverLinkRow | null;
  readonly all?: readonly CaregiverLinkRow[];
  readonly changes?: number;
}): { readonly db: D1Database; readonly recorded: Recorded[] } {
  const recorded: Recorded[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: readonly unknown[]) {
          recorded.push({ sql, values });

          return {
            async run() {
              return { meta: { changes: config.changes ?? 0 } };
            },
            async first() {
              return config.first ?? null;
            },
            async all() {
              return { results: [...(config.all ?? [])] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, recorded };
}

const LINK_ROW: CaregiverLinkRow = {
  id: "01J8ZQFX9K7YWVTN3MABCDL01",
  artisan_id: "01J8ZQFX9K7YWVTN3MABCDU01",
  caregiver_id: "01J8ZQFX9K7YWVTN3MABCDU02",
  permissions: '["edit_draft"]',
  status: "active",
  expires_at: 1_760_000_000_000,
};

describe("rbac/d1-links — undangan", () => {
  it("membuat undangan tanpa caregiver_id, karena pendampingnya belum tentu ada", async () => {
    // Pada saat mengundang, pendampingnya mungkin belum pernah masuk ke
    // sistem dan belum punya baris pengguna.
    const { db, recorded } = fakeD1({});

    await d1CreateInvite(
      db,
      {
        id: "01J8ZQFX9K7YWVTN3MABCDL01",
        artisanId: "01J8ZQFX9K7YWVTN3MABCDU01",
        invitePhone: "+6281200000002",
        inviteToken: "token-undangan",
        permissions: ["edit_draft"],
        expiresAt: 1_760_000_000_000,
      },
      1_759_000_000_000,
    );

    const statement = recorded[0];
    expect(statement).toBeDefined();
    expect(statement?.sql).toContain("INSERT INTO caregiver_links");
    expect(statement?.sql).toContain("NULL");
    expect(statement?.sql).toContain("'pending'");
    expect(statement?.values).toEqual([
      "01J8ZQFX9K7YWVTN3MABCDL01",
      "01J8ZQFX9K7YWVTN3MABCDU01",
      "+6281200000002",
      "token-undangan",
      '["edit_draft"]',
      1_759_000_000_000,
      1_760_000_000_000,
    ]);
  });

  it("mencari undangan lewat token, bukan lewat nomor telepon", async () => {
    // TC-SEC-14. Nomor telepon tidak pernah menjadi kunci pencarian di jalur
    // ini: menebaknya tidak boleh mengungkap siapa yang terdaftar.
    const { db, recorded } = fakeD1({ first: LINK_ROW });

    const found = await d1FindInviteByToken(db, "token-undangan");

    expect(found).toEqual(LINK_ROW);
    expect(recorded[0]?.sql).toContain("WHERE invite_token = ?");
    expect(recorded[0]?.values).toEqual(["token-undangan"]);
  });

  it("mengembalikan null saat tokennya tidak ada", async () => {
    const { db } = fakeD1({ first: null });

    expect(await d1FindInviteByToken(db, "token-salah")).toBeNull();
  });

  it("menerima undangan hanya bila statusnya masih pending", async () => {
    // TC-SEC-15. Syaratnya di dalam WHERE: dua permintaan yang tiba
    // bersamaan tidak dapat sama-sama berhasil.
    const { db, recorded } = fakeD1({ changes: 1 });

    const accepted = await d1AcceptInvite(
      db,
      "01J8ZQFX9K7YWVTN3MABCDL01",
      "01J8ZQFX9K7YWVTN3MABCDU02",
      1_759_500_000_000,
    );

    expect(accepted).toBe(true);
    expect(recorded[0]?.sql).toContain("SET caregiver_id = ?");
    expect(recorded[0]?.sql).toContain("status = 'active'");
    expect(recorded[0]?.sql).toContain("WHERE id = ? AND status = 'pending'");
  });

  it("melaporkan gagal saat undangan sudah dipakai", async () => {
    // TC-SEC-15. Tidak ada baris yang berubah — undangan kedua kali ditolak
    // tanpa perlu membaca statusnya lebih dulu.
    const { db } = fakeD1({ changes: 0 });

    const accepted = await d1AcceptInvite(db, "01J8ZQFX9K7YWVTN3MABCDL01", "01J8ZQFX9K7YWVTN3MABCDU02", 1);

    expect(accepted).toBe(false);
  });
});

describe("rbac/d1-links — tautan", () => {
  it("memuat tautan pasangan pendamping–pengrajin", async () => {
    // TC-U-RBAC-03. Inilah baris yang diperiksa `permissions.ts`; kalau
    // pasangannya tertukar, izin mengalir ke orang yang salah.
    const { db, recorded } = fakeD1({ first: LINK_ROW });

    const link = await d1FindLinkFor(db, "01J8ZQFX9K7YWVTN3MABCDU02", "01J8ZQFX9K7YWVTN3MABCDU01");

    expect(link).toEqual(LINK_ROW);
    expect(recorded[0]?.sql).toContain("WHERE caregiver_id = ? AND artisan_id = ?");
    expect(recorded[0]?.values).toEqual(["01J8ZQFX9K7YWVTN3MABCDU02", "01J8ZQFX9K7YWVTN3MABCDU01"]);
  });

  it("memuat tautan lewat id-nya", async () => {
    const { db, recorded } = fakeD1({ first: LINK_ROW });

    const link = await d1FindLinkById(db, "01J8ZQFX9K7YWVTN3MABCDL01");

    expect(link).toEqual(LINK_ROW);
    expect(recorded[0]?.sql).toContain("WHERE id = ?");
  });

  it("mengembalikan null saat tautannya tidak ada", async () => {
    const { db } = fakeD1({ first: null });

    expect(await d1FindLinkById(db, "tidak-ada")).toBeNull();
  });

  it("mendaftar tautan milik pengrajin, terbaru lebih dulu", async () => {
    const { db, recorded } = fakeD1({ all: [LINK_ROW] });

    const links = await d1ListLinksForArtisan(db, "01J8ZQFX9K7YWVTN3MABCDU01");

    expect(links).toEqual([LINK_ROW]);
    expect(recorded[0]?.sql).toContain("WHERE artisan_id = ?");
    expect(recorded[0]?.sql).toContain("ORDER BY invited_at DESC");
  });

  it("mengembalikan larik kosong saat belum ada tautan", async () => {
    // Bukan null: pemanggilnya memetakan daftar, dan null akan menjadi
    // galat tipe di sana, bukan keadaan kosong yang wajar.
    const { db } = fakeD1({ all: [] });

    expect(await d1ListLinksForArtisan(db, "01J8ZQFX9K7YWVTN3MABCDU01")).toEqual([]);
  });

  it("mencabut tautan tanpa menyentuh token_version — itu milik worker/auth", async () => {
    // TC-I-04. Batas modul melarang `rbac` menaikkan `token_version`.
    // Pencabutan yang berlaku seketika dirakit pemanggil dari dua langkah:
    // tautan ditutup di sini, token dimatikan di `worker/auth`.
    const { db, recorded } = fakeD1({ changes: 1 });

    const revoked = await d1RevokeLink(db, "01J8ZQFX9K7YWVTN3MABCDL01", 1_759_500_000_000);

    expect(revoked).toBe(true);
    expect(recorded[0]?.sql).toContain("SET status = 'revoked'");
    expect(recorded[0]?.sql).toContain("WHERE id = ? AND status != 'revoked'");
    expect(recorded[0]?.sql).not.toContain("token_version");
  });

  it("melaporkan gagal saat tautannya sudah dicabut", async () => {
    const { db } = fakeD1({ changes: 0 });

    expect(await d1RevokeLink(db, "01J8ZQFX9K7YWVTN3MABCDL01", 1)).toBe(false);
  });
});
