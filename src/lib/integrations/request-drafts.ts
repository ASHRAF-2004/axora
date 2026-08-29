import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "../auth";
import { isDemoMode } from "../db";
import { canAccess } from "../permissions";
import { usesCompanyAdministratorDirectPurchase } from "../company-admin-direct-purchase";
import {
  canManageCompanyIntegrations,
  currentPermissionAllows,
} from "./authorization";
import { withIntegrationTransaction } from "./database";

export class IntegrationDraftReviewError extends Error {
  constructor(public readonly reason:
    | "DENIED"
    | "NOT_FOUND"
    | "EXPIRED"
    | "ALREADY_REVIEWED"
    | "CART_NOT_EMPTY"
    | "DIRECT_PURCHASE_UNSAFE"
    | "UNAVAILABLE") {
    super("The integration request draft is unavailable.");
    this.name = "IntegrationDraftReviewError";
  }
}

interface DraftRow extends QueryResultRow {
  id: string;
  draftCode: string;
  companyId: string;
  companyName: string;
  branchId: string;
  branchName: string;
  applicationName?: string;
  requestType: "Standard";
  department: string;
  neededByDate: string;
  urgency: "Low" | "Normal" | "High" | "Urgent";
  notes?: string;
  status: "PENDING_REVIEW" | "IN_REVIEW" | "CONSUMED" | "CANCELLED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewSubmissionKey?: string;
  reviewCartId?: string;
  reviewCartVersion?: number;
  submittedRequestId?: string;
}

interface DraftItemRow extends QueryResultRow {
  id: string;
  productReference: string;
  productName: string;
  unit: string;
  quantity: number;
  specification?: string;
}

export interface IntegrationRequestDraftReview {
  id: string;
  draftCode: string;
  companyId: string;
  companyName: string;
  branchId: string;
  branchName: string;
  applicationName?: string;
  requestType: "Standard";
  departmentReference: string;
  neededByDate: string;
  urgency: "Low" | "Normal" | "High" | "Urgent";
  notes?: string;
  status: DraftRow["status"];
  createdAt: string;
  expiresAt: string;
  reviewedByName?: string;
  reviewedAt?: string;
  submittedRequestId?: string;
  canImport: boolean;
  canContinue: boolean;
  items: Array<{
    id: string;
    productReference: string;
    productName: string;
    unit: string;
    quantity: number;
    specification?: string;
  }>;
}

const draftSelect = `
  SELECT draft.id::text,draft.draft_code AS "draftCode",
    draft.company_id::text AS "companyId",company.name AS "companyName",
    draft.branch_id::text AS "branchId",branch.name AS "branchName",
    application.name AS "applicationName",draft.request_type AS "requestType",
    draft.department,draft.needed_by_date::text AS "neededByDate",draft.urgency,
    draft.notes,draft.status,draft.created_at::text AS "createdAt",
    draft.expires_at::text AS "expiresAt",draft.reviewed_by::text AS "reviewedBy",
    COALESCE(profile.display_name,reviewer.display_name) AS "reviewedByName",
    draft.reviewed_at::text AS "reviewedAt",
    draft.review_submission_key::text AS "reviewSubmissionKey",
    draft.review_cart_id::text AS "reviewCartId",
    draft.review_cart_version::int AS "reviewCartVersion",
    draft.submitted_request_id::text AS "submittedRequestId"
  FROM public.integration_request_drafts draft
  JOIN public.companies company ON company.id=draft.company_id
  JOIN public.branches branch ON branch.id=draft.branch_id
  LEFT JOIN public.integration_applications application
    ON application.id=draft.application_id
  LEFT JOIN public.users reviewer ON reviewer.id=draft.reviewed_by
  LEFT JOIN public.user_profiles profile ON profile.user_id=reviewer.id`;

function actorCompany(actor: AuthenticatedSessionUser) {
  if (actor.accountKind !== "COMPANY" || actor.scopeType === "PLATFORM"
    || !actor.companyId || !actor.roleAssignmentId) {
    throw new IntegrationDraftReviewError("DENIED");
  }
  return actor.companyId;
}

async function draftPermission(
  actor: AuthenticatedSessionUser,
  draft: Pick<DraftRow, "companyId" | "branchId">,
) {
  if (actor.companyId !== draft.companyId) return false;
  if (await canManageCompanyIntegrations(actor, draft.companyId)) return true;
  return canAccess(actor, "create_requests") && currentPermissionAllows(
    actor,
    "request.create",
    { type: "BRANCH", companyId: draft.companyId, branchId: draft.branchId },
  );
}

async function reconcileSubmittedDraft(
  actor: AuthenticatedSessionUser,
  draft: DraftRow,
) {
  if (draft.status !== "IN_REVIEW" || !draft.reviewSubmissionKey
    || !draft.reviewedBy) return draft;
  return withIntegrationTransaction({
    systemIdentity: "integration-management",
    reason: "Reconciled integration request draft review",
    actor,
  }, async (client) => {
    const request = await client.query<{ id: string }>(`
      SELECT id::text FROM public.requests
      WHERE created_by=$1 AND client_submission_key=$2 AND company_id=$3
      LIMIT 1
    `, [draft.reviewedBy,draft.reviewSubmissionKey,draft.companyId]);
    const requestId = request.rows[0]?.id;
    if (!requestId) return draft;
    const result = await client.query<DraftRow>(`
      UPDATE public.integration_request_drafts
      SET status='CONSUMED',submitted_request_id=$2,consumed_at=now(),updated_at=now()
      WHERE id=$1 AND status='IN_REVIEW'
      RETURNING id::text,draft_code AS "draftCode",company_id::text AS "companyId",
        branch_id::text AS "branchId",request_type AS "requestType",department,
        needed_by_date::text AS "neededByDate",urgency,notes,status,
        created_at::text AS "createdAt",expires_at::text AS "expiresAt",
        reviewed_by::text AS "reviewedBy",reviewed_at::text AS "reviewedAt",
        review_submission_key::text AS "reviewSubmissionKey",
        review_cart_id::text AS "reviewCartId",
        review_cart_version::int AS "reviewCartVersion",
        submitted_request_id::text AS "submittedRequestId"
    `, [draft.id,requestId]);
    return result.rows[0]
      ? { ...draft, ...result.rows[0], companyName: draft.companyName,
        branchName: draft.branchName, applicationName: draft.applicationName,
        reviewedByName: draft.reviewedByName }
      : draft;
  });
}

export async function getIntegrationRequestDraftReview(
  actor: AuthenticatedSessionUser,
  draftId: string,
): Promise<IntegrationRequestDraftReview> {
  const companyId = actorCompany(actor);
  if (!z.uuid().safeParse(draftId).success || isDemoMode()) {
    throw new IntegrationDraftReviewError("NOT_FOUND");
  }
  let draft = await withIntegrationTransaction({
    systemIdentity: "integration-management",
    reason: "Viewed integration request draft",
    actor,
  }, async (client) => {
    const result = await client.query<DraftRow>(`
      ${draftSelect} WHERE draft.id=$1 AND draft.company_id=$2
    `, [draftId,companyId]);
    return result.rows[0];
  });
  if (!draft || !await draftPermission(actor,draft)) {
    throw new IntegrationDraftReviewError("NOT_FOUND");
  }
  draft = await reconcileSubmittedDraft(actor,draft);
  const canCreate = canAccess(actor,"create_requests")
    && await currentPermissionAllows(actor,"request.create",{
      type: "BRANCH",companyId:draft.companyId,branchId:draft.branchId,
    });
  const items = await withIntegrationTransaction({
    systemIdentity: "integration-management",
    reason: "Viewed integration request draft lines",
    actor,
  }, async (client) => (await client.query<DraftItemRow>(`
    SELECT id::text,public_product_reference AS "productReference",
      product_name_snapshot AS "productName",unit_of_measure_snapshot AS unit,
      quantity::int,specification
    FROM public.integration_request_draft_items
    WHERE draft_id=$1 ORDER BY sort_order,id
  `,[draft.id])).rows);
  return {
    id:draft.id,draftCode:draft.draftCode,companyId:draft.companyId,
    companyName:draft.companyName,branchId:draft.branchId,branchName:draft.branchName,
    applicationName:draft.applicationName,requestType:draft.requestType,
    departmentReference:draft.department,neededByDate:draft.neededByDate,
    urgency:draft.urgency,notes:draft.notes,status:draft.status,
    createdAt:draft.createdAt,expiresAt:draft.expiresAt,
    reviewedByName:draft.reviewedByName,reviewedAt:draft.reviewedAt,
    submittedRequestId:draft.submittedRequestId,
    canImport: canCreate && !usesCompanyAdministratorDirectPurchase(actor)
      && draft.status === "PENDING_REVIEW" && Date.parse(draft.expiresAt)>Date.now(),
    canContinue: canCreate && draft.status === "IN_REVIEW" && draft.reviewedBy===actor.id,
    items,
  };
}

interface CartSnapshotRow extends QueryResultRow {
  value: {
    id: string;
    companyId: string;
    branchId: string;
    version: number;
    items: unknown[];
  } | null;
}

export type IntegrationDraftImportResult =
  | { status: "READY"; draftId: string; branchId: string }
  | { status: "SUBMITTED"; requestId: string };

export async function importIntegrationRequestDraft(
  actor: AuthenticatedSessionUser,
  draftId: string,
): Promise<IntegrationDraftImportResult> {
  const companyId = actorCompany(actor);
  if (!z.uuid().safeParse(draftId).success || isDemoMode()) {
    throw new IntegrationDraftReviewError("NOT_FOUND");
  }
  if (!canAccess(actor,"create_requests")) {
    throw new IntegrationDraftReviewError("DENIED");
  }
  if (usesCompanyAdministratorDirectPurchase(actor)) {
    throw new IntegrationDraftReviewError("DIRECT_PURCHASE_UNSAFE");
  }
  try {
    return await withIntegrationTransaction({
      systemIdentity: "integration-management",
      reason: "Imported integration request draft for authorized Axora review",
      actor,
    }, async (client) => {
      const selected = await client.query<DraftRow>(`
        ${draftSelect} WHERE draft.id=$1 AND draft.company_id=$2 FOR UPDATE OF draft
      `,[draftId,companyId]);
      const draft = selected.rows[0];
      if (!draft) throw new IntegrationDraftReviewError("NOT_FOUND");
      if (draft.status === "CONSUMED" && draft.submittedRequestId) {
        return { status:"SUBMITTED",requestId:draft.submittedRequestId };
      }
      if (draft.status === "IN_REVIEW") {
        if (draft.reviewedBy !== actor.id) {
          throw new IntegrationDraftReviewError("ALREADY_REVIEWED");
        }
        return { status:"READY",draftId:draft.id,branchId:draft.branchId };
      }
      if (draft.status !== "PENDING_REVIEW") {
        throw new IntegrationDraftReviewError("ALREADY_REVIEWED");
      }
      if (Date.parse(draft.expiresAt)<=Date.now()) {
        throw new IntegrationDraftReviewError("EXPIRED");
      }
      if (!actor.roleAssignmentId) throw new IntegrationDraftReviewError("DENIED");
      // The canonical cart command performs the live role, branch, tenant and
      // explicit-DENY check in this same transaction. Avoid a second database
      // connection while this draft row is locked.
      let cart = (await client.query<CartSnapshotRow>(`
        SELECT public.axora_procurement_cart_command(
          $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
        ) AS value
      `,[actor.id,actor.roleAssignmentId,draft.branchId,randomUUID()])).rows[0]?.value;
      if (!cart || cart.companyId!==companyId || cart.branchId!==draft.branchId) {
        throw new IntegrationDraftReviewError("UNAVAILABLE");
      }
      if (cart.items.length) throw new IntegrationDraftReviewError("CART_NOT_EMPTY");
      const items = await client.query<DraftItemRow>(`
        SELECT id::text,public_product_reference AS "productReference",
          product_name_snapshot AS "productName",unit_of_measure_snapshot AS unit,
          quantity::int,specification
        FROM public.integration_request_draft_items
        WHERE draft_id=$1 ORDER BY sort_order,id FOR KEY SHARE
      `,[draft.id]);
      if (!items.rows.length) throw new IntegrationDraftReviewError("UNAVAILABLE");
      for (const item of items.rows) {
        cart = (await client.query<CartSnapshotRow>(`
          SELECT public.axora_procurement_cart_command(
            $1,$2,$3,'SET',$4,$5,$6,$7,$8,now()
          ) AS value
        `,[actor.id,actor.roleAssignmentId,draft.branchId,item.productReference,
          item.quantity,item.specification ?? "",cart.version,randomUUID()])).rows[0]?.value;
        if (!cart) throw new IntegrationDraftReviewError("UNAVAILABLE");
      }
      const submissionKey = randomUUID();
      const updated = await client.query<{ id: string }>(`
        UPDATE public.integration_request_drafts SET
          status='IN_REVIEW',reviewed_by=$2,reviewed_at=now(),
          review_submission_key=$3,review_cart_id=$4,review_cart_version=$5,
          updated_at=now()
        WHERE id=$1 AND status='PENDING_REVIEW' RETURNING id::text
      `,[draft.id,actor.id,submissionKey,cart.id,cart.version]);
      if (!updated.rows[0]) throw new IntegrationDraftReviewError("ALREADY_REVIEWED");
      return { status:"READY",draftId:draft.id,branchId:draft.branchId };
    });
  } catch (error) {
    if (error instanceof IntegrationDraftReviewError) throw error;
    throw new IntegrationDraftReviewError("UNAVAILABLE");
  }
}

export async function integrationRequestDraftInitialValues(
  actor: AuthenticatedSessionUser,
  draftId: string,
) {
  const review = await getIntegrationRequestDraftReview(actor,draftId);
  if (!review.canContinue) throw new IntegrationDraftReviewError("NOT_FOUND");
  const submission = await withIntegrationTransaction({
    systemIdentity:"integration-management",
    reason:"Loaded integration request draft review values",
    actor,
  }, async (client) => (await client.query<{ submissionKey: string }>(`
    SELECT review_submission_key::text AS "submissionKey"
    FROM public.integration_request_drafts
    WHERE id=$1 AND status='IN_REVIEW' AND reviewed_by=$2
  `,[review.id,actor.id])).rows[0]);
  if (!submission) throw new IntegrationDraftReviewError("NOT_FOUND");
  return {
    draftId:review.id,branchId:review.branchId,neededByDate:review.neededByDate,
    requestType:review.requestType,urgency:review.urgency,notes:review.notes ?? "",
    submissionKey:submission.submissionKey,
  };
}

export async function markIntegrationRequestDraftSubmitted(
  actor: AuthenticatedSessionUser,
  input: { draftId: string; submissionKey: string; requestId: string },
) {
  if (isDemoMode() || !z.uuid().safeParse(input.draftId).success
    || !z.uuid().safeParse(input.submissionKey).success
    || !z.uuid().safeParse(input.requestId).success) return false;
  try {
    return await withIntegrationTransaction({
      systemIdentity:"integration-management",
      reason:"Marked reviewed integration request draft submitted",
      actor,
    }, async (client) => {
      const result = await client.query<{ id: string }>(`
        UPDATE public.integration_request_drafts draft
        SET status='CONSUMED',submitted_request_id=$4,consumed_at=now(),updated_at=now()
        WHERE draft.id=$1 AND draft.company_id=$2 AND draft.reviewed_by=$3
          AND draft.review_submission_key=$5 AND draft.status='IN_REVIEW'
          AND EXISTS (
            SELECT 1 FROM public.requests request
            WHERE request.id=$4 AND request.company_id=draft.company_id
              AND request.created_by=$3 AND request.client_submission_key=$5
          ) RETURNING draft.id::text
      `,[input.draftId,actor.companyId,actor.id,input.requestId,input.submissionKey]);
      return Boolean(result.rows[0]);
    });
  } catch {
    return false;
  }
}
