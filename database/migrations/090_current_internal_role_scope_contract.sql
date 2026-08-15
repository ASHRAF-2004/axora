BEGIN;

-- Migration 080 introduced the current HR Management and Delivery Guy roles,
-- but the canonical assignment contract still listed only their retired
-- predecessors. Keep assignment validation deny-by-default while admitting
-- only the intended platform and delivery scopes for the current role keys.
CREATE OR REPLACE FUNCTION public.axora_role_scope_contract_is_valid(
  p_account_kind text,
  p_is_owner boolean,
  p_role_key text,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_role_key='PLATFORM_OWNER' THEN
      p_account_kind='PLATFORM' AND p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN p_role_key IN (
      'PLATFORM_OPERATIONS','TECHNICAL_SUPPORT','HUMAN_RESOURCES_MANAGEMENT'
    ) THEN
      p_account_kind='PLATFORM' AND NOT p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN p_role_key='CLIENT_ACCOUNT_MANAGER' THEN
      p_account_kind='PLATFORM' AND NOT p_is_owner
      AND p_scope_type='COMPANY' AND p_company_id IS NOT NULL
      AND p_branch_id IS NULL AND p_department_id IS NULL
      AND p_supplier_id IS NULL
    WHEN p_role_key IN ('COMPANY_ADMIN','COMPANY_APPROVER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='COMPANY' AND p_company_id IS NOT NULL
      AND p_branch_id IS NULL AND p_department_id IS NULL
      AND p_supplier_id IS NULL
    WHEN p_role_key IN ('BRANCH_ADMIN','BRANCH_APPROVER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='BRANCH' AND p_company_id IS NOT NULL
      AND p_branch_id IS NOT NULL AND p_department_id IS NULL
      AND p_supplier_id IS NULL
    WHEN p_role_key='DEPARTMENT_ADMIN' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='DEPARTMENT' AND p_company_id IS NOT NULL
      AND p_department_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='REQUESTER' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL
      AND (
        (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
      ) AND p_supplier_id IS NULL
    WHEN p_role_key IN ('FINANCE_REVIEWER','AUDITOR','RECEIVING_USER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL
      AND (
        (p_scope_type='COMPANY' AND p_branch_id IS NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
      ) AND p_supplier_id IS NULL
    WHEN p_role_key='SUPPLIER_USER' THEN
      p_account_kind='SUPPLIER' AND NOT p_is_owner
      AND p_scope_type='SUPPLIER' AND p_supplier_id IS NOT NULL
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL
    WHEN p_role_key IN (
      'DELIVERY_GUY','DELIVERY_TEAM_SUPERVISOR','DELIVERY_AGENT','DELIVERY_DRIVER'
    ) THEN
      p_account_kind='DELIVERY' AND NOT p_is_owner
      AND p_scope_type='DELIVERY'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN p_role_key='ADMIN' THEN
      (
        p_account_kind='PLATFORM' AND p_is_owner
        AND p_scope_type='PLATFORM'
        AND p_company_id IS NULL AND p_branch_id IS NULL
        AND p_department_id IS NULL AND p_supplier_id IS NULL
      ) OR (
        p_account_kind='COMPANY' AND NOT p_is_owner
        AND p_scope_type='COMPANY' AND p_company_id IS NOT NULL
        AND p_branch_id IS NULL AND p_department_id IS NULL
        AND p_supplier_id IS NULL
      )
    WHEN p_role_key='APPROVER' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
      AND (
        (p_scope_type='COMPANY' AND p_branch_id IS NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
      )
    WHEN p_role_key IN ('FINANCE','VIEWER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='OPERATIONS' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='IT_SUPPORT' THEN
      p_account_kind='PLATFORM' AND NOT p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.axora_role_scope_contract_is_valid(
  text,boolean,text,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;

-- Preserve the reviewed assignment protections while allowing the sole
-- non-platform creation path: an active Delivery Guy atomically claiming a
-- job through axora_claim_available_delivery_job. Merely setting assigned_by
-- to the driver is insufficient; the command, reason, role and live claim
-- permission must all agree.
CREATE OR REPLACE FUNCTION public.validate_delivery_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE driver_is_active boolean; job_status text;
  photo_required boolean; driver_has_photo boolean; self_claim boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT profile.active AND account.active
      AND account.account_status='ACTIVE'
      AND account.account_kind='DELIVERY'
      INTO driver_is_active
    FROM public.delivery_agent_profiles profile
    JOIN public.users account ON account.id=profile.user_id
    WHERE profile.user_id=NEW.driver_user_id;
    IF driver_is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Only an active delivery driver can be assigned';
    END IF;
    SELECT policy.delivery_agent_photo_required INTO photo_required
    FROM public.profile_image_policies policy
    WHERE policy.id='00000000-0000-4000-8000-000000000066'::uuid;
    IF photo_required THEN
      SELECT (image.id IS NOT NULL OR profile.avatar_content IS NOT NULL)
        INTO driver_has_photo
      FROM public.user_profiles profile
      LEFT JOIN public.profile_image_versions image
        ON image.id=profile.active_avatar_version_id
       AND image.user_id=profile.user_id AND image.status='ACTIVE'
      WHERE profile.user_id=NEW.driver_user_id;
      IF driver_has_photo IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'A processed profile photo is required for this delivery agent';
      END IF;
    END IF;
    self_claim:=NEW.assigned_by=NEW.driver_user_id
      AND NEW.assignment_reason='Claimed by Delivery Guy'
      AND NEW.command_id IS NOT NULL
      AND NEW.driver_role_assignment_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.role_assignments assignment
        JOIN public.roles role ON role.id=assignment.role_id
        WHERE assignment.id=NEW.driver_role_assignment_id
          AND assignment.user_id=NEW.driver_user_id
          AND assignment.active AND assignment.revoked_at IS NULL
          AND assignment.scope_type='DELIVERY' AND role.role_key='DELIVERY_GUY'
          AND public.axora_snapshot_has_permission(
            public.axora_live_authorization_snapshot(
              assignment.user_id,assignment.id,now()
            ),'delivery.claim','DELIVERY',NULL,NULL,NULL,NULL
          )
      );
    IF NOT public.axora_user_is_platform(NEW.assigned_by) AND NOT self_claim THEN
      RAISE EXCEPTION 'Only an authorized self-claim or platform recovery may assign a delivery job';
    END IF;
    IF NEW.driver_role_assignment_id IS NULL THEN
      SELECT role_assignment.id INTO NEW.driver_role_assignment_id
      FROM public.role_assignments role_assignment
      WHERE role_assignment.user_id=NEW.driver_user_id
        AND role_assignment.active AND role_assignment.revoked_at IS NULL
        AND role_assignment.scope_type='DELIVERY'
        AND public.axora_snapshot_has_permission(
          public.axora_live_authorization_snapshot(
            role_assignment.user_id,role_assignment.id,now()
          ),'delivery.accept','DELIVERY',NULL,NULL,NULL,NULL
        )
      ORDER BY role_assignment.assigned_at DESC,role_assignment.id LIMIT 1;
    END IF;
    IF NEW.supervisor_role_assignment_id IS NULL AND NOT self_claim THEN
      NEW.supervisor_role_assignment_id:=public.axora_context_role_assignment_id();
    END IF;
    SELECT status INTO job_status FROM public.delivery_jobs
    WHERE id=NEW.delivery_job_id AND company_id=NEW.company_id;
    IF job_status IS NULL OR job_status IN ('COMPLETED','CANCELLED') THEN
      RAISE EXCEPTION 'A terminal or missing delivery job cannot be assigned';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','accepted_at','ended_at','updated_at'])
      IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','accepted_at','ended_at','updated_at']) THEN
      RAISE EXCEPTION 'Delivery assignment identity is immutable';
    END IF;
    IF OLD.status IN ('REJECTED','REASSIGNED','CANCELLED','COMPLETED')
      AND NEW.status<>OLD.status THEN
      RAISE EXCEPTION 'A terminal assignment cannot be reopened';
    END IF;
    NEW.updated_at:=now();
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.validate_delivery_assignment() FROM PUBLIC;

COMMIT;
