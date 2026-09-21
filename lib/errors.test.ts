import { describe, expect, it } from "vitest";
import {
  apiError,
  apiOk,
  ERROR_CATALOG,
  FORBIDDEN_MESSAGE_TERMS,
  type ErrorCode,
} from "./errors";

const codes = Object.keys(ERROR_CATALOG) as ErrorCode[];

describe("katalog galat", () => {
  it("memuat 23 kode sesuai kontrak API bagian 12", () => {
    // TC-E2E-20 bergantung pada katalog ini lengkap.
    expect(codes).toHaveLength(23);
  });

  it.each(codes)("%s tidak memuat istilah teknis dalam pesannya", (code) => {
    // TC-E2E-20: pesan ke pengrajin tidak pernah memuat istilah teknis.
    const lowered = ERROR_CATALOG[code].message.toLowerCase();
    for (const term of FORBIDDEN_MESSAGE_TERMS) {
      expect(lowered).not.toContain(term);
    }
  });

  it.each(codes)("%s punya action yang bukan string kosong", (code) => {
    // TC-E2E-21: setiap pesan galat memuat langkah berikutnya.
    expect(ERROR_CATALOG[code].action.length).toBeGreaterThan(0);
  });

  it.each(codes)("%s punya status HTTP yang sah", (code) => {
    const { status } = ERROR_CATALOG[code];
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
  });

  it.each(codes)("%s punya pesan dalam Bahasa Indonesia yang diakhiri titik", (code) => {
    expect(ERROR_CATALOG[code].message).toMatch(/[.!]$/);
  });
});

describe("apiError", () => {
  it.each(codes)("%s selalu menghasilkan workSafe true", async (code) => {
    // TC-E2E-22: invarian sistem. Kegagalan tidak menghilangkan pekerjaan.
    const body = await apiError(code).json<{ error: { workSafe: boolean } }>();
    expect(body.error.workSafe).toBe(true);
  });

  it("memakai status dari katalog", () => {
    expect(apiError("FORBIDDEN").status).toBe(403);
    expect(apiError("FILE_TOO_LARGE").status).toBe(413);
  });

  it("membentuk badan sesuai kontrak API bagian 1", async () => {
    // Pesannya dibaca dari katalog, bukan ditulis ulang di sini: teks yang
    // disalin ke dua tempat adalah teks yang cepat atau lambat berbeda
    // pendapat, dan yang gagal kemudian adalah uji ini — bukan pesannya.
    const body = await apiError("ASR_NO_SPEECH").json();
    expect(body).toEqual({
      ok: false,
      error: {
        code: "ASR_NO_SPEECH",
        message: ERROR_CATALOG.ASR_NO_SPEECH.message,
        action: ERROR_CATALOG.ASR_NO_SPEECH.action,
        workSafe: true,
      },
    });
  });

  it("menerima pesan pengganti untuk keperluan i18n", async () => {
    const body = await apiError("NOT_FOUND", "Page not found.").json<{
      error: { message: string; code: string };
    }>();
    expect(body.error.message).toBe("Page not found.");
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("apiOk", () => {
  it("membentuk badan sesuai kontrak API bagian 1", async () => {
    const response = apiOk({ id: "01J" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { id: "01J" } });
  });

  it("menerima status lain untuk pembuatan sumber daya", () => {
    expect(apiOk({ id: "01J" }, 201).status).toBe(201);
  });
});
