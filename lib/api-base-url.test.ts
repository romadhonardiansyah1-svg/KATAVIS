import { describe, expect, it } from "vitest";

import { resolveApiBaseUrl } from "./api-base-url";

describe("alamat Worker pada demo lokal", () => {
  it("mengikuti host browser saat IP laptop berubah setelah build", () => {
    expect(resolveApiBaseUrl("http://172.16.67.19:8787", "http://192.168.1.24:3000"))
      .toBe("http://192.168.1.24:8787");
    expect(resolveApiBaseUrl("http://172.16.67.19:8787", "http://localhost:3000"))
      .toBe("http://localhost:8787");
  });

  it("memakai loopback untuk render katalog di server laptop", () => {
    expect(resolveApiBaseUrl("http://172.16.67.19:8787"))
      .toBe("http://127.0.0.1:8787");
  });

  it("mempertahankan alamat Worker publik yang dikonfigurasi", () => {
    expect(resolveApiBaseUrl("https://api.katavis.example", "http://localhost:3000"))
      .toBe("https://api.katavis.example");
    expect(resolveApiBaseUrl("https://10.example.com", "http://localhost:3000"))
      .toBe("https://10.example.com");
  });
});
