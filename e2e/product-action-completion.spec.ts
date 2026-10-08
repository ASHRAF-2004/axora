import { expect, test } from "@playwright/test";
import { signInAsDemoOwner } from "./helpers/auth";

test("creation and image upload complete their native routes and do not restore the submitted creation draft", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/products/new");
  const name = `E2E action completion ${Date.now()}`;
  const form = page.locator('form[data-draft-id="create-product"]');
  await form.getByLabel("Product name").fill(name);
  await form.getByLabel("Subcategory").fill("Completion fixtures");
  await form.getByLabel("Axora internal cost (RM)").fill("12.50");
  await form.getByLabel("Description / specification").fill("Controlled completion regression fixture");
  await form.getByRole("button", { name: "Create product" }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+\/edit\?notice=product-created$/i);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const editorPath = new URL(page.url()).pathname;
  const uploadURL = new RegExp(`${editorPath}\\?notice=product-images-updated&uploaded=[0-9a-f-]{36}$`, "i");

  const upload = page.locator("form").filter({ has: page.getByRole("heading", { name: "Image slideshow" }) });
  await upload.locator('input[name="images"]').setInputFiles([
    "public/catalog/categories/office-basics.webp", "public/catalog/categories/other.webp",
  ]);
  await upload.getByLabel("Alternative text for this upload").fill("Controlled completion image");
  await upload.getByRole("button", { name: "Upload images" }).click();
  await expect(page).toHaveURL(uploadURL);
  const firstUpload = new URL(page.url()).searchParams.get("uploaded");
  expect(firstUpload).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.getByRole("status").filter({ hasText: "Product images uploaded successfully." })).toBeVisible();
  const gallery = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Manage gallery" }) });
  await expect(gallery.locator("article")).toHaveCount(2);
  await expect(page.getByText("2 of 8 images uploaded", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Dismiss notification" }).click();
  await upload.locator('input[name="images"]').setInputFiles("public/catalog/categories/cleaning-hygiene.webp");
  await upload.getByLabel("Alternative text for this upload").fill("Second completion image");
  await upload.getByRole("button", { name: "Upload images" }).click();
  await expect(page).toHaveURL(uploadURL);
  await expect.poll(() => new URL(page.url()).searchParams.get("uploaded")).not.toBe(firstUpload);
  await expect(page).toHaveURL(uploadURL);
  expect(new URL(page.url()).searchParams.get("uploaded")).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.getByRole("status").filter({ hasText: "Product images uploaded successfully." })).toBeVisible();
  await expect(gallery.locator("article")).toHaveCount(3);
  await expect(page.getByText("3 of 8 images uploaded", { exact: true })).toBeVisible();
  await expect(upload).toHaveCSS("position", "static");
  await gallery.scrollIntoViewIfNeeded();
  const [uploadBox, galleryBox] = await Promise.all([upload.boundingBox(), gallery.boundingBox()]);
  expect(uploadBox).not.toBeNull();
  expect(galleryBox).not.toBeNull();
  expect(uploadBox!.y + uploadBox!.height).toBeLessThanOrEqual(galleryBox!.y + 1);
  await page.reload();
  await page.waitForTimeout(350);
  await expect(upload.getByLabel("Alternative text for this upload")).toHaveValue("");

  // This specifically crosses the 300ms draft debounce boundary; it is not an
  // operation timeout or a substitute for any existing product assertion.
  await page.waitForTimeout(350);
  await page.goto("/products/new");
  await page.waitForTimeout(350);
  await expect(page.getByLabel("Product name")).toHaveValue("");
  await expect(page.getByLabel("Description / specification")).toHaveValue("");
});

test("a server validation error stays local and retains its submitted creation draft", async ({ page }) => {
  await signInAsDemoOwner(page);
  await page.goto("/products/new");
  const form = page.locator('form[data-draft-id="create-product"]');
  const name = `E2E preserved invalid draft ${Date.now()}`;
  await form.getByLabel("Product name").fill(name);
  await form.getByLabel("Subcategory").fill("Completion fixtures");
  await form.getByLabel("Axora internal cost (RM)").fill("12.50");
  await form.locator('input[name="customerMarkupPercentage"]').fill("101");
  // Deliberately reach server validation instead of stopping at browser max=100.
  await form.evaluate((element: HTMLFormElement) => { element.noValidate = true; });
  let releaseResponse!: () => void;
  let responseReady!: () => void;
  const heldResponse = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const receivedResponse = new Promise<void>((resolve) => { responseReady = resolve; });
  // Hold only this isolated demo action's already-fetched response, so the user
  // can still edit enabled controls while React considers submission pending.
  await page.route("**/products/new", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    responseReady();
    await heldResponse;
    await route.fulfill({ response });
  });
  const pendingName = `${name} edited while pending`;
  try {
    await form.getByRole("button", { name: "Create product" }).click();
    await receivedResponse;
    await expect(form.getByRole("button", { name: "Create product" })).toBeDisabled();
    await form.getByLabel("Product name").fill(pendingName);
    await form.locator('input[name="customerMarkupPercentage"]').fill("102");
  } finally {
    releaseResponse();
  }
  await expect(form.getByRole("alert")).toHaveText("Markup percentage must be between 0 and 100.");
  await expect(page).toHaveURL(/\/products\/new$/);
  await expect(form.getByLabel("Product name")).toHaveValue(pendingName);
  await page.unroute("**/products/new");
  await page.reload();
  await expect(page.getByLabel("Product name")).toHaveValue(pendingName);
  await expect(page.locator('input[name="customerMarkupPercentage"]')).toHaveValue("102");

  const secondName = `${pendingName} second error`;
  await form.getByLabel("Product name").fill(secondName);
  await form.locator('input[name="customerMarkupPercentage"]').fill("103");
  await form.evaluate((element: HTMLFormElement) => { element.noValidate = true; });
  await form.getByRole("button", { name: "Create product" }).click();
  await expect(form.getByRole("alert")).toHaveText("Markup percentage must be between 0 and 100.");
  await expect(form.getByLabel("Product name")).toHaveValue(secondName);
  await expect(form.locator('input[name="customerMarkupPercentage"]')).toHaveValue("103");

  // An explicit reset after the error must still discard the failed draft.
  await form.evaluate((element: HTMLFormElement) => element.reset());
  await page.waitForTimeout(350);
  await page.reload();
  await page.waitForTimeout(350);
  await expect(page.getByLabel("Product name")).toHaveValue("");
  await expect(page.locator('input[name="customerMarkupPercentage"]')).toHaveValue("10");
});
