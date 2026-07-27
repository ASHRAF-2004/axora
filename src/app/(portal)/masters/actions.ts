"use server";

import { createBranch, createCompany, createProduct, createSupplier, setMasterActive, type MasterEntity } from "@/lib/repository";
import { requirePermission } from "@/lib/auth";
import { normalizeProductImage, saveProductImage } from "@/lib/product-images";
import { branchSchema, companySchema, productSchema, readFormText, supplierSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";

const number = (data: FormData, key: string, fallback = 0) => data.get(key) === null || data.get(key) === "" ? fallback : data.get(key);

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
}

export async function createBranchAction(formData: FormData) {
  const user = await requirePermission("manage_branches");
  const input = branchSchema.parse({ companyId: readFormText(formData, "companyId"), name: readFormText(formData, "name"), branchCode: readFormText(formData, "branchCode"),
    deliveryAddress: readFormText(formData, "deliveryAddress"), city: readFormText(formData, "city"), contactName: readFormText(formData, "contactName"),
    contactPhone: readFormText(formData, "contactPhone"), contactEmail: readFormText(formData, "contactEmail"), deliveryInstructions: readFormText(formData, "deliveryInstructions"), notes: readFormText(formData, "notes") });
  await createBranch(input, user);
  revalidatePath("/branches");
}

export async function createSupplierAction(formData: FormData) {
  const user = await requirePermission("manage_suppliers");
  const input = { ...supplierSchema.parse({ name: readFormText(formData, "name"), category: readFormText(formData, "category"), contactName: readFormText(formData, "contactName"), phone: readFormText(formData, "phone"),
    email: readFormText(formData, "email"), address: readFormText(formData, "address"), coverageArea: readFormText(formData, "coverageArea"), paymentTerms: readFormText(formData, "paymentTerms"),
    leadTimeDays: number(formData, "leadTimeDays", 1), minimumOrderQuantity: number(formData, "minimumOrderQuantity", 1), mainProducts: readFormText(formData, "mainProducts"), notes: readFormText(formData, "notes") }),
  };
  await createSupplier(input, user);
  revalidatePath("/suppliers"); revalidatePath("/dashboard");
}

export async function createProductAction(formData: FormData) {
  const user = await requirePermission("manage_catalog");
  const image = formData.get("image");
  if (image instanceof File && image.size > 0) await normalizeProductImage(image);
  const input = { ...productSchema.parse({ name: readFormText(formData, "name"), category: readFormText(formData, "category"), subcategory: readFormText(formData, "subcategory"), brand: readFormText(formData, "brand"),
    size: readFormText(formData, "size"), unit: readFormText(formData, "unit"), packaging: readFormText(formData, "packaging"), description: readFormText(formData, "description"),
    defaultBuyPrice: number(formData, "defaultBuyPrice"), defaultSellPrice: number(formData, "defaultSellPrice"), minimumOrderQuantity: number(formData, "minimumOrderQuantity", 1),
    deliverySlaDays: number(formData, "deliverySlaDays", 1), preferredSupplierId: readFormText(formData, "preferredSupplierId") || undefined }),
  };
  const productId = await createProduct(input, user);
  if (image instanceof File && image.size > 0) {
    await saveProductImage({ productId, file: image, altText: readFormText(formData, "imageAltText") }, user);
  }
  revalidatePath("/products");
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
  const image = formData.get("image");
  if (!(image instanceof File) || !image.size) throw new Error("Choose a product image.");
  await saveProductImage({ productId, file: image, altText: readFormText(formData, "imageAltText") }, user);
  revalidatePath("/products");
}
