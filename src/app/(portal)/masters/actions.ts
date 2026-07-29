"use server";

import { requirePermission } from "@/lib/auth";
import { updateProduct } from "@/lib/product-admin";
import { deleteProduct } from "@/lib/product-delete";
import {
  deactivateProductImage,
  prepareProductImages,
  savePreparedProductImages,
  saveProductImages,
  setPrimaryProductImage,
  updateProductImageAltText,
} from "@/lib/product-images";
import { createBranch, createCompany, createProduct, createSupplier, setMasterActive, type MasterEntity } from "@/lib/repository";
import { branchSchema, companySchema, productSchema, readFormText, supplierSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const number = (data: FormData, key: string, fallback = 0) => data.get(key) === null || data.get(key) === "" ? fallback : data.get(key);

function productInput(formData: FormData) {
  return productSchema.parse({
    name: readFormText(formData, "name"),
    category: readFormText(formData, "category"),
    subcategory: readFormText(formData, "subcategory"),
    brand: readFormText(formData, "brand"),
    size: readFormText(formData, "size"),
    unit: readFormText(formData, "unit"),
    packaging: readFormText(formData, "packaging"),
    description: readFormText(formData, "description"),
    defaultBuyPrice: number(formData, "defaultBuyPrice"),
    defaultSellPrice: number(formData, "defaultSellPrice"),
    minimumOrderQuantity: number(formData, "minimumOrderQuantity", 1),
    deliverySlaDays: number(formData, "deliverySlaDays", 1),
    preferredSupplierId: readFormText(formData, "preferredSupplierId") || undefined,
  });
}

function files(formData: FormData, key: string) {
  return formData.getAll(key).filter((value): value is File => value instanceof File && value.size > 0);
}

function revalidateProduct(productId?: string) {
  revalidatePath("/products");
  revalidatePath("/requests/new");
  if (productId) revalidatePath(`/products/${productId}/edit`);
}

export async function createCompanyAction(formData: FormData) {
  const user = await requirePermission("manage_companies");
  const mainContactName = readFormText(formData, "mainContactName");
  const mainContactEmail = readFormText(formData, "mainContactEmail");
  const mainContactPhone = readFormText(formData, "mainContactPhone");
  const input = companySchema.parse({
    name: readFormText(formData, "name"), industry: readFormText(formData, "industry"), mainContactName,
    mainContactEmail, mainContactPhone, billingContactName: readFormText(formData, "billingContactName") || mainContactName,
    billingContactEmail: readFormText(formData, "billingContactEmail") || mainContactEmail,
    billingContactPhone: readFormText(formData, "billingContactPhone") || mainContactPhone,
    billingAddress: readFormText(formData, "billingAddress"), paymentTerms: readFormText(formData, "paymentTerms"),
    billingCycle: readFormText(formData, "billingCycle"), notes: readFormText(formData, "notes"),
  });
  await createCompany(input, user);
  revalidatePath("/companies"); revalidatePath("/dashboard");
  redirect("/companies?notice=company-created");
}

export async function createBranchAction(formData: FormData) {
  const user = await requirePermission("manage_branches");
  const input = branchSchema.parse({ companyId: readFormText(formData, "companyId"), name: readFormText(formData, "name"), branchCode: readFormText(formData, "branchCode"),
    deliveryAddress: readFormText(formData, "deliveryAddress"), city: readFormText(formData, "city"), contactName: readFormText(formData, "contactName"),
    contactPhone: readFormText(formData, "contactPhone"), contactEmail: readFormText(formData, "contactEmail"), deliveryInstructions: readFormText(formData, "deliveryInstructions"), notes: readFormText(formData, "notes") });
  await createBranch(input, user);
  revalidatePath("/branches");
  revalidatePath("/dashboard");
  redirect("/branches?notice=branch-created");
}

export async function createSupplierAction(formData: FormData) {
  const user = await requirePermission("manage_suppliers");
  const input = { ...supplierSchema.parse({ name: readFormText(formData, "name"), category: readFormText(formData, "category"), contactName: readFormText(formData, "contactName"), phone: readFormText(formData, "phone"),
    email: readFormText(formData, "email"), address: readFormText(formData, "address"), coverageArea: readFormText(formData, "coverageArea"), paymentTerms: readFormText(formData, "paymentTerms"),
    leadTimeDays: number(formData, "leadTimeDays", 1), minimumOrderQuantity: number(formData, "minimumOrderQuantity", 1), mainProducts: readFormText(formData, "mainProducts"), notes: readFormText(formData, "notes") }),
  };
  await createSupplier(input, user);
  revalidatePath("/suppliers"); revalidatePath("/dashboard");
  redirect("/suppliers?notice=supplier-created");
}

export async function createProductAction(formData: FormData) {
  const user = await requirePermission("manage_catalog");
  const selectedFiles = [...files(formData, "images"), ...files(formData, "image")];
  const preparedImages = await prepareProductImages(selectedFiles);
  const productId = await createProduct(productInput(formData), user);
  if (preparedImages.length) {
    await savePreparedProductImages({
      productId,
      images: preparedImages,
      altText: readFormText(formData, "imageAltText"),
    }, user);
  }
  revalidateProduct(productId);
  redirect(`/products/${productId}/edit?notice=product-created`);
}

export async function updateProductAction(productId: string, formData: FormData) {
  const user = await requirePermission("manage_catalog");
  await updateProduct(productId, productInput(formData), user);
  revalidateProduct(productId);
  redirect("/products?notice=product-updated");
}

export async function deleteProductAction(productId: string) {
  const user = await requirePermission("manage_catalog");
  await deleteProduct(productId, user);
  revalidateProduct();
}

export async function addProductImagesAction(productId: string, formData: FormData) {
  const user = await requirePermission("manage_catalog");
  const selectedFiles = files(formData, "images");
  if (!selectedFiles.length) throw new Error("Choose at least one product image.");
  await saveProductImages({ productId, files: selectedFiles, altText: readFormText(formData, "imageAltText") }, user);
  revalidateProduct(productId);
}

export async function setPrimaryProductImageAction(productId: string, imageId: string) {
  const user = await requirePermission("manage_catalog");
  await setPrimaryProductImage(productId, imageId, user);
  revalidateProduct(productId);
}

export async function updateProductImageAltTextAction(productId: string, imageId: string, formData: FormData) {
  const user = await requirePermission("manage_catalog");
  await updateProductImageAltText(productId, imageId, readFormText(formData, "altText"), user);
  revalidateProduct(productId);
}

export async function removeProductImageAction(productId: string, imageId: string) {
  const user = await requirePermission("manage_catalog");
  await deactivateProductImage(productId, imageId, user);
  revalidateProduct(productId);
}

export async function setMasterActiveAction(entity: MasterEntity, id: string, active: boolean) {
  const permission = entity === "companies"
    ? "manage_companies"
    : entity === "branches"
      ? "manage_branches"
      : entity === "products"
        ? "manage_catalog"
        : "manage_suppliers";
  const user = await requirePermission(permission);
  await setMasterActive(entity, id, active, user);
  revalidatePath(`/${entity}`); revalidatePath("/dashboard");
}

export async function replaceProductImageAction(productId: string, formData: FormData) {
  const user = await requirePermission("manage_catalog");
  const image = files(formData, "image")[0];
  if (!image) throw new Error("Choose a product image.");
  await saveProductImages({ productId, files: [image], altText: readFormText(formData, "imageAltText") }, user);
  revalidateProduct(productId);
}
