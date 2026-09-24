import { describe, expect, it } from "vitest";
import {
  CaregiverInviteSchema,
  CaregiverPermissionSchema,
  LIMITS,
  OtpVerifySchema,
  PhoneSchema,
  ProductListQuerySchema,
  UlidSchema,
  UploadUrlRequestSchema,
} from "./schemas";

describe("PhoneSchema", () => {
  it("menerima nomor Indonesia format E.164", () => {
    expect(PhoneSchema.safeParse("+628123456789").success).toBe(true);
  });

  it.each([
    ["08123456789", "tanpa kode negara"],
    ["+18123456789", "kode negara lain"],
    ["+62", "terlalu pendek"],
    ["+62812345678901234", "terlalu panjang"],
    ["+62abc456789", "bukan angka"],
  ])("menolak %s (%s)", (input) => {
    expect(PhoneSchema.safeParse(input).success).toBe(false);
  });
});

describe("UlidSchema", () => {
  it("menerima ULID yang sah", () => {
    expect(UlidSchema.safeParse("01J8ZQFX9K7YWVTN3MABCDEFGH").success).toBe(true);
  });

  it.each([
    ["01J8ZQFX9K7YWVTN3MABCDEFG", "25 karakter"],
    ["01J8ZQFX9K7YWVTN3MABCDEFGHI", "27 karakter"],
    ["01J8ZQFX9K7YWVTN3MABCDEFGI", "memuat I yang dilarang"],
    ["01j8zqfx9k7ywvtn3mabcdefgh", "huruf kecil"],
  ])("menolak %s (%s)", (input) => {
    expect(UlidSchema.safeParse(input).success).toBe(false);
  });
});

describe("OtpVerifySchema", () => {
  it("menerima kode 6 angka", () => {
    const result = OtpVerifySchema.safeParse({
      phone: "+628123456789",
      code: "123456",
    });
    expect(result.success).toBe(true);
  });

  it.each([["12345"], ["1234567"], ["12345a"], [""]])(
    "menolak kode %s",
    (code) => {
      const result = OtpVerifySchema.safeParse({ phone: "+628123456789", code });
      expect(result.success).toBe(false);
    },
  );
});

describe("UploadUrlRequestSchema", () => {
  it("menerima JPEG dalam batas ukuran", () => {
    const result = UploadUrlRequestSchema.safeParse({
      kind: "photo_original",
      mimeType: "image/jpeg",
      bytes: 2_400_000,
    });
    expect(result.success).toBe(true);
  });

  it("menolak berkas melebihi 10 MB", () => {
    // TC-U-CAT-04
    const result = UploadUrlRequestSchema.safeParse({
      kind: "photo_original",
      mimeType: "image/jpeg",
      bytes: LIMITS.MAX_UPLOAD_BYTES + 1,
    });
    expect(result.success).toBe(false);
  });

  it("menolak SVG karena dapat memuat skrip", () => {
    // TC-U-CAT-05, TC-SEC-09
    const result = UploadUrlRequestSchema.safeParse({
      kind: "photo_original",
      mimeType: "image/svg+xml",
      bytes: 1000,
    });
    expect(result.success).toBe(false);
  });
});

describe("CaregiverPermissionSchema", () => {
  it.each(["edit_draft", "upload_media", "submit_review"])(
    "mengizinkan %s",
    (permission) => {
      expect(CaregiverPermissionSchema.safeParse(permission).success).toBe(true);
    },
  );

  it.each(["publish", "delete"])(
    "menolak %s karena tidak dapat didelegasikan",
    (permission) => {
      // FEATURE-SPECS S3, TC-U-RBAC-04, TC-U-RBAC-07.
      // Menerbitkan dan menghapus adalah keputusan pemilik karya.
      expect(CaregiverPermissionSchema.safeParse(permission).success).toBe(false);
    },
  );

  it("menolak undangan tanpa satu pun izin", () => {
    const result = CaregiverInviteSchema.safeParse({
      phone: "+628123456789",
      permissions: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ProductListQuerySchema", () => {
  it("membatasi limit pada MAX_PAGE_SIZE", () => {
    // Paginasi kursor melindungi jatah kueri D1 (TC-PERF-04).
    const result = ProductListQuerySchema.safeParse({
      limit: String(LIMITS.MAX_PAGE_SIZE + 1),
    });
    expect(result.success).toBe(false);
  });

  it("memberi limit bawaan saat tidak disebut", () => {
    const result = ProductListQuerySchema.parse({});
    expect(result.limit).toBe(10);
  });
});

describe("LIMITS", () => {
  it("menjaga ambang kueri D1 di bawah batas paket gratis", () => {
    // D1 free mengizinkan 50 kueri per invocation. Ambang uji harus
    // menyisakan ruang aman (ADR-006, TC-PERF-04).
    expect(LIMITS.MAX_D1_QUERIES_PER_REQUEST).toBeLessThan(50);
  });

  it("menjaga rentang durasi audio sesuai kontrak API", () => {
    expect(LIMITS.MIN_AUDIO_MS).toBe(10_000);
    expect(LIMITS.MAX_AUDIO_MS).toBe(60_000);
  });

  it("menjaga batas waktu Gemini sesuai ADR-004", () => {
    expect(LIMITS.GEMINI_TIMEOUT_MS).toBe(90_000);
  });

  it("menjaga batas heartbeat agen lebih pendek dari batas Gemini", () => {
    // Agen yang mati harus terdeteksi SEBELUM batas 45 detik, agar
    // pekerjaan langsung menuju Workers AI (TC-SA-02).
    expect(LIMITS.AGENT_HEARTBEAT_TIMEOUT_MS).toBeLessThan(
      LIMITS.GEMINI_TIMEOUT_MS,
    );
  });
});
