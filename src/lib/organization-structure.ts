import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";

export const ORGANIZATION_NODE_TYPES = [
  "BRANCH",
  "DEPARTMENT",
  "BUSINESS_UNIT",
  "COST_CENTRE",
  "DELIVERY_LOCATION",
] as const;

const uuid = z.string().uuid();
const optionalUuid = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  uuid.optional(),
);
const optionalText = (maximum: number) => z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.string().max(maximum).optional(),
);

const companySchema = z.object({
  id: uuid,
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(300),
  status: z.enum(["Active", "Inactive"]),
});
const branchSchema = z.object({
  id: uuid,
  companyId: uuid,
  companyName: z.string().min(1).max(300),
  name: z.string().min(1).max(300),
  branchCode: z.string().min(1).max(80),
  city: z.string().max(300),
  timezone: z.string().min(1).max(120),
  status: z.enum(["Active", "Inactive"]),
});
const departmentSchema = z.object({
  id: uuid,
  companyId: uuid,
  branchId: optionalUuid,
  parentDepartmentId: optionalUuid,
  code: z.string().min(1).max(40),
  name: z.string().min(2).max(200),
  description: optionalText(1000),
  managerUserId: optionalUuid,
  timezone: z.string().min(1).max(120),
  active: z.boolean(),
}).strict();
const businessUnitSchema = z.object({
  id: uuid,
  companyId: uuid,
  parentBusinessUnitId: optionalUuid,
  code: z.string().min(2).max(40),
  name: z.string().min(2).max(200),
  description: optionalText(1000),
  managerUserId: optionalUuid,
  active: z.boolean(),
}).strict();
const costCentreSchema = z.object({
  id: uuid,
  companyId: uuid,
  businessUnitId: optionalUuid,
  branchId: optionalUuid,
  departmentId: optionalUuid,
  code: z.string().min(2).max(40),
  name: z.string().min(2).max(200),
  description: optionalText(1000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  active: z.boolean(),
}).strict();
const deliveryLocationSchema = z.object({
  id: uuid,
  companyId: uuid,
  branchId: uuid,
  departmentId: optionalUuid,
  code: z.string().min(2).max(40),
  name: z.string().min(2).max(200),
  address: z.string().min(3).max(5000),
  city: z.string().min(2).max(300),
  stateRegion: optionalText(300),
  postalCode: optionalText(40),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  timezone: z.string().min(1).max(120),
  contactName: optionalText(300),
  contactPhone: optionalText(120),
  contactEmail: optionalText(320),
  deliveryInstructions: optionalText(5000),
  isPrimary: z.boolean(),
  active: z.boolean(),
}).strict();

const workspaceSchema = z.object({
  capturedAt: z.coerce.date(),
  canManageBranches: z.boolean(),
  canManageDepartments: z.boolean(),
  canManageCostCentres: z.boolean(),
  canManageDeliveryLocations: z.boolean(),
  companies: z.array(companySchema),
  branches: z.array(branchSchema),
  departments: z.array(departmentSchema),
  businessUnits: z.array(businessUnitSchema),
  costCentres: z.array(costCentreSchema),
  deliveryLocations: z.array(deliveryLocationSchema),
  history: z.array(z.object({
    id: uuid,
    companyId: uuid,
    nodeType: z.enum(ORGANIZATION_NODE_TYPES),
    nodeId: uuid,
    changeType: z.enum(["CREATED", "UPDATED", "MOVED", "DEACTIVATED", "REACTIVATED"]),
    reason: z.string().min(1).max(1000),
    changedAt: z.coerce.date(),
    changedByName: z.string().max(300).nullable(),
  }).strict()),
}).strict();

const mutationSchema = z.object({
  nodeType: z.enum(ORGANIZATION_NODE_TYPES),
  nodeId: uuid,
  companyId: uuid,
  eventKey: z.enum([
    "organization.node.created",
    "organization.node.updated",
    "organization.node.moved",
    "organization.node.deactivated",
    "organization.node.reactivated",
  ]),
}).strict();

interface SnapshotRow extends QueryResultRow { snapshot: unknown }

export type OrganizationStructureWorkspace = z.infer<typeof workspaceSchema>;
export type OrganizationDepartment = z.infer<typeof departmentSchema>;
export type OrganizationNodeType = typeof ORGANIZATION_NODE_TYPES[number];

export interface OrganizationNodeInput {
  nodeType: OrganizationNodeType;
  nodeId?: string;
  companyId: string;
  code: string;
  name: string;
  branchId?: string;
  departmentId?: string;
  parentId?: string;
  businessUnitId?: string;
  details: Record<string, string | boolean | undefined>;
  reason: string;
}

export class OrganizationStructureUnavailableError extends Error {
  constructor() {
    super("The requested organization structure operation is unavailable.");
    this.name = "OrganizationStructureUnavailableError";
  }
}

function assignmentId(actor: SessionUser) {
  const parsed = uuid.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new OrganizationStructureUnavailableError();
  return parsed.data;
}

export async function loadOrganizationStructureWorkspace(
  actor: AuthenticatedSessionUser,
  capturedAt = new Date(),
) {
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new OrganizationStructureUnavailableError();
  }
  if (isDemoMode()) return workspaceSchema.parse({
    capturedAt,
    canManageBranches: false,
    canManageDepartments: false,
    canManageCostCentres: false,
    canManageDeliveryLocations: false,
    companies: [],
    branches: [],
    departments: [],
    businessUnits: [],
    costCentres: [],
    deliveryLocations: [],
    history: [],
  });
  try {
    const result = await query<SnapshotRow>(
      "SELECT public.axora_organization_structure_workspace($1,$2,$3) AS snapshot",
      [actor.id, assignmentId(actor), capturedAt],
    );
    const parsed = workspaceSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success || parsed.data.capturedAt.getTime() !== capturedAt.getTime()) {
      throw new OrganizationStructureUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof OrganizationStructureUnavailableError) throw error;
    throw new OrganizationStructureUnavailableError();
  }
}

async function mutate(
  actor: AuthenticatedSessionUser,
  reason: string,
  sql: string,
  values: unknown[],
) {
  if (isDemoMode()) throw new OrganizationStructureUnavailableError();
  return withAuditTransaction({ userId: actor.id, reason }, async (client) => {
    const result = await client.query<SnapshotRow>(sql, values);
    const parsed = mutationSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success) throw new OrganizationStructureUnavailableError();
    return parsed.data;
  });
}

export function saveOrganizationNode(
  actor: AuthenticatedSessionUser,
  input: OrganizationNodeInput,
) {
  return mutate(
    actor,
    input.reason,
    `SELECT public.axora_save_organization_node(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
     ) AS snapshot`,
    [
      actor.id, assignmentId(actor), input.nodeType, input.nodeId ?? null,
      uuid.parse(input.companyId), input.code, input.name,
      input.branchId ? uuid.parse(input.branchId) : null,
      input.departmentId ? uuid.parse(input.departmentId) : null,
      input.parentId ? uuid.parse(input.parentId) : null,
      input.businessUnitId ? uuid.parse(input.businessUnitId) : null,
      input.details, input.reason, new Date(),
    ],
  );
}

export function setOrganizationNodeActive(
  actor: AuthenticatedSessionUser,
  nodeType: OrganizationNodeType,
  nodeId: string,
  active: boolean,
  reason: string,
) {
  return mutate(
    actor,
    reason,
    "SELECT public.axora_set_organization_node_active($1,$2,$3,$4,$5,$6,$7) AS snapshot",
    [actor.id, assignmentId(actor), nodeType, uuid.parse(nodeId), active, reason, new Date()],
  );
}

export const organizationStructureInternals = { mutationSchema, workspaceSchema };
