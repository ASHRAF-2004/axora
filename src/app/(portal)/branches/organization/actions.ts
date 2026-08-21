"use server";

import { requirePermission } from "@/lib/auth";
import {
  ORGANIZATION_NODE_TYPES,
  saveOrganizationNode,
  setOrganizationNodeActive,
} from "@/lib/organization-structure";
import { readFormText } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const timezone = z.string().trim().max(120).refine(
  (value) => !value || value === "UTC" || /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(value),
);
const editableNodeTypes = [
  "BRANCH", "DEPARTMENT", "BUSINESS_UNIT", "COST_CENTRE",
] as const;
const nodeSchema = z.object({
  nodeType: z.enum(editableNodeTypes),
  nodeId: z.uuid().optional(),
  companyId: z.uuid(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/),
  name: z.string().trim().min(2).max(200),
  branchId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  businessUnitId: z.uuid().optional(),
  description: z.string().trim().max(1000).optional(),
  managerUserId: z.uuid().optional(),
  timezone,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  address: z.string().trim().max(5000).optional(),
  city: z.string().trim().max(300).optional(),
  stateRegion: z.string().trim().max(300).optional(),
  postalCode: z.string().trim().max(40).optional(),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  contactName: z.string().trim().max(300).optional(),
  contactPhone: z.string().trim().max(120).optional(),
  contactEmail: z.union([z.email().max(320), z.literal("")]).optional(),
  deliveryInstructions: z.string().trim().max(5000).optional(),
  isPrimary: z.boolean(),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((value, context) => {
  if (value.nodeType === "BRANCH" && !value.nodeId) {
    context.addIssue({ code: "custom", message: "A branch identifier is required." });
  }
});

const route = "/branches/organization";

export async function saveOrganizationNodeAction(formData: FormData) {
  const actor = await requirePermission("view_branches");
  const input = nodeSchema.parse({
    nodeType: readFormText(formData, "nodeType"),
    nodeId: readFormText(formData, "nodeId") || undefined,
    companyId: readFormText(formData, "companyId"),
    code: readFormText(formData, "code"),
    name: readFormText(formData, "name"),
    branchId: readFormText(formData, "branchId") || undefined,
    departmentId: readFormText(formData, "departmentId") || undefined,
    parentId: readFormText(formData, "parentId") || undefined,
    businessUnitId: readFormText(formData, "businessUnitId") || undefined,
    description: readFormText(formData, "description") || undefined,
    managerUserId: readFormText(formData, "managerUserId") || undefined,
    timezone: readFormText(formData, "timezone"),
    currency: readFormText(formData, "currency") || undefined,
    address: readFormText(formData, "address") || undefined,
    city: readFormText(formData, "city") || undefined,
    stateRegion: readFormText(formData, "stateRegion") || undefined,
    postalCode: readFormText(formData, "postalCode") || undefined,
    countryCode: readFormText(formData, "countryCode") || undefined,
    contactName: readFormText(formData, "contactName") || undefined,
    contactPhone: readFormText(formData, "contactPhone") || undefined,
    contactEmail: readFormText(formData, "contactEmail"),
    deliveryInstructions: readFormText(formData, "deliveryInstructions") || undefined,
    isPrimary: formData.get("isPrimary") === "true",
    reason: readFormText(formData, "reason"),
  });
  await saveOrganizationNode(actor, {
    nodeType: input.nodeType,
    nodeId: input.nodeId,
    companyId: input.companyId,
    code: input.code,
    name: input.name,
    branchId: input.branchId,
    departmentId: input.departmentId,
    parentId: input.parentId,
    businessUnitId: input.businessUnitId,
    details: {
      description: input.description,
      managerUserId: input.managerUserId,
      timezone: input.timezone,
      currency: input.currency,
      address: input.address,
      city: input.city,
      stateRegion: input.stateRegion,
      postalCode: input.postalCode,
      countryCode: input.countryCode,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      deliveryInstructions: input.deliveryInstructions,
      isPrimary: input.isPrimary,
    },
    reason: input.reason,
  });
  revalidatePath(route);
  revalidatePath("/branches");
  revalidatePath("/users");
  redirect(`${route}?notice=saved`);
}

export async function setOrganizationNodeActiveAction(formData: FormData) {
  const actor = await requirePermission("view_branches");
  const nodeType = z.enum(ORGANIZATION_NODE_TYPES).parse(readFormText(formData, "nodeType"));
  const nodeId = z.uuid().parse(readFormText(formData, "nodeId"));
  const active = z.enum(["true", "false"]).transform((value) => value === "true")
    .parse(readFormText(formData, "active"));
  const reason = z.string().trim().min(3).max(1000).parse(readFormText(formData, "reason"));
  await setOrganizationNodeActive(actor, nodeType, nodeId, active, reason);
  revalidatePath(route);
  revalidatePath("/branches");
  revalidatePath("/users");
  redirect(`${route}?notice=saved`);
}
