import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  brandContrastSummary,
  buildBrandThemeTokens,
} from "@/lib/brand-colors";
import {
  BRAND_ALGORITHM_VERSION,
  DEFAULT_COMPANY_PAGE_CONFIGURATION,
} from "@/lib/tenant-branding";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

interface Principal {
  userId: string;
  assignmentId: string;
}

interface Mutation {
  status: string;
  themeId: string;
  logoId?: string;
}

describe("reviewed company branding SQL lifecycle", () => {
  it("isolates review, blocks contrast, publishes atomically, and rolls back by version", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await applyDemoSeed(db);
      const owner = {
        userId: randomUUID(),
        assignmentId: randomUUID(),
      };
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,
          account_setup_completed_at,account_kind,account_status,
          active,auth_version
        )
        SELECT $1,'brand-review-owner@example.test','Brand review owner',
          'not-a-real-hash',role.id,true,now(),'PLATFORM','ACTIVE',true,1
        FROM roles role WHERE role.role_key='PLATFORM_OWNER'
      `, [owner.userId]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        )
        SELECT $2,$1,role.id,'PLATFORM',true,$1,now()
        FROM roles role WHERE role.role_key='PLATFORM_OWNER'
      `, [owner.userId, owner.assignmentId]);
      const companyResult = await db.query<{ id: string; branchId: string }>(`
        SELECT company.id::text,branch.id::text AS "branchId"
        FROM companies company
        JOIN branches branch ON branch.company_id=company.id
        WHERE company.lifecycle_status<>'ARCHIVED'
          AND company.active AND branch.active
        ORDER BY company.id,branch.id LIMIT 1
      `);
      const companyId = companyResult.rows[0].id;
      const tokens = buildBrandThemeTokens();
      const contrast = brandContrastSummary(tokens);

      const createDraft = async (hashCharacter: string) => db.query<{
        value: Mutation | null;
      }>(`
        SELECT public.axora_create_company_brand_draft(
          $1,$2,$3,'review-logo.png','image/png',$4::bytea,$5,320,160,false,
          $6,$7::jsonb,$8::jsonb,$9::jsonb,'{}'::jsonb,$10::jsonb,
          'ORIGINAL','HEADER_START','LIGHT',NULL,
          'Generated deterministic company theme for human review',now()
        ) AS value
      `, [
        owner.userId,
        owner.assignmentId,
        companyId,
        new Uint8Array([137, 80, 78, 71]),
        hashCharacter.repeat(64),
        BRAND_ALGORITHM_VERSION,
        JSON.stringify(tokens),
        JSON.stringify({
          dominantColors: [tokens.primary, tokens.accent],
          sampledOpaquePixels: 512,
          usedFallback: false,
          qualityWarnings: [],
        }),
        JSON.stringify(contrast),
        JSON.stringify(DEFAULT_COMPANY_PAGE_CONFIGURATION),
      ]);

      const firstDraft = (await createDraft("a")).rows[0].value;
      expect(firstDraft?.status).toBe("REVIEW_REQUIRED");
      const firstThemeId = firstDraft!.themeId;

      const ownerWorkspace = await db.query<{ value: {
        canPublish: boolean;
        themes: Array<{ id: string; status: string; active: boolean }>;
        events: Array<{ status: string }>;
      } | null }>(`
        SELECT public.axora_company_brand_review_workspace(
          $1,$2,$3,now()
        ) AS value
      `, [owner.userId, owner.assignmentId, companyId]);
      expect(ownerWorkspace.rows[0].value?.canPublish).toBe(true);
      expect(ownerWorkspace.rows[0].value?.themes[0]).toMatchObject({
        id: firstThemeId,
        status: "REVIEW_REQUIRED",
        active: false,
      });
      expect(ownerWorkspace.rows[0].value?.events.map((event) => event.status))
        .toEqual(expect.arrayContaining([
          "LOGO_UPLOADED",
          "ANALYSIS_QUEUED",
          "DRAFT_GENERATED",
          "REVIEW_REQUIRED",
        ]));

      const companyUserId = randomUUID();
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,company_id,branch_id,
          is_owner,account_kind,account_status,email_verified_at,
          account_setup_completed_at
        )
        SELECT $1,'brand-review-company@example.test','Brand review company',
          'not-a-real-hash',role.id,$2,$3,false,'COMPANY','ACTIVE',now(),now()
        FROM roles role WHERE role.role_key='REQUESTER'
      `, [companyUserId, companyId, companyResult.rows[0].branchId]);
      await db.query(`
        INSERT INTO user_profiles(user_id,display_name)
        VALUES ($1,'Brand review company')
      `, [companyUserId]);
      await db.query(`
        INSERT INTO company_memberships(
          user_id,company_id,status,is_primary,joined_at
        ) VALUES ($1,$2,'ACTIVE',true,now())
      `, [companyUserId, companyId]);
      await db.query(`
        INSERT INTO branch_assignments(
          user_id,company_id,branch_id,status,is_primary
        ) VALUES ($1,$2,$3,'ACTIVE',true)
      `, [companyUserId, companyId, companyResult.rows[0].branchId]);
      const companyPrincipal = await db.query<Principal>(`
        INSERT INTO role_assignments(
          user_id,role_id,scope_type,company_id,branch_id
        )
        SELECT $1,role.id,'BRANCH',$2,$3
        FROM roles role WHERE role.role_key='REQUESTER'
        RETURNING user_id::text AS "userId",id::text AS "assignmentId"
      `, [companyUserId, companyId, companyResult.rows[0].branchId]);
      const hiddenWorkspace = await db.query<{ value: unknown }>(`
        SELECT public.axora_company_brand_review_workspace(
          $1,$2,$3,now()
        ) AS value
      `, [
        companyPrincipal.rows[0].userId,
        companyPrincipal.rows[0].assignmentId,
        companyId,
      ]);
      expect(hiddenWorkspace.rows[0].value).toBeNull();

      const transition = (
        themeId: string,
        action: "APPROVE" | "REJECT" | "PUBLISH",
      ) => db.query<{ value: Mutation | null }>(`
        SELECT public.axora_transition_company_brand_theme(
          $1,$2,$3,$4,$5,
          'Human reviewer recorded a controlled workflow decision',now()
        ) AS value
      `, [
        owner.userId,
        owner.assignmentId,
        companyId,
        themeId,
        action,
      ]);

      expect((await transition(firstThemeId, "APPROVE")).rows[0].value?.status)
        .toBe("APPROVED");
      expect((await transition(firstThemeId, "PUBLISH")).rows[0].value?.status)
        .toBe("PUBLISHED");

      const unsafeTokens = buildBrandThemeTokens({
        pageBackground: "#FFFFFF",
        text: "#FFFFFF",
      });
      const createVariant = (
        baseThemeId: string,
        variantTokens: typeof tokens,
        reason: string,
      ) => db.query<{ value: Mutation | null }>(`
        SELECT public.axora_create_company_brand_variant(
          $1,$2,$3,$4,'axora-logo-review-v1',$5::jsonb,
          '{"manualReview":true}'::jsonb,$6::jsonb,
          '{"reviewed":true}'::jsonb,$7::jsonb,
          'ORIGINAL','HEADER_START','LIGHT',$8,now()
        ) AS value
      `, [
        owner.userId,
        owner.assignmentId,
        companyId,
        baseThemeId,
        JSON.stringify(variantTokens),
        JSON.stringify(brandContrastSummary(variantTokens)),
        JSON.stringify(DEFAULT_COMPANY_PAGE_CONFIGURATION),
        reason,
      ]);
      const unsafeDraft = (await createVariant(
        firstThemeId,
        unsafeTokens,
        "Reviewer tested a deliberately unsafe text override",
      )).rows[0].value!;
      expect((await transition(unsafeDraft.themeId, "APPROVE")).rows[0].value)
        .toMatchObject({ status: "CONTRAST_BLOCKED" });
      expect((await transition(unsafeDraft.themeId, "REJECT")).rows[0].value)
        .toMatchObject({ status: "REJECTED" });

      const secondDraft = (await createVariant(
        firstThemeId,
        tokens,
        "Reviewer selected an accessible controlled alternative",
      )).rows[0].value!;
      await transition(secondDraft.themeId, "APPROVE");
      await transition(secondDraft.themeId, "PUBLISH");
      const rollback = await db.query<{ value: Mutation & {
        rollbackOfThemeId: string;
      } | null }>(`
        SELECT public.axora_rollback_company_brand_theme(
          $1,$2,$3,$4,
          'Reviewer restored the previously published approved version',now()
        ) AS value
      `, [owner.userId, owner.assignmentId, companyId, firstThemeId]);
      expect(rollback.rows[0].value).toMatchObject({
        status: "PUBLISHED",
        rollbackOfThemeId: firstThemeId,
      });
      const active = await db.query<{
        id: string;
        rollbackOfThemeId: string | null;
        active: boolean;
      }>(`
        SELECT id::text,rollback_of_theme_id::text AS "rollbackOfThemeId",active
        FROM company_brand_themes
        WHERE company_id=$1 AND active
      `, [companyId]);
      expect(active.rows).toHaveLength(1);
      expect(active.rows[0]).toMatchObject({
        rollbackOfThemeId: firstThemeId,
        active: true,
      });

      await expect(db.query(
        "UPDATE company_brand_themes SET primary_color='#FFFFFF' WHERE id=$1",
        [active.rows[0].id],
      )).rejects.toThrow("immutable");
      await expect(db.query(
        "DELETE FROM company_brand_theme_events WHERE theme_id=$1",
        [active.rows[0].id],
      )).rejects.toThrow("append-only");
    } finally {
      await db.close();
    }
  }, 30_000);
});
