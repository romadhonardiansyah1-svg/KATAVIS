import { afterEach, describe, expect, it, vi } from "vitest";

import { getJobs, publicCatalogUrl } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("alamat alur katalog", () => {
  it("membuka halaman katalog pembeli pada origin aplikasi", () => {
    // TC-E2E-01, TC-E2E-06: tautan sesudah terbit harus menuju antarmuka pembeli.
    vi.stubGlobal("window", {
      location: { protocol: "https:", hostname: "katavis.example", origin: "https://katavis.example" },
    });

    expect(publicCatalogUrl("tas-kulit-nusantara")).toBe(
      "https://katavis.example/catalog/tas-kulit-nusantara",
    );
  });

  it("memakai alamat Worker yang dikonfigurasi untuk permintaan browser", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.katavis.example");
    vi.stubGlobal("window", {
      location: { protocol: "https:", hostname: "katavis.example", origin: "https://katavis.example" },
    });
    const fetchRequest = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { jobs: [], overallProgress: 0 } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchRequest);

    const response = await getJobs("token-uji", "produk-uji");

    expect(response.ok).toBe(true);
    expect(fetchRequest).toHaveBeenCalledWith(
      "https://api.katavis.example/api/v1/products/produk-uji/jobs",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-uji" }) }),
    );
  });
});
