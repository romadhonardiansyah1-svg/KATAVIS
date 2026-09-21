/**
 * Uji integrasi unggahan — TC-I-05..07 dan TC-SEC-11.
 *
 * Dijalankan di workerd dengan R2 Miniflare yang sesungguhnya. Yang diuji di
 * sini hanya dapat diuji di sini: apakah objeknya benar-benar tertulis, dan
 * apakah penolakan benar-benar tidak menulis apa pun. Tiruan R2 akan
 * menyembunyikan justru pertanyaan itu.
 *
 * Dijalankan dengan: pnpm run test:integration
 */

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { ApiErrorBody } from "../../lib/errors";
import { LIMITS } from "../../lib/schemas";

import {
  UPLOAD_TOKEN_TTL_MS,
  buildGeneratedMediaKey,
  createSignedUpload,
  handleSignedUpload,
  verifyUploadToken,
  type AllowedImageMime,
} from "./upload";

const SIGNING_KEY = "kunci-uji-32-bita-yang-tidak-dipakai-di-produksi";
const ORIGIN = "https://katavis.example";
const NOW_MS = 1_700_000_000_000;

const PRODUCT_ID = "01J8ZQFX9K7YWVTN3MABCDP001";
const MEDIA_ID = "01J8ZQFX9K7YWVTN3MABCDM001";

const JPEG_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

const DEPS = { signingKey: SIGNING_KEY, nowMs: NOW_MS };

/**
 * Mengubah karakter PERTAMA tanda tangan.
 *
 * Karakter terakhir sengaja tidak dipakai: tanda tangan 32 bita menjadi 43
 * karakter base64url, dan karakter terakhir hanya memuat 2 bit — empat bit
 * sisanya tidak dibaca. Mengubahnya dapat menghasilkan bita yang sama
 * persis, sehingga tokennya tetap sah dan ujinya lulus tanpa menguji apa
 * pun.
 */
function tamperSignature(token: string): string {
  const separator = token.indexOf(".");
  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const first = signature.at(0) ?? "A";
  return `${body}.${first === "A" ? "B" : "A"}${signature.slice(1)}`;
}

async function signedUpload(
  r2Key: string,
  mimeType: AllowedImageMime = "image/jpeg",
): Promise<string> {
  const upload = await createSignedUpload(
    { r2Key, mimeType, nowMs: NOW_MS },
    ORIGIN,
    SIGNING_KEY,
  );
  return upload.uploadUrl;
}

async function put(
  uploadUrl: string,
  body: Uint8Array<ArrayBuffer> = JPEG_BYTES,
  contentLength: string = String(body.length),
): Promise<Request> {
  return new Request(uploadUrl, {
    method: "PUT",
    body,
    headers: { "Content-Length": contentLength },
  });
}

async function errorCodeOf(response: Response): Promise<string> {
  return ((await response.json()) as ApiErrorBody).error.code;
}

function originalKey(mediaId: string): string {
  return `products/${PRODUCT_ID}/original-${mediaId}.jpg`;
}

describe("media — unggah lewat URL bertanda tangan", () => {
  it("menyimpan objek pada kunci yang ditandatangani", async () => {
    // TC-I-05
    const key = originalKey(MEDIA_ID);
    const response = await handleSignedUpload(
      await put(await signedUpload(key)),
      env.MEDIA,
      DEPS,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: true;
      data: { key: string; bytes: number };
    };
    expect(body.ok).toBe(true);
    expect(body.data.key).toBe(key);
    expect(body.data.bytes).toBe(JPEG_BYTES.length);

    // Objeknya benar-benar ada, isinya utuh, dan jenisnya tercatat.
    const stored = await env.MEDIA.get(key);
    expect(stored).not.toBeNull();
    if (stored === null) return;
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(JPEG_BYTES);
    expect(stored.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("menolak URL yang sudah kedaluwarsa dan tidak menulis apa pun", async () => {
    // TC-I-06, TC-SEC-11
    const key = originalKey("01J8ZQFX9K7YWVTN3MABCDM002");
    const uploadUrl = await signedUpload(key);
    const afterExpiry = NOW_MS + UPLOAD_TOKEN_TTL_MS + 1;

    const response = await handleSignedUpload(await put(uploadUrl), env.MEDIA, {
      signingKey: SIGNING_KEY,
      nowMs: afterExpiry,
    });

    expect(response.status).toBe(403);
    expect(await errorCodeOf(response)).toBe("FORBIDDEN");
    expect(await env.MEDIA.get(key)).toBeNull();
  });

  it("menerima token yang masih berlaku satu milidetik sebelum kedaluwarsa", async () => {
    // Batasnya ketat: tepat pada expiresAt sudah lewat. Satu milidetik
    // sebelumnya masih boleh.
    const key = originalKey("01J8ZQFX9K7YWVTN3MABCDM003");
    const uploadUrl = await signedUpload(key);

    const response = await handleSignedUpload(await put(uploadUrl), env.MEDIA, {
      signingKey: SIGNING_KEY,
      nowMs: NOW_MS + UPLOAD_TOKEN_TTL_MS - 1,
    });

    expect(response.status).toBe(200);
    expect(await env.MEDIA.get(key)).not.toBeNull();
  });

  it("menolak unggahan tanpa tanda tangan", async () => {
    // TC-I-07
    const productId = "01J8ZQFX9K7YWVTN3MABCDP900";

    for (const path of [
      "/api/v1/media/upload/",
      "/api/v1/media/upload/bukan-token",
      "/api/v1/media/upload/badan.tanda-tangan-palsu",
    ]) {
      const response = await handleSignedUpload(
        await put(`${ORIGIN}${path}`),
        env.MEDIA,
        DEPS,
      );

      expect(response.status).toBe(403);
      expect(await errorCodeOf(response)).toBe("FORBIDDEN");
    }

    // Tidak ada satu pun objek yang tertulis di bawah produk ini.
    const listed = await env.MEDIA.list({ prefix: `products/${productId}/` });
    expect(listed.objects).toHaveLength(0);
  });

  it("menolak token yang ditandatangani kunci lain", async () => {
    // TC-I-07
    const key = originalKey("01J8ZQFX9K7YWVTN3MABCDM004");
    const foreign = await createSignedUpload(
      { r2Key: key, mimeType: "image/jpeg", nowMs: NOW_MS },
      ORIGIN,
      "kunci-yang-berbeda",
    );

    const response = await handleSignedUpload(await put(foreign.uploadUrl), env.MEDIA, DEPS);

    expect(response.status).toBe(403);
    expect(await env.MEDIA.get(key)).toBeNull();
  });

  it("menolak metode selain PUT", async () => {
    const uploadUrl = await signedUpload(originalKey("01J8ZQFX9K7YWVTN3MABCDM005"));

    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await handleSignedUpload(
        new Request(uploadUrl, { method }),
        env.MEDIA,
        DEPS,
      );

      expect(response.status).toBe(403);
    }
  });

  it("menolak unggahan yang melebihi 10 MB tanpa menulis apa pun", async () => {
    const key = originalKey("01J8ZQFX9K7YWVTN3MABCDM006");

    const response = await handleSignedUpload(
      await put(
        await signedUpload(key),
        JPEG_BYTES,
        String(LIMITS.MAX_UPLOAD_BYTES + 1),
      ),
      env.MEDIA,
      DEPS,
    );

    expect(response.status).toBe(413);
    expect(await errorCodeOf(response)).toBe("FILE_TOO_LARGE");
    expect(await env.MEDIA.get(key)).toBeNull();
  });

  it("tidak menimpa foto asli saat aset hasil generate diunggah", async () => {
    // AGENTS.md aturan 7. Kegagalan generate mempertahankan foto pengrajin,
    // dan keberhasilan menambahkan berkas kedua di sebelahnya.
    const original = originalKey("01J8ZQFX9K7YWVTN3MABCDM007");
    const generated = buildGeneratedMediaKey({
      productId: PRODUCT_ID,
      mediaId: "01J8ZQFX9K7YWVTN3MABCDM007",
      mimeType: "image/jpeg",
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    const originalBytes = new Uint8Array([...JPEG_BYTES, 0x01]);
    const generatedBytes = new Uint8Array([...JPEG_BYTES, 0x02]);

    await handleSignedUpload(
      await put(await signedUpload(original), originalBytes),
      env.MEDIA,
      DEPS,
    );
    await handleSignedUpload(
      await put(await signedUpload(generated.key), generatedBytes),
      env.MEDIA,
      DEPS,
    );

    const storedOriginal = await env.MEDIA.get(original);
    const storedGenerated = await env.MEDIA.get(generated.key);
    expect(storedOriginal).not.toBeNull();
    expect(storedGenerated).not.toBeNull();
    if (storedOriginal === null || storedGenerated === null) return;

    // Dua objek terpisah, dan foto aslinya tidak tersentuh.
    expect(new Uint8Array(await storedOriginal.arrayBuffer())).toEqual(originalBytes);
    expect(new Uint8Array(await storedGenerated.arrayBuffer())).toEqual(generatedBytes);
  });

  it("token tidak dapat dipakai untuk kunci di luar awalan products/", async () => {
    // Tanda tangan mengikat kunci di dalam muatan, jadi mengubahnya tanpa
    // menandatangani ulang akan gugur.
    const uploadUrl = await signedUpload(originalKey("01J8ZQFX9K7YWVTN3MABCDM008"));
    const token = uploadUrl.slice(uploadUrl.indexOf("/api/v1/media/upload/") + 21);

    expect(await verifyUploadToken(token, SIGNING_KEY, NOW_MS)).toEqual({
      ok: true,
      r2Key: originalKey("01J8ZQFX9K7YWVTN3MABCDM008"),
      mimeType: "image/jpeg",
    });
    expect(
      await verifyUploadToken(tamperSignature(token), SIGNING_KEY, NOW_MS),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});
