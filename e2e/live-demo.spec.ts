import { expect, test } from "@playwright/test";

test.skip(process.env.E2E_WITH_WORKER !== "1", "Memerlukan Next, Worker lokal, D1/R2, dan penyedia AI.");

test("TC-E2E-01 alur nyata dari masuk sampai katalog pembeli", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/masuk");
  await page.getByLabel("Nomor ponsel").fill("08110009928");
  await page.getByRole("button", { name: "Kirim kode" }).click();
  await page.getByLabel("Kode dari SMS").fill("123456");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/create\/photo$/);

  await page.getByLabel("Pilih foto produk").setInputFiles("e2e/fixtures/foto-demo.png");
  await expect(page.getByText("Foto produk tersimpan.")).toBeVisible();
  await page.getByRole("button", { name: "Lanjut rekam cerita" }).click();
  await page.getByRole("button", { name: "Lewati rekaman (tulis cerita langsung)" }).click();
  await page.getByRole("button", { name: "Tulis cerita sendiri tanpa menunggu transkrip" }).click();
  await page.getByLabel("Transkrip cerita Anda").fill(
    "Ini tas kecil anyaman rotan warna cokelat alami dengan pegangan melengkung. Saya membuatnya dengan tangan dari rotan pilihan.",
  );
  await page.getByRole("button", { name: "Sudah benar, lanjutkan" }).click();
  await expect(page).toHaveURL(/\/create\/process$/);

  const normal = page.getByRole("button", { name: "Lanjut periksa hasil" });
  const original = page.getByRole("button", { name: "Lanjut dengan foto asli" });
  await expect(normal.or(original)).toBeEnabled({ timeout: 180_000 });
  if (await original.isVisible()) await original.click();
  else await normal.click();

  await expect(page.getByLabel("Nama produk")).not.toHaveValue("");
  await expect(page.getByRole("heading", { name: "Caption media sosial" })).toBeVisible();
  await expect(page.getByText("Kata kunci:", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Sudah sesuai, lanjut terbitkan" }).click();
  await page.getByLabel("Saya setuju katalog ini dilihat pembeli").check();
  await page.getByRole("button", { name: "Terbitkan katalog" }).click();
  await expect(page.getByText("Katalog Anda sudah terbit dan dapat dilihat pembeli.")).toBeVisible();

  const [buyer] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Buka katalog pembeli" }).click(),
  ]);
  await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(buyer.getByRole("heading", { name: "Spesifikasi" })).toBeVisible();
  await expect(buyer.getByRole("region", { name: "Subtitle" })).toBeVisible();
});
