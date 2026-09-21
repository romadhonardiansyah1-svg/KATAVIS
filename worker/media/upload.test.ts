/**
 * Kasus uji modul media — TC-U-CAT-04..06, TC-SEC-09..10.
 *
 * Seluruh kasus di sini berjalan tanpa R2 dan tanpa jaringan: yang diuji
 * adalah keputusan validasi, bukan penyimpanan objek. Berkas uji ini sengaja
 * memakai bita sungguhan — berkas JPEG dan PNG yang dipotong pada bagian
 * kepalanya — karena justru itulah yang diperiksa, dan larik angka yang
 * dikarang akan menguji hal yang berbeda dari yang dihadapi produksi.
 */

import { describe, expect, it } from "vitest";

import { bytesToBase64Url, hmacSign } from "../../lib/crypto";
import { LIMITS } from "../../lib/schemas";

import {
  UPLOAD_TOKEN_TTL_MS,
  buildGeneratedMediaKey,
  buildMediaKey,
  createSignedUpload,
  detectImageMime,
  isSafeMediaKey,
  parseMediaPatch,
  validateUploadRequest,
  verifyImageContent,
  verifyUploadToken,
} from "./upload";

const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDP001";
const MEDIA_ID = "01J8ZQFX9K7YWVTN3MABCDM001";

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Kepala berkas nyata, dipotong setelah bagian yang diperiksa. */
const JPEG_BYTES = bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46);
const PNG_BYTES = bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
const WEBP_BYTES = bytesOf(
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
);

/** RIFF juga, tetapi isinya suara — bukan gambar. */
const WAV_BYTES = bytesOf(
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
);

const HTML_BYTES = textBytes("<!DOCTYPE html><html><body>halo</body></html>");
const SVG_BYTES = textBytes(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

describe("media — validasi permintaan unggah", () => {
  it("menolak berkas melebihi 10 MB", () => {
    // TC-U-CAT-04
    const result = validateUploadRequest({
      kind: "photo_original",
      mimeType: "image/jpeg",
      bytes: LIMITS.MAX_UPLOAD_BYTES + 1,
    });

    expect(result).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
  });

  it("menerima berkas tepat pada batas 10 MB", () => {
    const result = validateUploadRequest({
      kind: "photo_original",
      mimeType: "image/jpeg",
      bytes: LIMITS.MAX_UPLOAD_BYTES,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(LIMITS.MAX_UPLOAD_BYTES);
  });

  it("menolak SVG karena dapat memuat skrip", () => {
    // TC-U-CAT-05, TC-SEC-09
    // SVG bukan sekadar gambar: ia dokumen yang dapat menjalankan skrip di
    // domain yang sama dengan katalog.
    for (const mimeType of ["image/svg+xml", "image/svg", "image/svg+xml;charset=utf-8"]) {
      const result = validateUploadRequest({
        kind: "photo_original",
        mimeType,
        bytes: 1024,
      });

      expect(result).toEqual({ ok: false, code: "UNSUPPORTED_FORMAT" });
    }
  });

  it.each([
    ["image/gif", "GIF"],
    ["image/bmp", "BMP"],
    ["image/tiff", "TIFF"],
    ["text/html", "HTML"],
    ["application/pdf", "PDF"],
    ["image/jpeg; charset=binary", "JPEG dengan parameter"],
  ])("menolak MIME %s (%s)", (mimeType) => {
    const result = validateUploadRequest({
      kind: "photo_original",
      mimeType,
      bytes: 1024,
    });

    expect(result).toEqual({ ok: false, code: "UNSUPPORTED_FORMAT" });
  });

  it.each(["image/jpeg", "image/png", "image/webp"])(
    "menerima MIME %s",
    (mimeType) => {
      const result = validateUploadRequest({
        kind: "photo_original",
        mimeType,
        bytes: 2_400_000,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.mimeType).toBe(mimeType);
    },
  );

  it("memeriksa ukuran sebelum bentuk, supaya galatnya tepat", () => {
    // Berkas 11 MB dengan jenis yang tidak didukung memenuhi dua aturan
    // sekaligus. Yang dilaporkan adalah ukurannya: pengrajin dapat memilih
    // foto lain yang lebih kecil, dan itu langkah yang lebih mudah.
    const result = validateUploadRequest({
      kind: "photo_original",
      mimeType: "image/svg+xml",
      bytes: LIMITS.MAX_UPLOAD_BYTES + 1,
    });

    expect(result).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
  });

  it.each([
    [{ kind: "video", mimeType: "image/jpeg", bytes: 1024 }, "jenis di luar skema"],
    [{ kind: "photo_original", mimeType: "image/jpeg", bytes: 0 }, "nol bita"],
    [{ kind: "photo_original", mimeType: "image/jpeg", bytes: -1 }, "bita negatif"],
    [{ kind: "photo_original", mimeType: "image/jpeg", bytes: 1.5 }, "bukan bilangan bulat"],
    [{ kind: "photo_original", mimeType: 7, bytes: 1024 }, "MIME bukan teks"],
    [{ kind: "photo_original", bytes: 1024 }, "MIME hilang"],
  ])("menolak permintaan %o (%s)", (input, _label) => {
    const result = validateUploadRequest(input);
    expect(result.ok).toBe(false);
  });
});

describe("media — magic bytes", () => {
  it.each([
    [JPEG_BYTES, "image/jpeg"],
    [PNG_BYTES, "image/png"],
    [WEBP_BYTES, "image/webp"],
  ])("mengenali isi berkas sebagai %s", (bytes, expected) => {
    expect(detectImageMime(bytes)).toBe(expected);
  });

  it("menolak berkas berekstensi .jpg yang isinya HTML", () => {
    // TC-U-CAT-06
    // Inilah alasan pemeriksaan ini ada: nama berkas dan MIME yang dikirim
    // klien keduanya dapat ditulis apa saja. Yang tidak dapat dipalsukan
    // adalah isinya.
    expect(detectImageMime(HTML_BYTES)).toBeNull();
  });

  it("menolak SVG berisi skrip", () => {
    // TC-SEC-09
    expect(detectImageMime(SVG_BYTES)).toBeNull();
  });

  it("tidak menerima RIFF yang bukan WebP", () => {
    // `IMAGE_MAGIC_BYTES` memberi empat bita pertama untuk WebP, yaitu
    // `RIFF` — penanda yang juga dipakai WAV dan AVI. Tanpa pemeriksaan
    // penanda format di offset 8, rekaman suara yang dinamai .webp akan
    // lolos sebagai gambar.
    expect(detectImageMime(WAV_BYTES)).toBeNull();
    expect(detectImageMime(WEBP_BYTES)).toBe("image/webp");
  });

  it.each([
    [bytesOf(), "kosong"],
    [bytesOf(0xff), "satu bita"],
    [bytesOf(0xff, 0xd8), "JPEG terpotong"],
    [bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a), "PNG terpotong"],
    [textBytes("bukan berkas apa pun"), "teks biasa"],
    [textBytes("<?xml version=\"1.0\"?><svg/>"), "XML"],
  ])("menolak isi %s (%s)", (bytes) => {
    expect(detectImageMime(bytes)).toBeNull();
  });
});

describe("media — pemeriksaan isi terhadap jenis yang dinyatakan", () => {
  it("menerima isi yang cocok dengan jenisnya", () => {
    expect(verifyImageContent(JPEG_BYTES, "image/jpeg")).toEqual({
      ok: true,
      mimeType: "image/jpeg",
    });
  });

  it("menolak isi yang tidak cocok dengan jenis yang dinyatakan", () => {
    // TC-U-CAT-06
    expect(verifyImageContent(HTML_BYTES, "image/jpeg")).toEqual({
      ok: false,
      code: "CONTENT_MISMATCH",
    });
    // PNG yang dinyatakan sebagai JPEG tetap ditolak: menyimpannya dengan
    // jenis yang salah akan merusak tampilan katalog kemudian.
    expect(verifyImageContent(PNG_BYTES, "image/jpeg")).toEqual({
      ok: false,
      code: "CONTENT_MISMATCH",
    });
  });

  it("menolak SVG yang dinyatakan sebagai PNG", () => {
    // TC-SEC-09
    expect(verifyImageContent(SVG_BYTES, "image/png")).toEqual({
      ok: false,
      code: "CONTENT_MISMATCH",
    });
  });
});

describe("media — kunci R2", () => {
  it("menyusun kunci di dalam awalan products/", () => {
    const result = buildMediaKey({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      kind: "photo_original",
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({
      ok: true,
      key: `products/${PRODUCT_ID}/original-${MEDIA_ID}.jpg`,
    });
  });

  it("memberi awalan berbeda untuk setiap jenis aset", () => {
    const keys = (
      ["photo_original", "photo_studio", "audio_raw", "audio_tts"] as const
    ).map((kind) =>
      buildMediaKey({
        productId: PRODUCT_ID,
        mediaId: MEDIA_ID,
        kind,
        mimeType: "image/png",
      }),
    );

    expect(keys.map((entry) => (entry.ok ? entry.key : null))).toEqual([
      `products/${PRODUCT_ID}/original-${MEDIA_ID}.png`,
      `products/${PRODUCT_ID}/studio-${MEDIA_ID}.png`,
      `products/${PRODUCT_ID}/audio-${MEDIA_ID}.png`,
      `products/${PRODUCT_ID}/tts-${MEDIA_ID}.png`,
    ]);
  });

  it.each([
    ["../../../etc/passwd", "garis miring relatif"],
    ["..", "titik ganda"],
    ["products/other", "garis miring"],
    ["/etc/passwd", "garis miring depan"],
    ["01J8ZQFX9K7YWVTN3MABCDP00/", "garis miring di akhir"],
    ["", "kosong"],
    ["bukan-ulid", "bukan ULID"],
    ["01j8zqfx9k7ywvtn3mabcdp001", "huruf kecil"],
  ])("menolak productId %s (%s)", (productId) => {
    // TC-SEC-10
    const result = buildMediaKey({
      productId,
      mediaId: MEDIA_ID,
      kind: "photo_original",
      mimeType: "image/jpeg",
    });

    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("menolak mediaId yang bukan ULID", () => {
    // TC-SEC-10
    for (const mediaId of ["../rahasia", "a/b", "", "1"]) {
      const result = buildMediaKey({
        productId: PRODUCT_ID,
        mediaId,
        kind: "photo_original",
        mimeType: "image/jpeg",
      });

      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
    }
  });

  it.each([
    [`products/${PRODUCT_ID}/original-${MEDIA_ID}.jpg`, true],
    [`products/${PRODUCT_ID}/studio-${MEDIA_ID}.webp`, true],
    ["products/x", true],
    ["products/", false],
    ["", false],
    ["/products/x", false],
    ["public/x", false],
    [`products/../${MEDIA_ID}.jpg`, false],
    ["products//x.jpg", false],
    ["products\\x.jpg", false],
  ])("menilai kunci %s sebagai aman: %s", (key, expected) => {
    expect(isSafeMediaKey(key)).toBe(expected);
  });
});

describe("media — aset hasil generate tidak pernah menimpa foto asli", () => {
  it("memberi kunci berbeda dari foto asli meski mediaId-nya sama", () => {
    // AGENTS.md aturan 7: foto asli tidak pernah ditimpa. Kegagalan generate
    // mempertahankan foto pengrajin, dan keberhasilan menambahkan berkas
    // kedua di sebelahnya.
    const original = buildMediaKey({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      kind: "photo_original",
      mimeType: "image/jpeg",
    });
    const generated = buildGeneratedMediaKey({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      mimeType: "image/jpeg",
    });

    expect(original.ok).toBe(true);
    expect(generated.ok).toBe(true);
    if (!original.ok || !generated.ok) return;

    expect(generated.key).not.toBe(original.key);
    expect(generated.key).toContain("/studio-");
    expect(original.key).toContain("/original-");
  });

  it("selalu memakai jenis photo_studio", () => {
    const generated = buildGeneratedMediaKey({
      productId: PRODUCT_ID,
      mediaId: MEDIA_ID,
      mimeType: "image/webp",
    });

    expect(generated).toEqual({
      ok: true,
      key: `products/${PRODUCT_ID}/studio-${MEDIA_ID}.webp`,
    });
  });

  it("menolak id yang tidak sah sama seperti kunci biasa", () => {
    expect(
      buildGeneratedMediaKey({
        productId: "../rahasia",
        mediaId: MEDIA_ID,
        mimeType: "image/webp",
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("media — suntingan media", () => {
  it("menerima teks alternatif dan penanda foto utama", () => {
    const result = parseMediaPatch({
      altText: "Tas kulit cokelat di atas meja marmer",
      isPrimary: true,
    });

    expect(result).toEqual({
      ok: true,
      altText: "Tas kulit cokelat di atas meja marmer",
      isPrimary: true,
    });
  });

  it("menerima salah satu bidang saja", () => {
    expect(parseMediaPatch({ isPrimary: false })).toEqual({
      ok: true,
      isPrimary: false,
    });
    expect(parseMediaPatch({})).toEqual({ ok: true });
  });

  it.each([
    [{ altText: "" }, "teks kosong"],
    [{ altText: "a".repeat(301) }, "teks terlalu panjang"],
    [{ altText: 7 }, "teks bukan string"],
    [{ isPrimary: "ya" }, "penanda bukan boolean"],
    [{ isPrimary: 1 }, "penanda berupa angka"],
    [{ altText: null }, "teks null"],
  ])("menolak suntingan %o (%s)", (input, _label) => {
    const result = parseMediaPatch(input);
    expect(result.ok).toBe(false);
  });
});

const SIGNING_KEY = "kunci-uji-32-bita-yang-tidak-dipakai-di-produksi";
const OTHER_SIGNING_KEY = "kunci-uji-yang-berbeda";
const ORIGIN = "https://katavis.example";
const NOW_MS = 1_700_000_000_000;
const R2_KEY = `products/${PRODUCT_ID}/original-${MEDIA_ID}.jpg`;

function tokenOf(uploadUrl: string): string {
  const marker = "/api/v1/media/upload/";
  return uploadUrl.slice(uploadUrl.indexOf(marker) + marker.length);
}

describe("media — URL bertanda tangan", () => {
  it("berumur 15 menit, diambil dari LIMITS", async () => {
    // TC-I-06, TC-SEC-11
    const upload = await createSignedUpload(
      { r2Key: R2_KEY, mimeType: "image/jpeg", nowMs: NOW_MS },
      ORIGIN,
      SIGNING_KEY,
    );

    expect(UPLOAD_TOKEN_TTL_MS).toBe(LIMITS.UPLOAD_URL_TTL_MS);
    expect(UPLOAD_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    expect(upload.expiresAt).toBe(NOW_MS + UPLOAD_TOKEN_TTL_MS);
    expect(upload.uploadUrl.startsWith(`${ORIGIN}/api/v1/media/upload/`)).toBe(true);
  });

  it("menerima token yang masih berlaku", async () => {
    const upload = await createSignedUpload(
      { r2Key: R2_KEY, mimeType: "image/jpeg", nowMs: NOW_MS },
      ORIGIN,
      SIGNING_KEY,
    );

    expect(
      await verifyUploadToken(tokenOf(upload.uploadUrl), SIGNING_KEY, NOW_MS),
    ).toEqual({ ok: true, r2Key: R2_KEY, mimeType: "image/jpeg" });
  });

  it("menolak token yang sudah kedaluwarsa", async () => {
    // TC-I-06, TC-SEC-11
    const upload = await createSignedUpload(
      { r2Key: R2_KEY, mimeType: "image/jpeg", nowMs: NOW_MS },
      ORIGIN,
      SIGNING_KEY,
    );
    const token = tokenOf(upload.uploadUrl);

    const almostExpired = NOW_MS + UPLOAD_TOKEN_TTL_MS - 1;
    expect(await verifyUploadToken(token, SIGNING_KEY, almostExpired)).toEqual({
      ok: true,
      r2Key: R2_KEY,
      mimeType: "image/jpeg",
    });

    // Tepat pada expiresAt sudah lewat, sama seperti masa berlaku token sesi.
    expect(
      await verifyUploadToken(token, SIGNING_KEY, NOW_MS + UPLOAD_TOKEN_TTL_MS),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(
      await verifyUploadToken(token, SIGNING_KEY, NOW_MS + 86_400_000),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("menolak token yang ditandatangani kunci lain", async () => {
    const upload = await createSignedUpload(
      { r2Key: R2_KEY, mimeType: "image/jpeg", nowMs: NOW_MS },
      ORIGIN,
      OTHER_SIGNING_KEY,
    );

    expect(
      await verifyUploadToken(tokenOf(upload.uploadUrl), SIGNING_KEY, NOW_MS),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("menolak token yang tanda tangannya diubah", async () => {
    const upload = await createSignedUpload(
      { r2Key: R2_KEY, mimeType: "image/jpeg", nowMs: NOW_MS },
      ORIGIN,
      SIGNING_KEY,
    );
    const token = tokenOf(upload.uploadUrl);

    // Karakter PERTAMA tanda tangan yang diubah, bukan yang terakhir.
    // Tanda tangan 32 bita menjadi 43 karakter base64url, dan karakter
    // terakhir hanya memuat 2 bit — empat bit sisanya tidak dibaca, sehingga
    // mengubahnya dapat menghasilkan bita yang sama persis dan tokennya
    // tetap sah. Uji yang mengubah karakter terakhir dapat lulus tanpa
    // menguji apa pun.
    const separator = token.indexOf(".");
    const body = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const first = signature.at(0) ?? "A";

    expect(
      await verifyUploadToken(
        `${body}.${first === "A" ? "B" : "A"}${signature.slice(1)}`,
        SIGNING_KEY,
        NOW_MS,
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("menolak muatan yang diubah meski tanda tangannya asli", async () => {
    // Tanda tangan mengikat isi. Mengganti kunci di dalam muatan tanpa
    // menandatangani ulang harus gugur pada pemeriksaan tanda tangan.
    const upload = await createSignedUpload(
      { r2Key: R2_KEY, mimeType: "image/jpeg", nowMs: NOW_MS },
      ORIGIN,
      SIGNING_KEY,
    );
    const token = tokenOf(upload.uploadUrl);
    const signature = token.split(".")[1] ?? "";

    const forgedBody = bytesToBase64Url(
      new TextEncoder().encode(
        JSON.stringify({
          key: "public/rahasia.jpg",
          mimeType: "image/jpeg",
          expiresAt: NOW_MS + 60_000,
        }),
      ),
    );

    expect(
      await verifyUploadToken(`${forgedBody}.${signature}`, SIGNING_KEY, NOW_MS),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("menolak muatan sah yang kuncinya keluar dari awalan products/", async () => {
    // Kalau penerbitnya kelak berubah dan menandatangani kunci yang salah,
    // pemeriksaan di dalam muatan tetap menolaknya. Tanda tangan membuktikan
    // asal token, bukan kewajaran isinya.
    const body = bytesToBase64Url(
      new TextEncoder().encode(
        JSON.stringify({
          key: "public/../rahasia.jpg",
          mimeType: "image/jpeg",
          expiresAt: NOW_MS + 60_000,
        }),
      ),
    );
    const signature = bytesToBase64Url(await hmacSign(body, SIGNING_KEY));

    expect(await verifyUploadToken(`${body}.${signature}`, SIGNING_KEY, NOW_MS)).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it.each([
    ["", "kosong"],
    ["tanpa-titik", "tanpa pemisah"],
    ["a.b.c", "tiga bagian"],
    ["!!!.tanda", "muatan bukan base64url"],
    ["badan.!!!", "tanda tangan bukan base64url"],
    ["badan.", "tanda tangan kosong"],
  ])("menolak token %s (%s)", async (token) => {
    expect(await verifyUploadToken(token, SIGNING_KEY, NOW_MS)).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("menolak muatan yang bukan JSON atau kehilangan bidang", async () => {
    const bodies = [
      "bukan json",
      JSON.stringify({ key: R2_KEY }),
      JSON.stringify({ key: R2_KEY, mimeType: "image/gif", expiresAt: NOW_MS + 1000 }),
      JSON.stringify({ key: R2_KEY, mimeType: "image/jpeg", expiresAt: "besok" }),
      JSON.stringify({ key: 7, mimeType: "image/jpeg", expiresAt: NOW_MS + 1000 }),
    ];

    for (const raw of bodies) {
      const body = bytesToBase64Url(new TextEncoder().encode(raw));
      const signature = bytesToBase64Url(await hmacSign(body, SIGNING_KEY));

      expect(
        await verifyUploadToken(`${body}.${signature}`, SIGNING_KEY, NOW_MS),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
    }
  });
});
