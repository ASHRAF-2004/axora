"use server";

import { requirePermission } from "@/lib/auth";
import { sendAccountSetupEmail } from "@/lib/account-email";
import {
  AccountSetupInvitationQuotaError,
  createInvitedUser,
  recordAccountSetupDelivery,
  type AccountSetupInvitationResult,
} from "@/lib/account-setup";
import {
  activateCompany,
  CompanyCreationCommandConflictError,
  createCompanyWithoutBrand,
  COMPANY_LIFECYCLE_STATUSES,
  resolveCompanyDuplicate,
  setCompanyPublication,
  suspendCompany,
  syncCompanyAdministrator,
  transitionCompanyLifecycle,
} from "@/lib/company-lifecycle";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { createCompanyWithBrand, regenerateCompanyBrand } from "@/lib/tenant-branding";
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
import { createBranch, createProduct, setMasterActive, type MasterEntity } from "@/lib/repository";
import { branchSchema, directCompanyCreateSchema, productSchema, readFormText, validationMessage } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { calculateCommercialSellingPrice } from "@/lib/procurement-rules";

const number = (data: FormData, key: string, fallback = 0) => data.get(key) === null || data.get(key) === "" ? fallback : data.get(key);
function productInput(formData: FormData) {
  const defaultBuyPrice = Number(number(formData, "defaultBuyPrice"));
  return productSchema.parse({
    name: readFormText(formData, "name"),
    category: readFormText(formData, "category"),
    subcategory: readFormText(formData, "subcategory"),
    brand: readFormText(formData, "brand"),
    size: readFormText(formData, "size"),
    unit: readFormText(formData, "unit"),
    packaging: "",
    description: readFormText(formData, "description"),
    defaultBuyPrice,
    defaultSellPrice: calculateCommercialSellingPrice(defaultBuyPrice),
    deliverySlaDays: number(formData, "deliverySlaDays", 1),
  });
}

function files(formData: FormData, key: string) {
  return formData.getAll(key).filter((value): value is File => value instanceof File && value.size > 0);
}

function revalidateProduct(productId?: string) {
  revalidatePath("/products");
  revalidatePath("/requests/new");
  if (productId) {
    revalidatePath(`/products/${productId}`);
    revalidatePath(`/products/${productId}/edit`);
  }
}

function revalidateProductAfterEditorUpdate(productId: string) {
  revalidatePath("/products");
  revalidatePath("/requests/new");
  revalidatePath(`/products/${productId}`);
}

export async function createCompanyAction(formData: FormData) {
  const user = await requirePermission("create_companies");
  const logo = formData.get("logo");
  const commandId = z.uuid().parse(readFormText(formData, "commandId"));
  const input = directCompanyCreateSchema.parse({
    name: readFormText(formData, "name"),
    legalName: readFormText(formData, "legalName") || undefined,
    industry: readFormText(formData, "industry") || undefined,
    companyInformation: undefined,
    websiteUrl: readFormText(formData, "websiteUrl"),
    mainContactName: readFormText(formData, "mainContactName"),
    billingCycle: "Monthly",
    notes: undefined,
  });
  let created: { companyId: string };
  try {
    created = logo instanceof File && logo.size > 0
      ? await createCompanyWithBrand(input, logo, user, commandId)
      : await createCompanyWithoutBrand(input, user, commandId);
  } catch (error) {
    if (error instanceof CompanyCreationCommandConflictError) {
      redirect("/companies/new?notice=company-command-conflict");
    }
    throw error;
  }
  revalidatePath("/companies"); revalidatePath("/dashboard");
  redirect(`/companies/${created.companyId}?notice=company-created`);
}

function lifecycleRedirect(notice: string, companyId: string) {
  revalidatePath("/companies");
  revalidatePath("/dashboard");
  redirect(`/companies?notice=${notice}&created=${encodeURIComponent(companyId)}`);
}

export async function transitionCompanyLifecycleAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const companyId = z.uuid().parse(readFormText(formData, "companyId"));
  const toStatus = z.enum(COMPANY_LIFECYCLE_STATUSES).parse(
    readFormText(formData, "toStatus"),
  );
  const reason = `COMPANY_STATUS_UPDATED_${toStatus}`;
  await transitionCompanyLifecycle(actor, companyId, toStatus, reason);
  lifecycleRedirect("company-status-updated", companyId);
}

export async function resolveCompanyDuplicateAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const companyId = z.uuid().parse(readFormText(formData, "companyId"));
  const decision = z.enum(["CLEAR", "CONFIRM"]).parse(
    readFormText(formData, "decision"),
  );
  const reason = `COMPANY_DUPLICATE_${decision}`;
  await resolveCompanyDuplicate(actor, companyId, decision, reason);
  lifecycleRedirect("company-duplicate-reviewed", companyId);
}

export async function activateCompanyAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const companyId = z.uuid().parse(readFormText(formData, "companyId"));
  const reason = "COMPANY_ACTIVATED";
  const mutation = await activateCompany(actor, companyId, reason);
  lifecycleRedirect(
    mutation.blockedReasons?.length ? "company-activation-blocked" : "company-activated",
    companyId,
  );
}

export async function suspendCompanyAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const companyId = z.uuid().parse(readFormText(formData, "companyId"));
  const reason = "COMPANY_SUSPENDED";
  await suspendCompany(actor, companyId, reason);
  lifecycleRedirect("company-suspended", companyId);
}

export async function setCompanyPublicationAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const companyId = z.uuid().parse(readFormText(formData, "companyId"));
  const isPubliclyListed = z.enum(["true", "false"]).parse(
    readFormText(formData, "isPubliclyListed"),
  ) === "true";
  const reason = isPubliclyListed ? "COMPANY_PUBLISHED" : "COMPANY_UNPUBLISHED";
  await setCompanyPublication(actor, companyId, isPubliclyListed, reason);
  lifecycleRedirect(isPubliclyListed ? "company-published" : "company-unpublished", companyId);
}

export async function syncCompanyAdministratorAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const companyId = z.uuid().parse(readFormText(formData, "companyId"));
  await syncCompanyAdministrator(
    actor,
    companyId,
    "Company Administrator invitation and activation state checked",
  );
  lifecycleRedirect("company-administrator-synced", companyId);
}

export async function inviteCompanyAdministratorAction(formData: FormData) {
  const actor = await requirePermission("manage_companies");
  const input = z.object({
    companyId: z.uuid(),
    displayName: z.string().trim().min(2).max(200),
    email: z.email().max(254),
    preferredLocale: z.enum(SUPPORTED_LOCALES),
  }).parse({
    companyId: readFormText(formData, "companyId"),
    displayName: readFormText(formData, "displayName"),
    email: readFormText(formData, "email"),
    preferredLocale: readFormText(formData, "preferredLocale") || "en",
  });

  let invitation: AccountSetupInvitationResult;
  try {
    invitation = await createInvitedUser({
      companyId: input.companyId,
      displayName: input.displayName,
      email: input.email,
      preferredLocale: input.preferredLocale,
      role: "COMPANY_ADMIN",
      jobTitle: "Company Administrator",
    }, actor);
  } catch (error) {
    if (error instanceof AccountSetupInvitationQuotaError) {
      lifecycleRedirect("company-administrator-invitation-rate-limited", input.companyId);
    }
    throw error;
  }

  let delivery: Awaited<ReturnType<typeof sendAccountSetupEmail>>;
  try {
    delivery = await sendAccountSetupEmail(invitation);
  } catch {
    delivery = { succeeded: false, status: "failed" };
  }
  let deliveryRecorded = false;
  try {
    await recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: delivery.succeeded,
      providerMessageId: delivery.providerMessageId,
      providerName: delivery.providerName,
      status: delivery.status,
    });
    deliveryRecorded = true;
  } catch {
    deliveryRecorded = false;
  }
  if (delivery.succeeded && deliveryRecorded) {
    await syncCompanyAdministrator(
      actor,
      input.companyId,
      "Secure Company Administrator invitation delivered",
    );
  }
  revalidatePath("/users");
  lifecycleRedirect(
    delivery.succeeded && deliveryRecorded
      ? "company-administrator-invited"
      : "company-administrator-email-failed",
    input.companyId,
  );
}

export async function regenerateCompanyBrandAction(companyId: string, formData: FormData) {
  const user = await requirePermission("manage_companies");
  const logo = formData.get("logo");
  if (!(logo instanceof File) || logo.size < 1) redirect("/companies?notice=company-logo-required");
  await regenerateCompanyBrand(
    companyId,
    Buffer.from(await logo.arrayBuffer()),
    logo.name,
    logo.type || undefined,
    user,
  );
  revalidatePath("/companies");
  revalidatePath("/dashboard");
  revalidatePath("/companies/" + companyId + "/theme");
  redirect("/companies/" + encodeURIComponent(companyId) + "/theme?notice=draft-generated");
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

export type ProductActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; redirectTo: string };

export async function createProductAction(
  _previous: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const user = await requirePermission("manage_catalog");
  let input: ReturnType<typeof productInput>;
  let preparedImages: Awaited<ReturnType<typeof prepareProductImages>>;
  try {
    input = productInput(formData);
    preparedImages = await prepareProductImages([
      ...files(formData, "images"), ...files(formData, "image"),
    ]);
  } catch (error) {
    return { status: "error", message: validationMessage(error) };
  }
  let productId: string;
  try {
    productId = await createProduct(input, user);
  } catch (error) {
    return { status: "error", message: validationMessage(error) };
  }
  if (preparedImages.length) {
    try {
      await savePreparedProductImages({
        productId,
        images: preparedImages,
        altText: readFormText(formData, "imageAltText"),
      }, user);
    } catch {
      revalidateProduct(productId);
      return {
        status: "success",
        redirectTo: `/products/${productId}/edit?notice=product-created-image-retry`,
      };
    }
  }
  revalidateProduct(productId);
  return {
    status: "success",
    redirectTo: `/products/${productId}/edit?notice=product-created`,
  };
}

export async function updateProductAction(
  productId: string,
  _previous: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  const user = await requirePermission("manage_catalog");
  try {
    await updateProduct(productId, productInput(formData), user);
  } catch (error) {
    return { status: "error", message: validationMessage(error) };
  }
  // Do not invalidate the currently mounted editor segment here. Next applies
  // Server Action revalidation before ProductActionForm handles redirectTo;
  // refreshing this exact segment can supersede and abort that navigation.
  revalidateProductAfterEditorUpdate(productId);
  return { status: "success", redirectTo: "/products?notice=product-updated" };
}

export async function deleteProductAction(productId: string) {
  const user = await requirePermission("manage_catalog");
  await deleteProduct(productId, user);
  revalidateProduct();
}

export async function addProductImagesAction(productId: string, formData: FormData) {
  const user = await requirePermission("manage_catalog");
  const selectedFiles = files(formData, "images");
  if (!selectedFiles.length) redirect(`/products/${productId}/edit?notice=product-image-required`);
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
  if (entity === "companies") {
    throw new Error("Company activation is controlled by the onboarding lifecycle.");
  }
  const permission = entity === "branches"
    ? "manage_branches"
    : "manage_catalog";
  const user = await requirePermission(permission);
  await setMasterActive(entity, id, active, user);
  revalidatePath(`/${entity}`); revalidatePath("/dashboard");
  if (entity === "branches") revalidatePath(`/branches/${id}`);
}

export async function replaceProductImageAction(productId: string, formData: FormData) {
  const user = await requirePermission("manage_catalog");
  const image = files(formData, "image")[0];
  if (!image) redirect(`/products/${productId}/edit?notice=product-image-required`);
  await saveProductImages({ productId, files: [image], altText: readFormText(formData, "imageAltText") }, user);
  revalidateProduct(productId);
}
