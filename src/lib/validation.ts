import { z } from "zod";
import { STANDARD_BILLING_TERMS } from "./types";

const required = (label: string, max = 200) => z.string().trim().min(1, `${label} is required.`).max(max);
const optional = (max = 500) => z.string().trim().max(max).optional().transform((value) => value || undefined);
const email = z.string().trim().max(254).refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email address.");
const money = z.coerce.number().finite().min(0).max(100_000_000);
const positive = z.coerce.number().finite().positive().max(100_000_000);
const wholeQuantity = z.coerce.number().finite().int().min(1).max(100_000_000);
const wholeDays = z.coerce.number().int().min(0).max(3650);

export const companySchema = z.object({
  name: required("Company display name"), legalName: required("Legal company name", 300),
  registrationNumber: required("Registration number", 160), industry: required("Industry"),
  companyInformation: required("Company information", 3000),
  websiteUrl: z.union([z.url({ protocol: /^https$/ }).max(500), z.literal("")]).transform((value) => value || undefined),
  mainContactName: required("Main contact"),
  mainContactEmail: email, mainContactPhone: required("Main contact phone", 50), billingContactName: required("Billing contact"),
  billingContactEmail: email, billingContactPhone: required("Billing contact phone", 50), billingAddress: required("Billing address", 500),
  paymentTerms: z.literal(STANDARD_BILLING_TERMS), billingCycle: required("Billing cycle", 100), notes: optional(1000),
});

export const companyLeadCreateSchema = z.object({
  name: required("Company display name", 300),
  industry: required("Industry", 300),
  companyInformation: required("Company information", 3000),
  mainContactName: required("Main contact name", 300),
  mainContactEmail: required("Main contact email", 254).pipe(z.email("Enter a valid email address.")),
  mainContactPhone: required("Main contact phone", 120),
  billingCycle: required("Billing cycle", 100),
}).strict();

export const companyPricingSchema = z.object({
  companyId: required("Company"),
  taxRate: z.coerce
    .number()
    .finite()
    .min(0, "Tax/SST rate cannot be negative.")
    .max(100, "Tax/SST rate cannot exceed 100%."),
  estimatedDeliveryFee: money,
});

export const branchSchema = z.object({
  companyId: required("Company"), name: required("Branch name"), branchCode: required("Branch code", 50), deliveryAddress: required("Delivery address", 500),
  city: required("City"), contactName: required("Contact name"), contactPhone: required("Contact phone", 50), contactEmail: email,
  deliveryInstructions: optional(1000), notes: optional(1000),
});

export const supplierSchema = z.object({
  name: required("Supplier name"), category: required("Category"), contactName: required("Contact name"), phone: required("Phone", 50),
  email, address: required("Address", 500), coverageArea: required("Coverage area"), paymentTerms: z.literal(STANDARD_BILLING_TERMS),
  leadTimeDays: wholeDays, minimumOrderQuantity: positive, mainProducts: required("Main products", 500), notes: optional(1000),
});

export const productSchema = z.object({
  name: required("Product name"), category: required("Category"), subcategory: required("Subcategory"), brand: optional(100), size: optional(100),
  unit: required("Unit", 50), packaging: optional(100), description: optional(1000), defaultBuyPrice: money, defaultSellPrice: positive,
  deliverySlaDays: wholeDays,
}).strict();

export type ProductInput = z.infer<typeof productSchema>;

export const requestSchema = z.object({
  companyId: required("Company"), branchId: required("Branch"), requestType: z.enum(["Standard", "Ad-hoc", "Recurring"]),
  department: required("Department"),
  neededByDate: z.iso.date().refine(
    (value) => value >= new Date().toISOString().slice(0, 10),
    "Choose today or a future date. Past dates are not allowed.",
  ),
  urgency: z.enum(["Low", "Normal", "High", "Urgent"]), notes: optional(1000),
  lines: z.array(z.object({ productId: required("Product"), quantity: wholeQuantity, specification: optional(500) })).min(1),
});

export function readFormText(data: FormData, key: string) {
  return String(data.get(key) ?? "").trim();
}

export function validationMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join(" ");
  return error instanceof Error ? error.message : "The submitted information is invalid.";
}
