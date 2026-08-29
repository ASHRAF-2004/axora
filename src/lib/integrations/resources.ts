import { randomBytes } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import { authorize, type PermissionCode } from "../authorization-policy";
import type { IntegrationPrincipal } from "./api-auth";
import { ExternalApiProblem } from "./api-handler";
import { hashIntegrationSecret, integrationPayloadHash } from "./crypto";
import { withIntegrationTransaction } from "./database";
import { encodeExternalCursor, type ExternalCursor } from "./pagination";

export const externalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string) {
  if (!externalUuidPattern.test(value)) {
    throw new ExternalApiProblem("invalid_request", 400, "INVALID", "id");
  }
  return value;
}

function permissionAllows(
  principal: IntegrationPrincipal,
  permissions: readonly PermissionCode[],
  scope: { type: "COMPANY" | "BRANCH" | "DEPARTMENT"; companyId: string; branchId?: string; departmentId?: string },
  ownerUserId?: string,
) {
  return permissions.some((permission) => authorize({
    subject: principal.effectiveAccess.subject,
    permission,
    resource: { scope, ...(ownerUserId ? { ownerUserId } : {}) },
  }).allowed);
}

function requireCompanyPermission(
  principal: IntegrationPrincipal,
  permissions: readonly PermissionCode[],
) {
  if (!permissionAllows(principal, permissions, {
    type: "COMPANY", companyId: principal.companyId,
  })) throw new ExternalApiProblem("forbidden", 403, "DENIED");
}

interface CompanyRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
  industry: string;
  status: string;
  defaultLocale: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

function companyDto(row: CompanyRow) {
  return {
    id: row.id,code: row.code,name: row.name,industry: row.industry,
    status: row.status.toLowerCase(),default_locale: row.defaultLocale,
    timezone: row.timezone,created_at: row.createdAt,updated_at: row.updatedAt,
    resource_url: `/api/v1/companies/${row.id}`,
  };
}

export async function listExternalCompanies(principal: IntegrationPrincipal) {
  requireCompanyPermission(principal, ["company.view", "company.view.assigned"]);
  const result = await withIntegrationTransaction({
    systemIdentity: "integration-api",reason: "Read external company profile",
    actor: principal.actor,
  }, (client) => client.query<CompanyRow>(`
    SELECT id::text,company_code AS code,name,industry,
      CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
      default_locale AS "defaultLocale",timezone,
      created_at::text AS "createdAt",updated_at::text AS "updatedAt"
    FROM public.companies WHERE id=$1
  `, [principal.companyId]));
  return result.rows.map(companyDto);
}

export async function getExternalCompany(principal: IntegrationPrincipal, id: string) {
  requireUuid(id);
  const companies = id === principal.companyId ? await listExternalCompanies(principal) : [];
  if (!companies[0]) throw new ExternalApiProblem(
    "not_found",404,"NOT_FOUND",undefined,"company",id,
  );
  return companies[0];
}

interface RequestRow extends QueryResultRow {
  id: string; orderCode: string; requestDate: string; requestType: string;
  companyId: string; branchId: string; branchName: string; department?: string;
  neededByDate: string; urgency: string; status: string; approvalState: string;
  currency: string; estimatedTotal: number; createdAt: string; updatedAt: string;
  createdById?: string;
}

function requestDto(row: RequestRow) {
  return {
    id: row.id,order_code: row.orderCode,request_date: row.requestDate,
    request_type: row.requestType,company_id: row.companyId,branch_id: row.branchId,
    branch_name: row.branchName,department: row.department,
    needed_by_date: row.neededByDate,urgency: row.urgency,status: row.status,
    approval_state: row.approvalState,currency: row.currency,
    estimated_total: Number(row.estimatedTotal),created_at: row.createdAt,
    updated_at: row.updatedAt,resource_url: `/api/v1/requests/${row.id}`,
  };
}

function requestSelect() {
  return `SELECT request.id::text,request.order_code AS "orderCode",
    request.request_date::text AS "requestDate",request_type.label AS "requestType",
    request.company_id::text AS "companyId",request.branch_id::text AS "branchId",
    branch.name AS "branchName",NULLIF(request.department,'') AS department,
    request.needed_by_date::text AS "neededByDate",urgency.label AS urgency,
    request_status.label AS status,request.approval_state AS "approvalState",
    request.currency,
    (COALESCE(lines.subtotal,0)+request.estimated_delivery_fee+request.tax_amount)::float8
      AS "estimatedTotal",
    request.created_at::text AS "createdAt",request.updated_at::text AS "updatedAt",
    request.created_by::text AS "createdById"
  FROM public.requests request
  JOIN public.axora_operation_request_access_rows($1,$2,'request.view',$3) access
    ON access.request_id=request.id AND access.resource_active
  JOIN public.branches branch ON branch.id=request.branch_id
  JOIN public.lookup_values request_type ON request_type.id=request.request_type_id
  JOIN public.lookup_values urgency ON urgency.id=request.urgency_id
  JOIN public.lookup_values request_status ON request_status.id=request.status_id
  LEFT JOIN LATERAL (
    SELECT sum(line.quantity*line.unit_sell_price) AS subtotal
    FROM public.request_lines line WHERE line.request_id=request.id
  ) lines ON true`;
}

export async function listExternalRequests(input: {
  principal: IntegrationPrincipal; limit: number; cursor?: ExternalCursor;
}) {
  requireCompanyPermission(input.principal, ["request.view", "request.view.own"]);
  const values: unknown[] = [
    input.principal.actor.id,input.principal.actor.roleAssignmentId,new Date(),
    input.principal.companyId,
  ];
  let cursorSql = "";
  if (input.cursor) {
    values.push(input.cursor.sort,input.cursor.id);
    cursorSql = `AND (request.created_at,request.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`;
  }
  values.push(input.limit + 1);
  const result = await withIntegrationTransaction({
    systemIdentity: "integration-api",reason: "Read external request list",
    actor: input.principal.actor,
  }, (client) => client.query<RequestRow>(`
    ${requestSelect()}
    WHERE request.company_id=$4 ${cursorSql}
    ORDER BY request.created_at DESC,request.id DESC LIMIT $${values.length}
  `, values));
  const hasMore = result.rows.length > input.limit;
  const rows = result.rows.slice(0, input.limit);
  const last = rows.at(-1);
  return {
    data: rows.map(requestDto),hasMore,
    nextCursor: hasMore && last ? encodeExternalCursor({
      route: "/api/v1/requests",companyId: input.principal.companyId,
      sort: last.createdAt,id: last.id,
    }) : null,
  };
}

export async function getExternalRequest(principal: IntegrationPrincipal, id: string) {
  requireUuid(id);
  requireCompanyPermission(principal, ["request.view", "request.view.own"]);
  const result = await withIntegrationTransaction({
    systemIdentity: "integration-api",reason: "Read external request",
    actor: principal.actor,
  }, async (client) => {
    const requestResult = await client.query<RequestRow>(`
      ${requestSelect()}
      WHERE request.company_id=$4 AND request.id=$5
    `, [principal.actor.id,principal.actor.roleAssignmentId,new Date(),principal.companyId,id]);
    if (!requestResult.rows[0]) return null;
    const lines = await client.query<{
      id: string; publicReference?: string; name: string; category: string;
      subcategory?: string; specification?: string; quantity: number;
      unit: string; unitPrice: number;
    }>(`
      SELECT line.id::text,product.public_reference AS "publicReference",
        line.product_name_snapshot AS name,line.category_snapshot AS category,
        line.subcategory_snapshot AS subcategory,line.specification,
        line.quantity::float8,line.unit_of_measure AS unit,
        line.unit_sell_price::float8 AS "unitPrice"
      FROM public.request_lines line
      LEFT JOIN public.products product ON product.id=line.product_id
      WHERE line.request_id=$1 ORDER BY line.request_line_code,line.id
    `, [id]);
    return { request: requestResult.rows[0], lines: lines.rows };
  });
  if (!result) throw new ExternalApiProblem(
    "not_found",404,"NOT_FOUND",undefined,"request",id,
  );
  return {
    ...requestDto(result.request),
    items: result.lines.map((line) => ({
      id: line.id,product_reference: line.publicReference,
      name: line.name,category: line.category,subcategory: line.subcategory,
      specification: line.specification,quantity: Number(line.quantity),unit: line.unit,
      unit_price: Number(line.unitPrice),
      line_total: Number((Number(line.quantity) * Number(line.unitPrice)).toFixed(2)),
    })),
  };
}

interface DeliveryRow extends QueryResultRow {
  id: string; jobCode: string; requestId: string; orderCode: string;
  companyId: string; branchId: string; branchName: string; status: string;
  scheduledWindowStart?: string; scheduledWindowEnd?: string;
  createdAt: string; updatedAt: string;
}

function deliveryDto(row: DeliveryRow) {
  return {
    id: row.id,job_code: row.jobCode,request_id: row.requestId,
    order_code: row.orderCode,company_id: row.companyId,branch_id: row.branchId,
    branch_name: row.branchName,status: row.status,
    scheduled_window_start: row.scheduledWindowStart,
    scheduled_window_end: row.scheduledWindowEnd,
    created_at: row.createdAt,updated_at: row.updatedAt,
    resource_url: `/api/v1/deliveries/${row.id}`,
  };
}

function deliverySelect() {
  return `SELECT job.id::text,job.job_code AS "jobCode",
    job.request_id::text AS "requestId",request.order_code AS "orderCode",
    job.company_id::text AS "companyId",job.branch_id::text AS "branchId",
    branch.name AS "branchName",job.status,
    job.scheduled_window_start::text AS "scheduledWindowStart",
    job.scheduled_window_end::text AS "scheduledWindowEnd",
    job.created_at::text AS "createdAt",job.updated_at::text AS "updatedAt"
  FROM public.delivery_jobs job
  JOIN public.requests request ON request.id=job.request_id
  JOIN public.axora_operation_request_access_rows($1,$2,'delivery.view',$3) access
    ON access.request_id=request.id AND access.resource_active
  JOIN public.branches branch ON branch.id=job.branch_id`;
}

export async function listExternalDeliveries(input: {
  principal: IntegrationPrincipal; limit: number; cursor?: ExternalCursor;
}) {
  requireCompanyPermission(input.principal, ["delivery.view"]);
  const values: unknown[] = [
    input.principal.actor.id,input.principal.actor.roleAssignmentId,new Date(),
    input.principal.companyId,
  ];
  let cursorSql = "";
  if (input.cursor) {
    values.push(input.cursor.sort,input.cursor.id);
    cursorSql = `AND (job.updated_at,job.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`;
  }
  values.push(input.limit + 1);
  const result = await withIntegrationTransaction({
    systemIdentity: "integration-api",reason: "Read external delivery list",
    actor: input.principal.actor,
  }, (client) => client.query<DeliveryRow>(`
    ${deliverySelect()}
    WHERE job.company_id=$4 ${cursorSql}
    ORDER BY job.updated_at DESC,job.id DESC LIMIT $${values.length}
  `, values));
  const hasMore = result.rows.length > input.limit;
  const rows = result.rows.slice(0, input.limit);
  const last = rows.at(-1);
  return {
    data: rows.map(deliveryDto),hasMore,
    nextCursor: hasMore && last ? encodeExternalCursor({
      route: "/api/v1/deliveries",companyId: input.principal.companyId,
      sort: last.updatedAt,id: last.id,
    }) : null,
  };
}

export async function getExternalDelivery(principal: IntegrationPrincipal, id: string) {
  requireUuid(id);
  requireCompanyPermission(principal, ["delivery.view"]);
  const result = await withIntegrationTransaction({
    systemIdentity: "integration-api",reason: "Read external delivery",
    actor: principal.actor,
  }, (client) => client.query<DeliveryRow>(`
    ${deliverySelect()} WHERE job.company_id=$4 AND job.id=$5
  `, [principal.actor.id,principal.actor.roleAssignmentId,new Date(),principal.companyId,id]));
  if (!result.rows[0]) throw new ExternalApiProblem(
    "not_found",404,"NOT_FOUND",undefined,"delivery",id,
  );
  return deliveryDto(result.rows[0]);
}

interface InvoiceRow extends QueryResultRow {
  id: string; invoiceNumber: string; requestId: string; orderCode: string;
  companyId: string; invoiceDate: string; dueDate?: string; amount: number;
  currency: string; status: string; lifecycleStatus: string; finalizedAt?: string;
  paidAmount: number; outstandingAmount: number; paymentStatus: string;
  createdAt: string; updatedAt: string;
}

function invoiceDto(row: InvoiceRow) {
  return {
    id: row.id,invoice_number: row.invoiceNumber,request_id: row.requestId,
    order_code: row.orderCode,company_id: row.companyId,
    invoice_date: row.invoiceDate,due_date: row.dueDate,amount: Number(row.amount),
    currency: row.currency,status: row.status,lifecycle_status: row.lifecycleStatus,
    finalized_at: row.finalizedAt,paid_amount: Number(row.paidAmount),
    outstanding_amount: Number(row.outstandingAmount),payment_status: row.paymentStatus,
    created_at: row.createdAt,updated_at: row.updatedAt,
    resource_url: `/api/v1/invoices/${row.id}`,
  };
}

function invoiceSelect() {
  return `SELECT balance.id::text,balance.invoice_number AS "invoiceNumber",
    balance.request_id::text AS "requestId",request.order_code AS "orderCode",
    balance.company_id::text AS "companyId",balance.invoice_date::text AS "invoiceDate",
    balance.due_date::text AS "dueDate",balance.amount::float8,invoice.currency,
    invoice_status.label AS status,invoice.lifecycle_status AS "lifecycleStatus",
    invoice.finalized_at::text AS "finalizedAt",balance.paid_amount::float8 AS "paidAmount",
    balance.outstanding_amount::float8 AS "outstandingAmount",
    balance.payment_status AS "paymentStatus",balance.created_at::text AS "createdAt",
    balance.updated_at::text AS "updatedAt"
  FROM public.v_invoice_balances balance
  JOIN public.invoices invoice ON invoice.id=balance.id
  JOIN public.requests request ON request.id=balance.request_id
  JOIN public.axora_operation_request_access_rows($1,$2,'finance.invoice.view',$3) access
    ON access.request_id=request.id AND access.resource_active
  JOIN public.lookup_values invoice_status ON invoice_status.id=balance.status_id`;
}

export async function listExternalInvoices(input: {
  principal: IntegrationPrincipal; limit: number; cursor?: ExternalCursor;
}) {
  requireCompanyPermission(input.principal, ["finance.invoice.view"]);
  const values: unknown[] = [
    input.principal.actor.id,input.principal.actor.roleAssignmentId,new Date(),
    input.principal.companyId,
  ];
  let cursorSql = "";
  if (input.cursor) {
    values.push(input.cursor.sort,input.cursor.id);
    cursorSql = `AND (balance.invoice_date,balance.id)<($${values.length - 1}::date,$${values.length}::uuid)`;
  }
  values.push(input.limit + 1);
  const result = await withIntegrationTransaction({
    systemIdentity: "integration-api",reason: "Read external customer invoice list",
    actor: input.principal.actor,
  }, (client) => client.query<InvoiceRow>(`
    ${invoiceSelect()}
    WHERE balance.company_id=$4 AND balance.direction='CUSTOMER' ${cursorSql}
    ORDER BY balance.invoice_date DESC,balance.id DESC LIMIT $${values.length}
  `, values));
  const hasMore = result.rows.length > input.limit;
  const rows = result.rows.slice(0, input.limit);
  const last = rows.at(-1);
  return {
    data: rows.map(invoiceDto),hasMore,
    nextCursor: hasMore && last ? encodeExternalCursor({
      route: "/api/v1/invoices",companyId: input.principal.companyId,
      sort: last.invoiceDate,id: last.id,
    }) : null,
  };
}

export async function getExternalInvoice(principal: IntegrationPrincipal, id: string) {
  requireUuid(id);
  requireCompanyPermission(principal, ["finance.invoice.view"]);
  const result = await withIntegrationTransaction({
    systemIdentity: "integration-api",reason: "Read external customer invoice",
    actor: principal.actor,
  }, (client) => client.query<InvoiceRow>(`
    ${invoiceSelect()}
    WHERE balance.company_id=$4 AND balance.direction='CUSTOMER' AND balance.id=$5
  `, [principal.actor.id,principal.actor.roleAssignmentId,new Date(),principal.companyId,id]));
  if (!result.rows[0]) throw new ExternalApiProblem(
    "not_found",404,"NOT_FOUND",undefined,"invoice",id,
  );
  return invoiceDto(result.rows[0]);
}

const externalDraftSchema = z.object({
  branch_id: z.string().uuid(),
  request_type: z.literal("Standard").optional().default("Standard"),
  department: z.string().trim().min(2).max(160).optional(),
  needed_by_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  urgency: z.enum(["Low","Normal","High","Urgent"]),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(z.object({
    product_reference: z.string().regex(/^item-[a-f0-9]{20}$/),
    quantity: z.number().int().positive().max(1_000_000),
    specification: z.string().trim().max(1000).optional(),
  }).strict()).min(1).max(100),
}).strict();

export type ExternalDraftInput = z.infer<typeof externalDraftSchema>;

export function parseExternalDraft(value: unknown) {
  const parsed = externalDraftSchema.safeParse(value);
  if (!parsed.success) throw new ExternalApiProblem(
    "invalid_request",400,"INVALID","body","request_draft",
  );
  const references = parsed.data.items.map((item) => item.product_reference);
  if (new Set(references).size !== references.length) throw new ExternalApiProblem(
    "invalid_request",400,"INVALID","items","request_draft",
  );
  return parsed.data;
}

export async function createExternalRequestDraft(input: {
  principal: IntegrationPrincipal;
  payload: ExternalDraftInput;
  idempotencyKey: string;
  requestId: string;
  networkHash: string;
}) {
  const { principal, payload } = input;
  if (!permissionAllows(principal, ["request.create"], {
    type: "BRANCH",companyId: principal.companyId,branchId: payload.branch_id,
  })) throw new ExternalApiProblem("forbidden",403,"DENIED",undefined,"request_draft");
  if (!/^[A-Za-z0-9._~:-]{8,128}$/.test(input.idempotencyKey)) {
    throw new ExternalApiProblem("invalid_request",400,"INVALID","Idempotency-Key","request_draft");
  }
  const payloadHash = integrationPayloadHash(payload);
  const idempotencyHash = hashIntegrationSecret(
    "idempotency-key",
    `${principal.connectionId}\0${input.idempotencyKey}`,
  );
  return withIntegrationTransaction({
    systemIdentity: "integration-api",reason: "Create review-required external request draft",
    actor: principal.actor,correlationId: input.requestId,
  }, async (client) => {
    await client.query(`
      INSERT INTO public.integration_api_idempotency(
        connection_id,company_id,grant_id,command,idempotency_key_hash,
        payload_hash,expires_at
      ) VALUES ($1,$2,$3,'request_draft.create',$4,$5,now()+interval '24 hours')
      ON CONFLICT(connection_id,command,idempotency_key_hash) DO NOTHING
    `, [principal.connectionId,principal.companyId,principal.grantId,idempotencyHash,payloadHash]);
    const idempotency = await client.query<{
      id: string; payloadHash: string; status: string; responseBody?: Record<string, unknown>;
    }>(`
      SELECT id::text,payload_hash AS "payloadHash",status,
        response_body AS "responseBody"
      FROM public.integration_api_idempotency
      WHERE connection_id=$1 AND command='request_draft.create'
        AND idempotency_key_hash=$2
      FOR UPDATE
    `, [principal.connectionId,idempotencyHash]);
    const replay = idempotency.rows[0];
    if (!replay) throw new Error("Idempotency state is unavailable.");
    if (replay.payloadHash !== payloadHash) throw new ExternalApiProblem(
      "conflict",409,"INVALID","Idempotency-Key","request_draft",
    );
    if (replay.status === "COMPLETED" && replay.responseBody) {
      return { data: replay.responseBody, replayed: true };
    }
    const branch = await client.query<{ id: string; today: string }>(`
      SELECT branch.id::text,(now() AT TIME ZONE company.timezone)::date::text AS today
      FROM public.branches branch
      JOIN public.companies company ON company.id=branch.company_id
      WHERE branch.id=$1 AND branch.company_id=$2 AND branch.active AND company.active
      FOR KEY SHARE OF branch,company
    `, [payload.branch_id,principal.companyId]);
    if (!branch.rows[0]) throw new ExternalApiProblem(
      "not_found",404,"NOT_FOUND","branch_id","request_draft",
    );
    const today = branch.rows[0].today;
    const maximumDate = new Date(`${today}T00:00:00Z`);
    maximumDate.setUTCDate(maximumDate.getUTCDate() + 365);
    if (payload.needed_by_date < today
      || payload.needed_by_date > maximumDate.toISOString().slice(0,10)) {
      throw new ExternalApiProblem(
        "invalid_request",400,"INVALID","needed_by_date","request_draft",
      );
    }
    const references = payload.items.map((item) => item.product_reference);
    const products = await client.query<{
      id: string; publicReference: string; name: string; unit: string;
    }>(`
      SELECT id::text,public_reference AS "publicReference",name,
        unit_of_measure AS unit
      FROM public.products
      WHERE public_reference=ANY($1::text[]) AND active
        AND (company_id IS NULL OR company_id=$2)
      FOR KEY SHARE
    `, [references,principal.companyId]);
    const byReference = new Map(products.rows.map((product) => [product.publicReference,product]));
    if (byReference.size !== references.length) throw new ExternalApiProblem(
      "not_found",404,"NOT_FOUND","items","request_draft",
    );
    const draftCode = `IDR-${randomBytes(8).toString("hex").toUpperCase()}`;
    const draftResult = await client.query<{ id: string; createdAt: string; expiresAt: string }>(`
      INSERT INTO public.integration_request_drafts(
        draft_code,company_id,branch_id,application_id,connection_id,grant_id,
        created_by_user_id,request_type,department,needed_by_date,urgency,notes,
        expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '30 days')
      RETURNING id::text,created_at::text AS "createdAt",expires_at::text AS "expiresAt"
    `, [
      draftCode,principal.companyId,payload.branch_id,principal.applicationId,
      principal.connectionId,principal.grantId,principal.actor.id,payload.request_type,
      payload.department ?? "Resolved during Axora review",
      payload.needed_by_date,payload.urgency,payload.notes ?? null,
    ]);
    const draft = draftResult.rows[0]!;
    for (const [sortOrder,item] of payload.items.entries()) {
      const product = byReference.get(item.product_reference)!;
      await client.query(`
        INSERT INTO public.integration_request_draft_items(
          draft_id,product_id,public_product_reference,product_name_snapshot,
          unit_of_measure_snapshot,quantity,specification,sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [
        draft.id,product.id,product.publicReference,product.name,product.unit,
        item.quantity,item.specification ?? null,sortOrder,
      ]);
    }
    const response = {
      id: draft.id,draft_code: draftCode,status: "pending_review",
      company_id: principal.companyId,branch_id: payload.branch_id,
      created_at: draft.createdAt,expires_at: draft.expiresAt,
      review_url: `/integrations/drafts/${draft.id}`,
    };
    await client.query(`
      UPDATE public.integration_api_idempotency
      SET status='COMPLETED',response_status=201,response_body=$2::jsonb,
        resource_type='request_draft',resource_id=$3,completed_at=now()
      WHERE id=$1
    `, [replay.id,JSON.stringify(response),draft.id]);
    await client.query(`
      INSERT INTO public.integration_api_audit(
        request_id,application_id,connection_id,company_id,grant_id,
        delegating_user_id,scopes,route,action,resource_type,resource_id,
        result,http_status,network_hash,details
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,'/api/v1/request-drafts','REQUEST_DRAFT_CREATE',
        'request_draft',$8,'SUCCESS',201,$9,'{}'::jsonb
      )
    `, [
      input.requestId,principal.applicationId,principal.connectionId,
      principal.companyId,principal.grantId,principal.actor.id,principal.scopes,
      draft.id,input.networkHash,
    ]);
    return { data: response, replayed: false };
  });
}
