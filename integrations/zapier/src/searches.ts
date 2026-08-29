import {
  defineInputFields,
  defineSearch,
  type SearchPerform,
} from "zapier-platform-core";

import { findAxoraRecord } from "./http.js";

const inputFields = defineInputFields([
  {
    key: "id",
    label: "Axora Record ID",
    type: "string",
    required: true,
    helpText: "The UUID shown by Axora or returned by an earlier Axora step.",
  },
]);

interface SearchDefinition {
  key: string;
  noun: "Company" | "Request" | "Delivery" | "Invoice";
  label: string;
  description: string;
  collection: "companies" | "requests" | "deliveries" | "invoices";
  sample: Record<string, unknown> & { id: string };
}

function buildSearch(definition: SearchDefinition) {
  const perform = ((z, bundle) => findAxoraRecord(
    z,
    bundle,
    definition.collection,
  )) satisfies SearchPerform<typeof inputFields>;
  return defineSearch({
    key: definition.key,
    noun: definition.noun,
    display: {
      label: definition.label,
      description: definition.description,
    },
    operation: {
      inputFields,
      perform,
      sample: definition.sample,
    },
  });
}

export const findCompany = buildSearch({
  key: "find_company",
  noun: "Company",
  label: "Find Company",
  description: "Finds the connected Axora company by ID.",
  collection: "companies",
  sample: {
    id: "00000000-0000-4000-8000-000000000001",
    code: "CO-FICTIONAL",
    name: "Fictional Procurement Company",
    status: "active",
    resource_url: "/api/v1/companies/00000000-0000-4000-8000-000000000001",
  },
});

export const findRequest = buildSearch({
  key: "find_request",
  noun: "Request",
  label: "Find Request",
  description: "Finds an Axora request in the connected user's current scope.",
  collection: "requests",
  sample: {
    id: "00000000-0000-4000-8000-000000000101",
    order_code: "ORD-FICTIONAL-1001",
    company_id: "00000000-0000-4000-8000-000000000001",
    branch_id: "00000000-0000-4000-8000-000000000011",
    status: "Submitted",
    currency: "MYR",
    estimated_total: 1250,
    resource_url: "/api/v1/requests/00000000-0000-4000-8000-000000000101",
  },
});

export const findDelivery = buildSearch({
  key: "find_delivery",
  noun: "Delivery",
  label: "Find Delivery",
  description: "Finds a safe Axora delivery record in the current scope.",
  collection: "deliveries",
  sample: {
    id: "00000000-0000-4000-8000-000000000301",
    job_code: "DEL-FICTIONAL-1001",
    company_id: "00000000-0000-4000-8000-000000000001",
    status: "Out for delivery",
    resource_url: "/api/v1/deliveries/00000000-0000-4000-8000-000000000301",
  },
});

export const findInvoice = buildSearch({
  key: "find_invoice",
  noun: "Invoice",
  label: "Find Invoice",
  description: "Finds a customer-safe Axora invoice in the current scope.",
  collection: "invoices",
  sample: {
    id: "00000000-0000-4000-8000-000000000201",
    invoice_number: "INV-FICTIONAL-1001",
    company_id: "00000000-0000-4000-8000-000000000001",
    currency: "MYR",
    amount: 780,
    resource_url: "/api/v1/invoices/00000000-0000-4000-8000-000000000201",
  },
});

export const searches = [
  findCompany,
  findRequest,
  findDelivery,
  findInvoice,
] as const;
