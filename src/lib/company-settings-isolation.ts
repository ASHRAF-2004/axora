import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { getDemoStore } from "./demo-data";
import { isDemoMode, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";

const uuidSchema = z.string().uuid();

interface AccessRow extends QueryResultRow {
  snapshot: {
    resourceId?: string;
    permission?: string;
  } | null;
}

export class CompanySettingsAccessUnavailableError extends Error {
  constructor() {
    super("The requested company configuration is unavailable.");
    this.name = "CompanySettingsAccessUnavailableError";
  }
}

export async function updateAuthorizedCompanyPricingConfiguration(
  companyId: string,
  input: { taxRate: number; estimatedDeliveryFee: number },
  actor: AuthenticatedSessionUser,
) {
  if (!canAccess(actor, "manage_commercial_pricing")
    || !uuidSchema.safeParse(companyId).success
    || !Number.isFinite(input.taxRate)
    || input.taxRate < 0
    || input.taxRate > 100
    || !Number.isFinite(input.estimatedDeliveryFee)
    || input.estimatedDeliveryFee < 0) {
    throw new CompanySettingsAccessUnavailableError();
  }

  if (isDemoMode()) {
    const company = getDemoStore().companies.find((item) => item.id === companyId);
    if (!company) throw new CompanySettingsAccessUnavailableError();
    company.taxRate = input.taxRate;
    company.estimatedDeliveryFee = input.estimatedDeliveryFee;
    return;
  }
  if (!actor.roleAssignmentId) {
    throw new CompanySettingsAccessUnavailableError();
  }

  await withAuditTransaction({
    actor,
    reason: "Company pricing configuration updated",
  }, async (client) => {
    const access = await client.query<AccessRow>(`
      SELECT public.axora_organization_resource_access(
        $1,$2,'commercial.pricing.manage','COMPANY',$3,$4
      ) AS snapshot
    `, [actor.id, actor.roleAssignmentId, companyId, new Date()]);
    if (access.rows[0]?.snapshot?.resourceId !== companyId
      || access.rows[0]?.snapshot?.permission !== "commercial.pricing.manage") {
      throw new CompanySettingsAccessUnavailableError();
    }

    const locked = await client.query(`
      SELECT 1 FROM public.companies
      WHERE id=$1 AND active
      FOR UPDATE
    `, [companyId]);
    if (!locked.rowCount) throw new CompanySettingsAccessUnavailableError();

    await client.query(`
      UPDATE public.companies
      SET tax_rate=$2,
          estimated_delivery_fee=$3,
          updated_at=now()
      WHERE id=$1
    `, [companyId, input.taxRate, input.estimatedDeliveryFee]);
  });
}
