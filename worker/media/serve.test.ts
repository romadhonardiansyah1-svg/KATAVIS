import { describe, expect, it } from "vitest";

import { MEDIA_READ_TTL_MS, createSignedMediaUrl, mediaContentType, verifyMediaReadToken } from "./serve";

const ORIGIN = "http://127.0.0.1:8787";
const SIGNING_KEY = "kunci-uji-tanda-tangan";
const NOW = 1_758_000_000_000;
const KEY = "products/01J8ZQFX9K7YWVTN3MABCDP012/foto-asli-01J8ZQFX9K7YWVTN3MABCDM012.jpg";

/** Mengambil token dari URL yang diterbitkan, untuk disuntikkan kembali. */
function tokenOf(url: string): string {
  const marker = "/api/v1/media/";
  const at = url.indexOf(marker);
  if (at < 0) throw new Error(`URL tidak memuat awalan rute baca: ${url}`);
  return url.slice(at + marker.length);
}

describe("createSignedMediaUrl", () => {
  it("menerbitkan URL absolut pada origin yang diberikan", async () => {
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, ORIGIN, SIGNING_KEY);

    expect(url).not.toBeNull();
    expect(url?.startsWith(`${ORIGIN}/api/v1/media/`)).toBe(true);
  });

  it("membuang garis miring di ujung origin supaya tidak menjadi dua", async () => {
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, `${ORIGIN}/`, SIGNING_KEY);

    expect(url?.startsWith(`${ORIGIN}/api/v1/media/`)).toBe(true);
    expect(url?.includes("//api")).toBe(false);
  });

  it("menolak kunci yang tidak aman, bukan mengarang URL", async () => {
    // Kunci di luar awalan `products/` dapat menyusuri aset produk lain.
    const url = await createSignedMediaUrl(
      { r2Key: "rahasia/berkas.jpg", nowMs: NOW },
      ORIGIN,
      SIGNING_KEY,
    );

    expect(url).toBeNull();
  });

  it("menolak kunci dengan bagian relatif", async () => {
    const url = await createSignedMediaUrl(
      { r2Key: "products/../../etc/passwd", nowMs: NOW },
      ORIGIN,
      SIGNING_KEY,
    );

    expect(url).toBeNull();
  });

  it("menyisipkan masa berlaku yang lebih panjang daripada URL unggah", async () => {
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, ORIGIN, SIGNING_KEY);
    const token = tokenOf(url ?? "");
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(token.split(".")[0] ?? ""), (character) => character.charCodeAt(0)),
      ),
    ) as { expiresAt: number };

    expect(payload.expiresAt).toBe(NOW + MEDIA_READ_TTL_MS);
  });
});

describe("verifyMediaReadToken", () => {
  it("menerima token yang baru diterbitkan", async () => {
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, ORIGIN, SIGNING_KEY);
    const verified = await verifyMediaReadToken(tokenOf(url ?? ""), SIGNING_KEY, NOW);

    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.r2Key).toBe(KEY);
  });

  it("menerima token yang belum lewat masa berlakunya", async () => {
    // TC-I-16
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, ORIGIN, SIGNING_KEY);
    const verified = await verifyMediaReadToken(
      tokenOf(url ?? ""),
      SIGNING_KEY,
      NOW + MEDIA_READ_TTL_MS - 1,
    );

    expect(verified.ok).toBe(true);
  });

  it("menolak token tepat pada saat masa berlakunya habis", async () => {
    // TC-I-17 — batasnya inklusif, sama seperti `verifyUploadToken`.
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, ORIGIN, SIGNING_KEY);
    const verified = await verifyMediaReadToken(
      tokenOf(url ?? ""),
      SIGNING_KEY,
      NOW + MEDIA_READ_TTL_MS,
    );

    expect(verified.ok).toBe(false);
  });

  it("menolak tanda tangan yang dipalsukan", async () => {
    // TC-SEC-22
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, ORIGIN, SIGNING_KEY);
    const [body] = tokenOf(url ?? "").split(".");
    const forged = `${body ?? ""}.${"A".repeat(43)}`;

    const verified = await verifyMediaReadToken(forged, SIGNING_KEY, NOW);

    expect(verified.ok).toBe(false);
  });

  it("menolak token yang ditandatangani kunci lain", async () => {
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, ORIGIN, SIGNING_KEY);
    const verified = await verifyMediaReadToken(tokenOf(url ?? ""), "kunci-lain", NOW);

    expect(verified.ok).toBe(false);
  });

  it("menolak token yang bentuknya cacat", async () => {
    for (const token of ["", "tanpa-titik", "a.b.c", "...", "body."]) {
      const verified = await verifyMediaReadToken(token, SIGNING_KEY, NOW);
      expect(verified.ok).toBe(false);
    }
  });

  it("menolak isi token yang diarahkan ke kunci di luar awalan products/", async () => {
    // TC-SEC-23 — tanda tangan sah, tetapi isinya tidak boleh dipercaya
    // hanya karena ditandatangani. Penerbitnya dapat berubah kelak.
    const url = await createSignedMediaUrl({ r2Key: KEY, nowMs: NOW }, ORIGIN, SIGNING_KEY);
    expect(url).not.toBeNull();

    // Menyusun token sah dengan kunci terlarang, memakai jalur resmi.
    const forbidden = await createSignedMediaUrl(
      { r2Key: "berkas-rahasia.jpg", nowMs: NOW },
      ORIGIN,
      SIGNING_KEY,
    );

    expect(forbidden).toBeNull();
  });

  it("menerima token yang memuat kunci aman dari produk lain", async () => {
    // Tanda tangan mengikat satu kunci, bukan satu pengguna. Ini disengaja:
    // halaman katalog publik memang harus dapat menyajikan fotonya kepada
    // pembeli yang tidak punya sesi.
    const otherKey = "products/01J8ZQFX9K7YWVTN3MABCDP023/studio-01J8ZQFX9K7YWVTN3MABCDM023.webp";
    const url = await createSignedMediaUrl({ r2Key: otherKey, nowMs: NOW }, ORIGIN, SIGNING_KEY);
    const verified = await verifyMediaReadToken(tokenOf(url ?? ""), SIGNING_KEY, NOW);

    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.r2Key).toBe(otherKey);
  });
});

describe("mediaContentType", () => {
  it("mempertahankan jenis gambar yang dikenal", () => {
    expect(mediaContentType("image/jpeg")).toBe("image/jpeg");
    expect(mediaContentType("image/png")).toBe("image/png");
    expect(mediaContentType("image/webp")).toBe("image/webp");
  });

  it("menurunkan jenis asing menjadi octet-stream", () => {
    // TC-SEC-24 — `Content-Type` dari basis data tidak pernah diteruskan
    // apa adanya, karena nilai itu dapat memicu sniffing di peramban.
    expect(mediaContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(mediaContentType("text/html")).toBe("application/octet-stream");
    expect(mediaContentType("")).toBe("application/octet-stream");
  });
});
