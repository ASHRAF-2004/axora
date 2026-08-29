import {
  defineCreate,
  defineInputFields,
  type CreatePerform,
} from "zapier-platform-core";

import { AXORA_API_BASE, AXORA_ORIGIN } from "./constants.js";
import {
  absoluteAxoraUrl,
  stableIdempotencyKey,
  type AxoraEnvelope,
} from "./http.js";

const inputFields = defineInputFields([
  {
    key: "idempotency_key",
    label: "Unique Request Key",
    type: "string",
    required: true,
    helpText: "Map a stable unique value from the source record. Retries must reuse it; a different payload with the same key is rejected.",
  },
  {
    key: "branch_id",
    label: "Axora Branch ID",
    type: "string",
    required: true,
  },
  {
    key: "needed_by_date",
    label: "Needed By Date",
    type: "string",
    required: true,
    helpText: "Use YYYY-MM-DD. The date must be within Axora's allowed review window.",
  },
  {
    key: "urgency",
    label: "Urgency",
    type: "string",
    required: true,
    choices: ["Low", "Normal", "High", "Urgent"],
  },
  {
    key: "department",
    label: "Department Reference",
    type: "string",
    required: false,
    helpText: "Axora resolves the authoritative department during review.",
  },
  {
    key: "notes",
    label: "Review Notes",
    type: "text",
    required: false,
  },
  {
    key: "items",
    label: "Draft Items",
    required: true,
    children: [
      {
        key: "product_reference",
        label: "Axora Product Reference",
        type: "string",
        required: true,
      },
      {
        key: "quantity",
        label: "Quantity",
        type: "integer",
        required: true,
      },
      {
        key: "specification",
        label: "Specification",
        type: "text",
        required: false,
      },
    ],
  },
]);

interface DraftItem {
  product_reference?: unknown;
  quantity?: unknown;
  specification?: unknown;
}

function draftItems(z: Parameters<CreatePerform<typeof inputFields>>[0], value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new z.errors.Error(
      "Add between 1 and 100 draft items.",
      "InvalidAxoraDraftItems",
      400,
    );
  }
  return value.map((entry) => {
    const item = entry as DraftItem;
    const productReference = typeof item.product_reference === "string"
      ? item.product_reference.trim()
      : "";
    const quantity = Number(item.quantity);
    if (
      !/^item-[a-f0-9]{20}$/.test(productReference)
      || !Number.isInteger(quantity)
      || quantity < 1
      || quantity > 1_000_000
    ) {
      throw new z.errors.Error(
        "Each draft item needs a valid Axora product reference and whole-number quantity.",
        "InvalidAxoraDraftItem",
        400,
      );
    }
    return {
      product_reference: productReference,
      quantity,
      ...(typeof item.specification === "string" && item.specification.trim()
        ? { specification: item.specification.trim() }
        : {}),
    };
  });
}

const perform = (async (z, bundle) => {
  const idempotencyInput = String(bundle.inputData.idempotency_key ?? "").trim();
  if (idempotencyInput.length < 1 || idempotencyInput.length > 512) {
    throw new z.errors.Error(
      "Unique Request Key must contain between 1 and 512 characters.",
      "InvalidAxoraIdempotencyKey",
      400,
    );
  }
  const response = await z.request<AxoraEnvelope<Record<string, unknown>>>({
    url: `${AXORA_API_BASE}/request-drafts`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": stableIdempotencyKey(
        z,
        "draft-create",
        idempotencyInput,
      ),
    },
    body: {
      branch_id: String(bundle.inputData.branch_id).trim(),
      request_type: "Standard",
      needed_by_date: String(bundle.inputData.needed_by_date).trim(),
      urgency: bundle.inputData.urgency,
      ...(bundle.inputData.department
        ? { department: String(bundle.inputData.department).trim() }
        : {}),
      ...(bundle.inputData.notes
        ? { notes: String(bundle.inputData.notes).trim() }
        : {}),
      items: draftItems(z, bundle.inputData.items),
    },
  });
  const draft = response.data.data;
  return {
    ...draft,
    review_url: absoluteAxoraUrl(draft.review_url),
  };
}) satisfies CreatePerform<typeof inputFields>;

export const createRequestDraft = defineCreate({
  key: "create_request_draft",
  noun: "Request Draft",
  display: {
    label: "Create Request Draft",
    description: "Creates a review-required Axora draft. It does not submit, approve, spend, pay, invoice, or create a delivery.",
  },
  operation: {
    inputFields,
    perform,
    sample: {
      id: "00000000-0000-4000-8000-000000000401",
      draft_code: "IDR-FICTIONAL1001",
      status: "pending_review",
      company_id: "00000000-0000-4000-8000-000000000001",
      branch_id: "00000000-0000-4000-8000-000000000011",
      created_at: "2026-01-15T02:30:00.000Z",
      expires_at: "2026-02-14T02:30:00.000Z",
      review_url: `${AXORA_ORIGIN}/integrations/drafts/00000000-0000-4000-8000-000000000401`,
    },
    outputFields: [
      { key: "id", label: "Draft ID" },
      { key: "draft_code", label: "Draft Code" },
      { key: "status", label: "Status" },
      { key: "company_id", label: "Company ID" },
      { key: "branch_id", label: "Branch ID" },
      { key: "created_at", label: "Created At", type: "datetime" },
      { key: "expires_at", label: "Expires At", type: "datetime" },
      { key: "review_url", label: "Review in Axora" },
    ],
  },
});

export const creates = [createRequestDraft] as const;
