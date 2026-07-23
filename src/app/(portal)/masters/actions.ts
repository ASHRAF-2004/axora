"use server";

import { createBranch, createCompany, createProduct, createSupplier, setMasterActive, type MasterEntity } from "@/lib/repository";
import { requireRole } from "@/lib/auth";
import { branchSchema, companySchema, productSchema, readFormText, supplierSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";

const number = (data: FormData, key: string, fallback = 0) => data.get(key) === null || data.get(key) === "" ? fallback : data.get(key);

export async function createCompanyAction(formData: FormData) {
  const user = await requireRole(["ADMIN"]);
  if (!user.isOwner) throw new Error("Only the Axora platform owner can create companies.");
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
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  const input = branchSchema.parse({ companyId: readFormText(formData, "companyId"), name: readFormText(formData, "name"), branchCode: readFormText(formData, "branchCode"),
    deliveryAddress: readFormText(formData, "deliveryAddress"), city: readFormText(formData, "city"), contactName: readFormText(formData, "contactName"),
    contactPhone: readFormText(formData, "contactPhone"), contactEmail: readFormText(formData, "contactEmail"), deliveryInstructions: readFormText(formData, "deliveryInstructions"), notes: readFormText(formData, "notes") });
  await createBranch(input, user);
  revalidatePath("/branches");
}

export async function createSupplierAction(formData: FormData) {
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  const input = { ...supplierSchema.parse({ name: readFormText(formData, "name"), category: readFormText(formData, "category"), contactName: readFormText(formData, "contactName"), phone: readFormText(formData, "phone"),
    email: readFormText(formData, "email"), address: readFormText(formData, "address"), coverageArea: readFormText(formData, "coverageArea"), paymentTerms: readFormText(formData, "paymentTerms"),
    leadTimeDays: number(formData, "leadTimeDays", 1), minimumOrderQuantity: number(formData, "minimumOrderQuantity", 1), mainProducts: readFormText(formData, "mainProducts"), notes: readFormText(formData, "notes") }),
    companyId: readFormText(formData, "companyId") || undefined };
  await createSupplier(input, user);
  revalidatePath("/suppliers"); revalidatePath("/dashboard");
}

export async function createProductAction(formData: FormData) {
  const user = await requireRole(["ADMIN", "OPERATIONS"]);
  const input = { ...productSchema.parse({ name: readFormText(formData, "name"), category: readFormText(formData, "category"), subcategory: readFormText(formData, "subcategory"), brand: readFormText(formData, "brand"),
    size: readFormText(formData, "size"), unit: readFormText(formData, "unit"), packaging: readFormText(formData, "packaging"), description: readFormText(formData, "description"),
    defaultBuyPrice: number(formData, "defaultBuyPrice"), defaultSellPrice: number(formData, "defaultSellPrice"), minimumOrderQuantity: number(formData, "minimumOrderQuantity", 1),
    deliverySlaDays: number(formData, "deliverySlaDays", 1), preferredSupplierId: readFormText(formData, "preferredSupplierId") || undefined }),
    companyId: readFormText(formData, "companyId") || undefined };
  await createProduct(input, user);
  revalidatePath("/products");
}

export async function setMasterActiveAction(entity: MasterEntity, id: string, active: boolean) {
  const user = await requireRole(entity === "companies" ? ["ADMIN"] : ["ADMIN", "OPERATIONS"]);
  if (entity === "companies" && !user.isOwner) throw new Error("Only the Axora platform owner can change company status.");
  await setMasterActive(entity, id, active, user);
  revalidatePath(`/${entity}`); revalidatePath("/dashboard");
}
