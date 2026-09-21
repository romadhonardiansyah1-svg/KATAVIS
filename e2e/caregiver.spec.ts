/**
 * TC-E2E-04 dan TC-E2E-05 — pendamping menyunting draf, dan pencabutan akses
 * yang berlaku seketika.
 *
 * ==== Mengapa berkas ini tipis ====
 *
 * Kedua kasus uji ini **dijalankan di `create-catalog.spec.ts`**, tempat
 * perakitan token, penyemaian draf, dan penyadapan seluruh endpoint alur
 * sudah ada. Menyalinnya ke sini berarti dua salinan yang akan berbeda
 * pendapat tentang kontrak API — dan salinan yang menyimpang dari kontrak
 * justru menguji hal yang salah.
 *
 * ==== Yang belum ada, dan tidak dikarang di sini ====
 *
 * `POST /caregivers/invite`, `POST /caregivers/accept`, `GET /caregivers`,
 * dan `DELETE /caregivers/:linkId` ada di kontrak API bagian 9 dan sudah
 * diterapkan di `worker/index.ts` baris 1297-1424. Tetapi **layar "Pendamping
 * saya" belum ada**: tidak ada rute di `app/` yang menampilkannya, dan tidak
 * ada tombol "Cabut akses" di antarmuka mana pun.
 *
 * Alur undangan di FEATURE-SPECS S3 menyebutkan tujuh langkah, dan langkah
 * pertama — "Pengrajin membuka 'Pendamping saya'" — belum punya layar.
 * Kasus uji yang menguji tombol yang tidak ada akan gagal dengan benar, tetapi
 * yang lebih berguna adalah menyatakannya sekali di sini daripada mengulang
 * kegagalan yang sama di setiap kasus uji.
 *
 * **Yang perlu diputuskan (jangan dikarang sendiri):**
 *   1. Alamat layar pendamping. `/caregivers`? `/pengaturan/pendamping`?
 *      Pilihannya memengaruhi tautan dari layar utama.
 *   2. Apakah pencabutan menuntut konfirmasi ganda? S1 menetapkan konfirmasi
 *      ganda untuk aksi merusak pada profil Motorik, dan mencabut akses
 *      termasuk di dalamnya.
 *   3. Nama yang ditampilkan untuk pendamping. Kontrak API bagian 9
 *      mengembalikan `caregiverId`, bukan nama tampilan; `GET /caregivers`
 *      di `worker/index.ts` baris 1387 memetakannya menjadi `caregiverId`
 *      dan `null` bila belum diterima.
 *
 * Sampai ketiganya dijawab, yang diuji di sini adalah setengahnya yang sudah
 * ada: sisi server-nya, lewat endpoint yang memang sudah diterapkan.
 */

import { expect, test } from "@playwright/test";

import { LINK_ID, apiErrorBody, apiOk, corsRoute, stubApi } from "./support/flow";

test.describe("TC-E2E-04 permukaan undangan pendamping", () => {
  test("undangan hanya menerima tiga izin yang dapat didelegasikan", async ({ page }) => {
    // FEATURE-SPECS S3: `edit_draft`, `upload_media`, `submit_review`.
    // `publish` dan `delete` TIDAK ada dalam daftar — keduanya keputusan
    // pemilik karya dan tidak dapat didelegasikan.
    //
    // `CaregiverPermissionSchema` di `lib/schemas.ts` baris 59 adalah
    // penerapannya, dan `CaregiverInviteSchema` menolak izin di luarnya.
    const delegable = ["edit_draft", "upload_media", "submit_review"];

    // Ditampung sebagai larik, bukan variabel tunggal. Penetapan di dalam
    // penangan rute tidak terlihat oleh analisis alur TypeScript pada baris
    // pembacaan, dan variabel tunggal menyempit menjadi `never`. Larik tidak
    // menyempit, sehingga pembacaannya tetap bertipe.
    const received: { readonly permissions?: readonly string[] }[] = [];
    await page.route("**/api/v1/caregivers/invite", async (route) => {
      await corsRoute(route, () => {
        received.push(
          JSON.parse(route.request().postData() ?? "{}") as {
            readonly permissions?: readonly string[];
          },
        );
        return apiOk({ linkId: LINK_ID, expiresAt: Date.now() + 86_400_000 });
      });
    });

    await page.goto("/");
    await page.evaluate(async (permissions) => {
      await fetch("http://localhost:8787/api/v1/caregivers/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer uji" },
        body: JSON.stringify({ phone: "+628123456789", permissions }),
      });
    }, delegable);

    // Yang terkirim adalah ketiganya, dan tidak lebih.
    expect(received.at(-1)?.permissions).toEqual(delegable);
    for (const forbidden of ["publish", "delete"]) {
      expect(delegable, `Izin ${forbidden} tidak boleh dapat didelegasikan`).not.toContain(forbidden);
    }
  });

  test("server menolak izin di luar daftar yang dapat didelegasikan", async ({ page }) => {
    // S3-01 dan TC-U-RBAC-04: izin mati secara bawaan, dan yang tidak ada di
    // skema tidak dapat diminta. Server menjawab dengan kode dari katalog.
    const denied = apiErrorBody(
      "FORBIDDEN",
      "Anda tidak punya akses untuk tindakan ini.",
      "NONE",
      403,
    );
    await stubApi(page, "POST", "/caregivers/invite", () => denied);

    await page.goto("/");
    const status = await page.evaluate(async () => {
      const response = await fetch("http://localhost:8787/api/v1/caregivers/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer uji" },
        body: JSON.stringify({ phone: "+628123456789", permissions: ["publish"] }),
      });
      return response.status;
    });

    expect(status).toBe(403);
  });
});

test.describe("TC-E2E-05 layar pendamping belum ada", () => {
  test("tidak ada tombol 'Cabut akses' di antarmuka mana pun", async ({ page }) => {
    // Ini bukan pemeriksaan yang diinginkan melainkan pencatatan keadaan.
    // S3 langkah 7 menyatakan "Cabut akses tersedia setiap saat", dan S3-02
    // menyebutnya kriteria paling penting di modul ini. Perilakunya sudah
    // diuji dari sisi server (TC-I-04, TC-SEC-16) dan dari sisi efeknya
    // (create-catalog.spec.ts).
    //
    // Yang belum ada adalah jalan masuknya bagi pengrajin.
    await page.goto("/");

    // Layar utama tidak menawarkannya.
    await expect(page.getByRole("button", { name: /Cabut akses/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Pendamping saya/ })).toHaveCount(0);

    // Dan tidak ada rute pendamping sama sekali.
    for (const path of ["/caregivers", "/pendamping", "/settings/caregivers"]) {
      const response = await page.goto(path);
      expect(response?.status(), `Rute ${path} tidak seharusnya ada sebelum layarnya dibangun`).toBe(404);
    }
  });
});
