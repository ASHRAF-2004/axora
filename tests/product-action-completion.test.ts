import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  canManageCommercialCatalog: vi.fn(),
  createProduct: vi.fn(),
  createCatalogDraftProduct: vi.fn(),
  prepareProductImages: vi.fn(),
  savePreparedProductImages: vi.fn(),
  saveProductImages: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission, requireSession: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ canAccess: vi.fn(), canManageCommercialCatalog: mocks.canManageCommercialCatalog }));
vi.mock("@/lib/repository", () => ({
  createProduct: mocks.createProduct, createCatalogDraftProduct: mocks.createCatalogDraftProduct,
  createBranch: vi.fn(), setMasterActive: vi.fn(),
}));
vi.mock("@/lib/product-images", () => ({
  prepareProductImages: mocks.prepareProductImages,
  savePreparedProductImages: mocks.savePreparedProductImages,
  saveProductImages: mocks.saveProductImages,
  deactivateProductImage: vi.fn(), setPrimaryProductImage: vi.fn(), updateProductImageAltText: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { addProductImagesAction, createProductAction } from "@/app/(portal)/masters/actions";

const actor = { id: "90000000-0000-4000-8000-000000000001", isOwner: true };
const productId = "30000000-0000-4000-8000-000000000099";
const imageId = "40000000-0000-4000-8000-000000000099";
const initial = { status: "idle" as const };
const preparedImage = { fileName: "fixture.webp", contentType: "image/webp", content: Buffer.from("fixture"), width: 1, height: 1, sha256: "fixture" };

function productForm() {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    name: "Controlled product", category: "Office", subcategory: "Fixtures", unit: "each",
    defaultBuyPrice: "12.50", customerMarkupPercentage: "10", deliverySlaDays: "1",
    description: "Controlled catalogue fixture", imageAltText: "Controlled image",
  })) data.set(name, value);
  return data;
}

function imageForm() {
  const data = new FormData();
  data.append("images", new File(["image fixture"], "fixture.webp", { type: "image/webp" }));
  data.set("imageAltText", "Controlled image");
  return data;
}

describe("native product action completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.canManageCommercialCatalog.mockReturnValue(true);
    mocks.createProduct.mockResolvedValue(productId);
    mocks.createCatalogDraftProduct.mockResolvedValue(productId);
    mocks.prepareProductImages.mockResolvedValue([]);
    mocks.savePreparedProductImages.mockResolvedValue([]);
    mocks.saveProductImages.mockResolvedValue([{ id: imageId, altText: "Controlled image", isPrimary: true, sortOrder: 0 }]);
  });

  it("redirects only after authorized creation and revalidation, without a client success handoff", async () => {
    await expect(createProductAction(initial, productForm()))
      .rejects.toThrow(`REDIRECT:/products/${productId}/edit?notice=product-created`);
    expect(mocks.requirePermission).toHaveBeenCalledWith("manage_catalog");
    expect(mocks.createProduct).toHaveBeenCalledOnce();
    expect(mocks.createProduct).toHaveBeenCalledWith(expect.objectContaining({
      defaultBuyPrice: 12.5, defaultSellPrice: 13.75, customerMarkupPercentage: 10,
    }), actor);
    expect(mocks.createCatalogDraftProduct).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path))
      .toEqual(["/products", "/requests/new", `/products/${productId}`, `/products/${productId}/edit`]);
    expect(mocks.createProduct.mock.invocationCallOrder[0]).toBeLessThan(mocks.revalidatePath.mock.invocationCallOrder[0]);
    expect(mocks.revalidatePath.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0]);
  });

  it("preserves the catalog-manager draft destination without accepting confidential costs", async () => {
    mocks.canManageCommercialCatalog.mockReturnValue(false);
    const form = productForm();
    form.set("defaultBuyPrice", "999");
    await expect(createProductAction(initial, form))
      .rejects.toThrow(`REDIRECT:/products/${productId}/edit?notice=product-draft-created`);
    expect(mocks.createProduct).not.toHaveBeenCalled();
    expect(mocks.createCatalogDraftProduct).toHaveBeenCalledWith(expect.any(Object), actor);
    expect(mocks.createCatalogDraftProduct.mock.calls[0][0]).not.toHaveProperty("defaultBuyPrice");
    expect(mocks.createCatalogDraftProduct.mock.calls[0][0]).not.toHaveProperty("defaultSellPrice");
  });

  it("saves prepared images before the same creation redirect", async () => {
    mocks.prepareProductImages.mockResolvedValue([preparedImage]);
    await expect(createProductAction(initial, productForm()))
      .rejects.toThrow(`REDIRECT:/products/${productId}/edit?notice=product-created`);
    expect(mocks.savePreparedProductImages).toHaveBeenCalledWith({ productId, images: [preparedImage], altText: "Controlled image" }, actor);
    expect(mocks.savePreparedProductImages.mock.invocationCallOrder[0]).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0]);
  });

  it("redirects to the existing image-retry editor after creation commits but image storage fails", async () => {
    mocks.prepareProductImages.mockResolvedValue([preparedImage]);
    mocks.savePreparedProductImages.mockRejectedValue(new Error("Image storage unavailable"));
    await expect(createProductAction(initial, productForm()))
      .rejects.toThrow(`REDIRECT:/products/${productId}/edit?notice=product-created-image-retry`);
    expect(mocks.createProduct).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledOnce();
  });

  it.each(["validation", "image preparation", "creation"])("keeps %s failures local, without redirecting or reporting success", async (stage) => {
    const form = productForm();
    if (stage === "validation") form.set("name", "");
    if (stage === "image preparation") mocks.prepareProductImages.mockRejectedValue(new Error("Image preparation unavailable"));
    if (stage === "creation") mocks.createProduct.mockRejectedValue(new Error("Product already exists"));
    expect(await createProductAction(initial, form)).toEqual({ status: "error", message: expect.any(String) });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.savePreparedProductImages).not.toHaveBeenCalled();
    if (stage !== "creation") expect(mocks.createProduct).not.toHaveBeenCalled();
  });

  it("redirects uploaded images only after authorized persistence and revalidation", async () => {
    const form = imageForm();
    await expect(addProductImagesAction(productId, form))
      .rejects.toThrow(`REDIRECT:/products/${productId}/edit?notice=product-images-updated&uploaded=${imageId}`);
    expect(mocks.requirePermission).toHaveBeenCalledWith("manage_catalog");
    expect(mocks.saveProductImages).toHaveBeenCalledWith({ productId, files: form.getAll("images"), altText: "Controlled image" }, actor);
    expect(mocks.saveProductImages.mock.invocationCallOrder[0]).toBeLessThan(mocks.revalidatePath.mock.invocationCallOrder[0]);
    expect(mocks.revalidatePath.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0]);
  });

  it("preserves the missing-image notice without a mutation", async () => {
    await expect(addProductImagesAction(productId, new FormData()))
      .rejects.toThrow(`REDIRECT:/products/${productId}/edit?notice=product-image-required`);
    expect(mocks.saveProductImages).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("uses newly stored image IDs to distinguish successive upload completions", async () => {
    const secondImageId = "40000000-0000-4000-8000-000000000100";
    mocks.saveProductImages.mockResolvedValueOnce([{ id: imageId }]).mockResolvedValueOnce([{ id: secondImageId }]);
    await expect(addProductImagesAction(productId, imageForm())).rejects.toThrow(`uploaded=${imageId}`);
    await expect(addProductImagesAction(productId, imageForm())).rejects.toThrow(`uploaded=${secondImageId}`);
    expect(mocks.redirect.mock.calls[0][0]).not.toBe(mocks.redirect.mock.calls[1][0]);
    expect(mocks.saveProductImages).toHaveBeenCalledTimes(2);
  });

  it("does not report upload success after persistence fails", async () => {
    mocks.saveProductImages.mockRejectedValue(new Error("Image persistence unavailable"));
    await expect(addProductImagesAction(productId, imageForm())).rejects.toThrow("Image persistence unavailable");
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not create, store images, or redirect after catalog authorization is refused", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("Forbidden"));
    await expect(createProductAction(initial, productForm())).rejects.toThrow("Forbidden");
    await expect(addProductImagesAction(productId, imageForm())).rejects.toThrow("Forbidden");
    expect(mocks.createProduct).not.toHaveBeenCalled();
    expect(mocks.createCatalogDraftProduct).not.toHaveBeenCalled();
    expect(mocks.saveProductImages).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
