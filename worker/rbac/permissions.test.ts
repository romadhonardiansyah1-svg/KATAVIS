/**
 * Kasus uji modul rbac — TC-U-RBAC-01 sampai TC-U-RBAC-13.
 *
 * Sumber: docs/testing/TEST-PLAN.md bagian 3 dan matriks izin
 * docs/spec/FEATURE-SPECS.md S3.
 *
 * Seluruh kasus berjalan tanpa basis data. Itu bukan kebetulan: aturan izin
 * dipisah dari pemuatan data justru supaya dapat diuji di sini (prompt P1,
 * docs/ops/MODEL-ROUTING.md).
 */

import { describe, expect, it } from "vitest";

import { LIMITS, type CaregiverPermission } from "../../lib/schemas";

import {
  canAcceptInvite,
  canCurate,
  canDeleteProduct,
  canEditDraft,
  canPublish,
  canSubmitReview,
  canUploadMedia,
  canViewProduct,
  inviteExpiresAt,
  isKnownRole,
  isSessionCurrent,
  parseCaregiverLink,
  type Actor,
  type CaregiverLink,
  type CaregiverLinkRow,
  type CaregiverLinkStatus,
  type ProductRef,
} from "./permissions";

const NOW = 1_700_000_000_000;

const ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDEFGH";
const OTHER_ARTISAN_ID = "01J8ZQFX9K7YWVTN3MABCDEFGK";
const CAREGIVER_ID = "01J8ZQFX9K7YWVTN3MABCDEFGJ";
const OTHER_CAREGIVER_ID = "01J8ZQFX9K7YWVTN3MABCDEFGM";
const ADMIN_ID = "01J8ZQFX9K7YWVTN3MABCDEFGN";
const BUYER_ID = "01J8ZQFX9K7YWVTN3MABCDEFGP";
const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDEFGQ";
const OTHER_PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDEFGS";
const LINK_ID = "01J8ZQFX9K7YWVTN3MABCDEFGR";

const artisan: Actor = {
  id: ARTISAN_ID,
  role: "artisan",
  sessionTokenVersion: 4,
  currentTokenVersion: 4,
};
const caregiver: Actor = {
  id: CAREGIVER_ID,
  role: "caregiver",
  sessionTokenVersion: 1,
  currentTokenVersion: 1,
};
const admin: Actor = {
  id: ADMIN_ID,
  role: "admin",
  sessionTokenVersion: 0,
  currentTokenVersion: 0,
};
const buyer: Actor = {
  id: BUYER_ID,
  role: "buyer",
  sessionTokenVersion: 0,
  currentTokenVersion: 0,
};

const draftProduct: ProductRef = {
  id: PRODUCT_ID,
  artisanId: ARTISAN_ID,
  status: "draft",
};
const publishedProduct: ProductRef = {
  id: PRODUCT_ID,
  artisanId: ARTISAN_ID,
  status: "published",
};
const otherDraftProduct: ProductRef = {
  id: OTHER_PRODUCT_ID,
  artisanId: OTHER_ARTISAN_ID,
  status: "draft",
};
const reviewProduct: ProductRef = {
  id: OTHER_PRODUCT_ID,
  artisanId: OTHER_ARTISAN_ID,
  status: "review",
};

interface LinkOverrides {
  readonly status?: CaregiverLinkStatus;
  readonly expiresAt?: number;
  readonly caregiverId?: string | null;
  readonly artisanId?: string;
}

function caregiverLink(
  permissions: readonly CaregiverPermission[],
  overrides: LinkOverrides = {},
): CaregiverLink {
  return {
    id: LINK_ID,
    artisanId: overrides.artisanId ?? ARTISAN_ID,
    caregiverId:
      overrides.caregiverId === undefined
        ? CAREGIVER_ID
        : overrides.caregiverId,
    permissions,
    status: overrides.status ?? "active",
    expiresAt: overrides.expiresAt ?? NOW + 3_600_000,
  };
}

function linkRow(overrides: {
  readonly permissions: string;
  readonly status: string;
  readonly expiresAt: number;
  readonly caregiverId?: string | null;
}): CaregiverLinkRow {
  return {
    id: LINK_ID,
    artisan_id: ARTISAN_ID,
    caregiver_id: overrides.caregiverId ?? null,
    permissions: overrides.permissions,
    status: overrides.status,
    expires_at: overrides.expiresAt,
  };
}

describe("rbac — akses produk", () => {
  it("mengizinkan pengrajin mengakses produknya sendiri", () => {
    // TC-U-RBAC-01
    expect(canViewProduct(artisan, draftProduct, null, NOW)).toBe(true);
    expect(canEditDraft(artisan, draftProduct, null, NOW)).toBe(true);
    expect(canPublish(artisan, draftProduct)).toBe(true);
  });

  it("menolak pengrajin mengakses produk pengrajin lain", () => {
    // TC-U-RBAC-02
    expect(canViewProduct(artisan, otherDraftProduct, null, NOW)).toBe(false);
    expect(canEditDraft(artisan, otherDraftProduct, null, NOW)).toBe(false);
    expect(canPublish(artisan, otherDraftProduct)).toBe(false);

    // Tautan pendamping terikat pada satu pengrajin. Ia tidak membuka
    // produk pengrajin lain.
    const link = caregiverLink(["edit_draft"]);
    expect(canEditDraft(caregiver, otherDraftProduct, link, NOW)).toBe(false);
    expect(canViewProduct(caregiver, otherDraftProduct, link, NOW)).toBe(false);
  });

  it("mengizinkan pendamping aktif memakai izin yang diberikan", () => {
    // TC-U-RBAC-03
    const editor = caregiverLink(["edit_draft"]);
    const uploader = caregiverLink(["upload_media"]);
    const reviewer = caregiverLink(["submit_review"]);

    expect(canViewProduct(caregiver, draftProduct, editor, NOW)).toBe(true);
    expect(canEditDraft(caregiver, draftProduct, editor, NOW)).toBe(true);
    expect(canUploadMedia(caregiver, draftProduct, uploader, NOW)).toBe(true);
    expect(canSubmitReview(caregiver, draftProduct, reviewer, NOW)).toBe(true);

    // Izin yang tidak diberikan tidak bocor ke tindakan lain.
    expect(canEditDraft(caregiver, draftProduct, uploader, NOW)).toBe(false);
    expect(canUploadMedia(caregiver, draftProduct, editor, NOW)).toBe(false);
    expect(canSubmitReview(caregiver, draftProduct, editor, NOW)).toBe(false);
  });

  it("menolak pendamping menerbitkan meski seluruh izin diberikan", () => {
    // TC-U-RBAC-04
    // "publish" tidak ada dalam daftar izin yang dapat didelegasikan,
    // sehingga sebanyak apa pun izin yang diberikan tidak membukanya.
    const full = caregiverLink(["edit_draft", "upload_media", "submit_review"]);
    expect(canPublish(caregiver, draftProduct)).toBe(false);
    expect(canEditDraft(caregiver, draftProduct, full, NOW)).toBe(true);
    expect(canPublish(caregiver, draftProduct)).toBe(false);
  });

  it("menolak pendamping yang aksesnya sudah dicabut", () => {
    // TC-U-RBAC-05
    const revoked = caregiverLink(["edit_draft"], { status: "revoked" });
    expect(canViewProduct(caregiver, draftProduct, revoked, NOW)).toBe(false);
    expect(canEditDraft(caregiver, draftProduct, revoked, NOW)).toBe(false);

    // Pencabutan seketika (S3-02): selain menandai status, pengrajin
    // menaikkan users.token_version. Token lama yang masih membawa versi
    // lama tidak boleh lagi berlaku meski tautannya tampak aktif.
    const staleToken: Actor = {
      ...caregiver,
      sessionTokenVersion: 1,
      currentTokenVersion: 2,
    };
    expect(isSessionCurrent(staleToken)).toBe(false);
    expect(
      canViewProduct(staleToken, draftProduct, caregiverLink(["edit_draft"]), NOW),
    ).toBe(false);
    expect(canEditDraft(staleToken, draftProduct, null, NOW)).toBe(false);
    expect(canPublish({ ...artisan, sessionTokenVersion: 3 }, draftProduct)).toBe(
      false,
    );

    // Tiga aksi lain memakai penjaga sesi yang sama. Cabangnya belum pernah
    // dijalankan sebelum ini: yang diuji baru sebagian, dan penjaga yang
    // tidak diuji adalah penjaga yang dapat hilang tanpa ada yang tahu.
    expect(
      canUploadMedia(staleToken, draftProduct, caregiverLink(["upload_media"]), NOW),
    ).toBe(false);
    expect(
      canSubmitReview(staleToken, draftProduct, caregiverLink(["submit_review"]), NOW),
    ).toBe(false);
    expect(canDeleteProduct({ ...artisan, sessionTokenVersion: 3 }, draftProduct)).toBe(
      false,
    );
  });

  it("menolak pendamping yang tautannya sudah kedaluwarsa", () => {
    // TC-U-RBAC-06
    const expired = caregiverLink(["edit_draft"], { expiresAt: NOW - 1 });
    expect(canViewProduct(caregiver, draftProduct, expired, NOW)).toBe(false);
    expect(canEditDraft(caregiver, draftProduct, expired, NOW)).toBe(false);

    // Tepat pada expires_at sudah dianggap lewat.
    const boundary = caregiverLink(["edit_draft"], { expiresAt: NOW });
    expect(canEditDraft(caregiver, draftProduct, boundary, NOW)).toBe(false);
  });

  it("menolak pendamping menghapus produk", () => {
    // TC-U-RBAC-07
    // Aksi merusak tidak pernah didelegasikan. Pengrajin pemilik karya
    // tetap boleh; tidak ada peran lain yang boleh.
    expect(canDeleteProduct(caregiver, draftProduct)).toBe(false);
    expect(canDeleteProduct(admin, draftProduct)).toBe(false);
    expect(canDeleteProduct(buyer, publishedProduct)).toBe(false);
    expect(canDeleteProduct(artisan, draftProduct)).toBe(true);
    expect(canDeleteProduct(artisan, otherDraftProduct)).toBe(false);
  });
});

describe("rbac — admin dan pembeli", () => {
  it("mengizinkan admin meninjau produk berstatus review", () => {
    // TC-U-RBAC-08
    expect(canViewProduct(admin, reviewProduct, null, NOW)).toBe(true);
    expect(canCurate(admin)).toBe(true);
  });

  it("menolak admin menyunting isi katalog pengrajin", () => {
    // TC-U-RBAC-09
    // Admin mengurasi — menerima atau menolak — bukan menulis ulang cerita
    // pengrajin. Kurasi pun bukan tugas pengrajin maupun pendamping.
    expect(canEditDraft(admin, reviewProduct, null, NOW)).toBe(false);
    expect(canPublish(admin, reviewProduct)).toBe(false);
    expect(canCurate(artisan)).toBe(false);
    expect(canCurate(caregiver)).toBe(false);
  });

  it("menolak pembeli mengakses produk draf", () => {
    // TC-U-RBAC-10
    expect(canViewProduct(buyer, draftProduct, null, NOW)).toBe(false);
    expect(canEditDraft(buyer, draftProduct, null, NOW)).toBe(false);
  });

  it("mengizinkan pembeli mengakses produk terbit", () => {
    // TC-U-RBAC-11
    expect(canViewProduct(buyer, publishedProduct, null, NOW)).toBe(true);
    // Melihat katalog terbit bukan izin menyuntingnya.
    expect(canEditDraft(buyer, publishedProduct, null, NOW)).toBe(false);
    expect(canPublish(buyer, publishedProduct)).toBe(false);
  });
});

describe("rbac — default menolak", () => {
  it("menolak peran, izin, dan tautan yang tidak dikenal", () => {
    // TC-U-RBAC-12
    // Pemeriksaan yang mengizinkan saat peran tidak dikenali adalah lubang
    // keamanan. Inilah sifat paling penting modul ini.
    const stranger: Actor = { ...buyer, role: "wizard" };
    expect(isKnownRole("wizard")).toBe(false);
    expect(isKnownRole("artisan")).toBe(true);

    expect(canViewProduct(stranger, publishedProduct, null, NOW)).toBe(false);
    expect(canEditDraft(stranger, draftProduct, null, NOW)).toBe(false);
    expect(canUploadMedia(stranger, draftProduct, null, NOW)).toBe(false);
    expect(canSubmitReview(stranger, draftProduct, null, NOW)).toBe(false);
    expect(canPublish(stranger, publishedProduct)).toBe(false);
    expect(canDeleteProduct(stranger, publishedProduct)).toBe(false);
    expect(canCurate(stranger)).toBe(false);

    // Izin tak dikenal tidak pernah menjadi izin yang sah.
    expect(
      parseCaregiverLink(
        linkRow({
          permissions: '["publish"]',
          status: "active",
          expiresAt: NOW + 1000,
        }),
      ),
    ).toBeNull();
    expect(
      parseCaregiverLink(
        linkRow({
          permissions: "bukan json",
          status: "active",
          expiresAt: NOW + 1000,
        }),
      ),
    ).toBeNull();

    // Status tak dikenal juga tidak menghasilkan tautan yang sah.
    expect(
      parseCaregiverLink(
        linkRow({
          permissions: '["edit_draft"]',
          status: "superuser",
          expiresAt: NOW + 1000,
        }),
      ),
    ).toBeNull();

    // Tautan null tidak pernah mengizinkan apa pun.
    expect(canViewProduct(caregiver, draftProduct, null, NOW)).toBe(false);
    expect(canEditDraft(caregiver, draftProduct, null, NOW)).toBe(false);
    expect(parseCaregiverLink(null)).toBeNull();

    // Tautan milik pendamping lain tidak dapat dipakai.
    const foreign = caregiverLink(["edit_draft"], {
      caregiverId: OTHER_CAREGIVER_ID,
    });
    expect(canEditDraft(caregiver, draftProduct, foreign, NOW)).toBe(false);
  });
});

describe("rbac — undangan pendamping", () => {
  it("menolak undangan pendamping yang berumur lebih dari 24 jam", () => {
    // TC-U-RBAC-13
    // Berbeda dari TC-U-RBAC-06 yang menguji tautan aktif: di sini yang
    // diuji adalah undangan yang belum diterima.
    const invitedAt = NOW - 25 * 60 * 60 * 1000;
    const invite = parseCaregiverLink(
      linkRow({
        permissions: '["edit_draft"]',
        status: "pending",
        expiresAt: inviteExpiresAt(invitedAt),
      }),
    );

    expect(invite).not.toBeNull();
    expect(canAcceptInvite(invite, NOW)).toBe(false);

    // Tepat 24 jam sudah lewat; satu menit sebelumnya masih boleh.
    const boundary = inviteExpiresAt(NOW - LIMITS.INVITE_TTL_MS);
    expect(canAcceptInvite({ ...caregiverLink([]), expiresAt: boundary }, NOW)).toBe(
      false,
    );
    expect(
      canAcceptInvite(
        {
          ...caregiverLink([]),
          status: "pending",
          expiresAt: inviteExpiresAt(NOW - 60_000),
        },
        NOW,
      ),
    ).toBe(true);

    // Undangan yang sudah diterima berstatus aktif dan tidak dapat dipakai
    // dua kali (S3-04). Tautan null pun ditolak.
    expect(canAcceptInvite(caregiverLink(["edit_draft"]), NOW)).toBe(false);
    expect(canAcceptInvite(null, NOW)).toBe(false);
  });
});
