BEGIN;

-- P0-01 lifecycle slice: role/scope changes are append-only, auditable,
-- exact-assignment operations. Direct role-assignment updates and deletes are
-- removed from the application role; invitation creation retains a temporary
-- validated INSERT compatibility path until its dedicated command is migrated.

ALTER TABLE public.role_assignments
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES public.users(id)
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoke_reason text;

ALTER TABLE public.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_revoke_reason_check;
ALTER TABLE public.role_assignments
  ADD CONSTRAINT role_assignments_revoke_reason_check
  CHECK (
    revoke_reason IS NULL
    OR (
      char_length(btrim(revoke_reason)) BETWEEN 3 AND 500
      AND revoke_reason !~ '[[:cntrl:]]'
    )
  );
ALTER TABLE public.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_revoker_requires_revocation_check;
ALTER TABLE public.role_assignments
  ADD CONSTRAINT role_assignments_revoker_requires_revocation_check
  CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.role_assignment_management_rules (
  manager_role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  target_role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN (
    'PLATFORM','COMPANY','BRANCH','DEPARTMENT','SUPPLIER','DELIVERY'
  )),
  PRIMARY KEY(manager_role_id,target_role_id,scope_type)
);

INSERT INTO public.role_assignment_management_rules(
  manager_role_id,target_role_id,scope_type
)
SELECT manager_role.id,target_role.id,rule.scope_type
FROM (VALUES
  ('PLATFORM_OWNER','PLATFORM_OWNER','PLATFORM'),
  ('PLATFORM_OWNER','PLATFORM_OPERATIONS','PLATFORM'),
  ('PLATFORM_OWNER','TECHNICAL_SUPPORT','PLATFORM'),
  ('PLATFORM_OWNER','CLIENT_ACCOUNT_MANAGER','COMPANY'),
  ('PLATFORM_OWNER','COMPANY_ADMIN','COMPANY'),
  ('PLATFORM_OWNER','BRANCH_ADMIN','BRANCH'),
  ('PLATFORM_OWNER','DEPARTMENT_ADMIN','DEPARTMENT'),
  ('PLATFORM_OWNER','COMPANY_APPROVER','COMPANY'),
  ('PLATFORM_OWNER','BRANCH_APPROVER','BRANCH'),
  ('PLATFORM_OWNER','REQUESTER','BRANCH'),
  ('PLATFORM_OWNER','REQUESTER','DEPARTMENT'),
  ('PLATFORM_OWNER','FINANCE_REVIEWER','COMPANY'),
  ('PLATFORM_OWNER','FINANCE_REVIEWER','BRANCH'),
  ('PLATFORM_OWNER','FINANCE_REVIEWER','DEPARTMENT'),
  ('PLATFORM_OWNER','AUDITOR','COMPANY'),
  ('PLATFORM_OWNER','AUDITOR','BRANCH'),
  ('PLATFORM_OWNER','AUDITOR','DEPARTMENT'),
  ('PLATFORM_OWNER','RECEIVING_USER','COMPANY'),
  ('PLATFORM_OWNER','RECEIVING_USER','BRANCH'),
  ('PLATFORM_OWNER','RECEIVING_USER','DEPARTMENT'),
  ('PLATFORM_OWNER','SUPPLIER_USER','SUPPLIER'),
  ('PLATFORM_OWNER','DELIVERY_TEAM_SUPERVISOR','DELIVERY'),
  ('PLATFORM_OWNER','DELIVERY_AGENT','DELIVERY'),
  ('PLATFORM_OWNER','DELIVERY_DRIVER','DELIVERY'),

  ('CLIENT_ACCOUNT_MANAGER','COMPANY_ADMIN','COMPANY'),
  ('CLIENT_ACCOUNT_MANAGER','BRANCH_ADMIN','BRANCH'),
  ('CLIENT_ACCOUNT_MANAGER','DEPARTMENT_ADMIN','DEPARTMENT'),
  ('CLIENT_ACCOUNT_MANAGER','COMPANY_APPROVER','COMPANY'),
  ('CLIENT_ACCOUNT_MANAGER','BRANCH_APPROVER','BRANCH'),
  ('CLIENT_ACCOUNT_MANAGER','REQUESTER','BRANCH'),
  ('CLIENT_ACCOUNT_MANAGER','REQUESTER','DEPARTMENT'),
  ('CLIENT_ACCOUNT_MANAGER','FINANCE_REVIEWER','COMPANY'),
  ('CLIENT_ACCOUNT_MANAGER','FINANCE_REVIEWER','BRANCH'),
  ('CLIENT_ACCOUNT_MANAGER','FINANCE_REVIEWER','DEPARTMENT'),
  ('CLIENT_ACCOUNT_MANAGER','AUDITOR','COMPANY'),
  ('CLIENT_ACCOUNT_MANAGER','AUDITOR','BRANCH'),
  ('CLIENT_ACCOUNT_MANAGER','AUDITOR','DEPARTMENT'),
  ('CLIENT_ACCOUNT_MANAGER','RECEIVING_USER','COMPANY'),
  ('CLIENT_ACCOUNT_MANAGER','RECEIVING_USER','BRANCH'),
  ('CLIENT_ACCOUNT_MANAGER','RECEIVING_USER','DEPARTMENT'),

  ('COMPANY_ADMIN','COMPANY_ADMIN','COMPANY'),
  ('COMPANY_ADMIN','BRANCH_ADMIN','BRANCH'),
  ('COMPANY_ADMIN','DEPARTMENT_ADMIN','DEPARTMENT'),
  ('COMPANY_ADMIN','COMPANY_APPROVER','COMPANY'),
  ('COMPANY_ADMIN','BRANCH_APPROVER','BRANCH'),
  ('COMPANY_ADMIN','REQUESTER','BRANCH'),
  ('COMPANY_ADMIN','REQUESTER','DEPARTMENT'),
  ('COMPANY_ADMIN','FINANCE_REVIEWER','COMPANY'),
  ('COMPANY_ADMIN','FINANCE_REVIEWER','BRANCH'),
  ('COMPANY_ADMIN','FINANCE_REVIEWER','DEPARTMENT'),
  ('COMPANY_ADMIN','AUDITOR','COMPANY'),
  ('COMPANY_ADMIN','AUDITOR','BRANCH'),
  ('COMPANY_ADMIN','AUDITOR','DEPARTMENT'),
  ('COMPANY_ADMIN','RECEIVING_USER','COMPANY'),
  ('COMPANY_ADMIN','RECEIVING_USER','BRANCH'),
  ('COMPANY_ADMIN','RECEIVING_USER','DEPARTMENT'),

  ('BRANCH_ADMIN','DEPARTMENT_ADMIN','DEPARTMENT'),
  ('BRANCH_ADMIN','BRANCH_APPROVER','BRANCH'),
  ('BRANCH_ADMIN','REQUESTER','BRANCH'),
  ('BRANCH_ADMIN','REQUESTER','DEPARTMENT'),
  ('BRANCH_ADMIN','FINANCE_REVIEWER','BRANCH'),
  ('BRANCH_ADMIN','FINANCE_REVIEWER','DEPARTMENT'),
  ('BRANCH_ADMIN','AUDITOR','BRANCH'),
  ('BRANCH_ADMIN','AUDITOR','DEPARTMENT'),
  ('BRANCH_ADMIN','RECEIVING_USER','BRANCH'),
  ('BRANCH_ADMIN','RECEIVING_USER','DEPARTMENT'),

  ('DEPARTMENT_ADMIN','REQUESTER','DEPARTMENT'),
  ('DEPARTMENT_ADMIN','FINANCE_REVIEWER','DEPARTMENT'),
  ('DEPARTMENT_ADMIN','AUDITOR','DEPARTMENT'),
  ('DEPARTMENT_ADMIN','RECEIVING_USER','DEPARTMENT'),

  ('DELIVERY_TEAM_SUPERVISOR','DELIVERY_AGENT','DELIVERY'),
  ('DELIVERY_TEAM_SUPERVISOR','DELIVERY_DRIVER','DELIVERY')
) AS rule(manager_role_key,target_role_key,scope_type)
JOIN public.roles manager_role
  ON manager_role.role_key=rule.manager_role_key
JOIN public.roles target_role
  ON target_role.role_key=rule.target_role_key
ON CONFLICT(manager_role_id,target_role_id,scope_type) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS permission_change_history_role_command_uq
  ON public.permission_change_history(correlation_id)
  WHERE change_type IN ('ROLE_ASSIGNED','ROLE_REVOKED');

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
    WHEN p_role_key IN ('PLATFORM_OPERATIONS','TECHNICAL_SUPPORT') THEN
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
        OR
        (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
      )
      AND p_supplier_id IS NULL
    WHEN p_role_key IN ('FINANCE_REVIEWER','AUDITOR','RECEIVING_USER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL
      AND (
        (p_scope_type='COMPANY' AND p_branch_id IS NULL
          AND p_department_id IS NULL)
        OR
        (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR
        (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
      )
      AND p_supplier_id IS NULL
    WHEN p_role_key='SUPPLIER_USER' THEN
      p_account_kind='SUPPLIER' AND NOT p_is_owner
      AND p_scope_type='SUPPLIER' AND p_supplier_id IS NOT NULL
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL
    WHEN p_role_key IN (
      'DELIVERY_TEAM_SUPERVISOR','DELIVERY_AGENT','DELIVERY_DRIVER'
    ) THEN
      p_account_kind='DELIVERY' AND NOT p_is_owner
      AND p_scope_type='DELIVERY'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL

    -- Retained aliases remain structurally valid for legacy invitation and
    -- bootstrap paths, but audited lifecycle commands accept canonical roles.
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
        OR
        (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR
        (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
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

CREATE OR REPLACE FUNCTION public.axora_role_scope_resource_is_active(
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT CASE p_scope_type
    WHEN 'PLATFORM' THEN p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN 'COMPANY' THEN public.axora_delegation_scope_is_active(
      p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
    )
    WHEN 'BRANCH' THEN public.axora_delegation_scope_is_active(
      p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
    )
    WHEN 'DEPARTMENT' THEN public.axora_delegation_scope_is_active(
      p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
    )
    WHEN 'SUPPLIER' THEN EXISTS (
      SELECT 1 FROM public.suppliers supplier
      WHERE supplier.id=p_supplier_id AND supplier.active
        AND p_company_id IS NULL AND p_branch_id IS NULL
        AND p_department_id IS NULL
    )
    WHEN 'DELIVERY' THEN p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.axora_role_assignment_target_is_ready(
  p_user_id uuid,
  p_role_id uuid,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  account_row public.users%ROWTYPE;
  role_key text;
BEGIN
  SELECT account.* INTO account_row
  FROM public.users account
  WHERE account.id=p_user_id;
  IF account_row.id IS NULL OR NOT account_row.active
    OR account_row.account_status NOT IN ('ACTIVE','INVITED') THEN
    RETURN false;
  END IF;

  SELECT role.role_key INTO role_key
  FROM public.roles role
  WHERE role.id=p_role_id;
  IF role_key IS NULL OR NOT public.axora_role_scope_contract_is_valid(
    account_row.account_kind,account_row.is_owner,role_key,
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT public.axora_role_scope_resource_is_active(
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RETURN false;
  END IF;

  IF account_row.account_kind='COMPANY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_memberships membership
      WHERE membership.user_id=p_user_id
        AND membership.company_id=p_company_id
        AND membership.status IN ('ACTIVE','INVITED')
    ) THEN
      RETURN false;
    END IF;
    IF p_scope_type='BRANCH' AND NOT EXISTS (
      SELECT 1 FROM public.branch_assignments assignment
      WHERE assignment.user_id=p_user_id
        AND assignment.company_id=p_company_id
        AND assignment.branch_id=p_branch_id
        AND assignment.status='ACTIVE'
    ) THEN
      RETURN false;
    END IF;
    IF p_scope_type='DEPARTMENT' AND NOT EXISTS (
      SELECT 1 FROM public.department_assignments assignment
      WHERE assignment.user_id=p_user_id
        AND assignment.company_id=p_company_id
        AND assignment.department_id=p_department_id
        AND assignment.status='ACTIVE'
    ) THEN
      RETURN false;
    END IF;
  ELSIF account_row.account_kind='SUPPLIER' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_memberships membership
      WHERE membership.user_id=p_user_id
        AND membership.supplier_id=p_supplier_id
        AND membership.status IN ('ACTIVE','INVITED')
    ) THEN
      RETURN false;
    END IF;
  ELSIF account_row.account_kind='DELIVERY'
    AND role_key IN ('DELIVERY_AGENT','DELIVERY_DRIVER') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.delivery_agent_profiles profile
      WHERE profile.user_id=p_user_id AND profile.active
    ) THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.axora_validate_role_assignment_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.role_id IS DISTINCT FROM OLD.role_id
      OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
      OR NEW.department_id IS DISTINCT FROM OLD.department_id
      OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
      OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
      OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at THEN
      RAISE EXCEPTION 'Role assignment identity is immutable; revoke and assign instead';
    END IF;
    IF NOT OLD.active AND NEW.active THEN
      RAISE EXCEPTION 'A revoked role assignment cannot be reactivated';
    END IF;
  END IF;

  IF NEW.active AND NOT public.axora_role_assignment_target_is_ready(
    NEW.user_id,NEW.role_id,NEW.scope_type,
    NEW.company_id,NEW.branch_id,NEW.department_id,NEW.supplier_id
  ) THEN
    RAISE EXCEPTION 'The role assignment target or scope is invalid';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_role_assignment_write
  ON public.role_assignments;
CREATE TRIGGER validate_role_assignment_write
BEFORE INSERT OR UPDATE ON public.role_assignments
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_role_assignment_write();

CREATE OR REPLACE FUNCTION public.axora_reject_role_assignment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Role assignments are append-only; revoke instead';
END $$;

DROP TRIGGER IF EXISTS reject_role_assignment_delete
  ON public.role_assignments;
CREATE TRIGGER reject_role_assignment_delete
BEFORE DELETE ON public.role_assignments
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_role_assignment_delete();

CREATE OR REPLACE FUNCTION public.axora_active_platform_owner_count(
  p_excluded_user_id uuid DEFAULT NULL,
  p_excluded_assignment_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT count(DISTINCT account.id)::integer
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.user_id=account.id
   AND assignment.active AND assignment.revoked_at IS NULL
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE account.active
    AND account.account_status='ACTIVE'
    AND account.account_setup_completed_at IS NOT NULL
    AND account.account_kind='PLATFORM'
    AND account.is_owner
    AND assignment.scope_type='PLATFORM'
    AND role.role_key IN ('PLATFORM_OWNER','ADMIN')
    AND (p_excluded_user_id IS NULL OR account.id<>p_excluded_user_id)
    AND (
      p_excluded_assignment_id IS NULL
      OR assignment.id<>p_excluded_assignment_id
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_active_company_admin_count(
  p_company_id uuid,
  p_excluded_user_id uuid DEFAULT NULL,
  p_excluded_assignment_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT count(DISTINCT account.id)::integer
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.user_id=account.id
   AND assignment.active AND assignment.revoked_at IS NULL
  JOIN public.roles role ON role.id=assignment.role_id
  JOIN public.company_memberships membership
    ON membership.user_id=account.id
   AND membership.company_id=assignment.company_id
   AND membership.status='ACTIVE'
  WHERE account.active
    AND account.account_status='ACTIVE'
    AND account.account_setup_completed_at IS NOT NULL
    AND account.account_kind='COMPANY'
    AND assignment.scope_type='COMPANY'
    AND assignment.company_id=p_company_id
    AND role.role_key IN ('COMPANY_ADMIN','ADMIN')
    AND (p_excluded_user_id IS NULL OR account.id<>p_excluded_user_id)
    AND (
      p_excluded_assignment_id IS NULL
      OR assignment.id<>p_excluded_assignment_id
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_protect_critical_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  role_key text;
BEGIN
  IF NOT OLD.active OR NEW.active THEN
    RETURN NEW;
  END IF;

  SELECT role.role_key INTO role_key
  FROM public.roles role WHERE role.id=OLD.role_id;

  IF role_key IN ('PLATFORM_OWNER','ADMIN')
    AND OLD.scope_type='PLATFORM' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('axora-critical-platform-owner',0)
    );
    IF public.axora_active_platform_owner_count(NULL,OLD.id)<1 THEN
      RAISE EXCEPTION 'The last active Platform Owner cannot be revoked';
    END IF;
  END IF;

  IF role_key IN ('COMPANY_ADMIN','ADMIN')
    AND OLD.scope_type='COMPANY' AND OLD.company_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('axora-critical-company-admin:' || OLD.company_id::text,0)
    );
    IF public.axora_active_company_admin_count(
      OLD.company_id,NULL,OLD.id
    )<1 THEN
      RAISE EXCEPTION 'The last active Company Administrator cannot be revoked';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_critical_role_assignment
  ON public.role_assignments;
CREATE TRIGGER protect_critical_role_assignment
BEFORE UPDATE OF active,revoked_at ON public.role_assignments
FOR EACH ROW
WHEN (OLD.active AND NOT NEW.active)
EXECUTE FUNCTION public.axora_protect_critical_role_assignment();

CREATE OR REPLACE FUNCTION public.axora_protect_critical_account_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  company_scope record;
  loses_active_identity boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.is_owner OR EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      JOIN public.roles role ON role.id=assignment.role_id
      WHERE assignment.user_id=OLD.id
        AND role.role_key IN ('PLATFORM_OWNER')
    ) THEN
      RAISE EXCEPTION 'Platform Owner accounts are retained for audit and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  loses_active_identity := (
    OLD.active AND OLD.account_status='ACTIVE'
    AND OLD.account_setup_completed_at IS NOT NULL
  ) AND NOT (
    NEW.active AND NEW.account_status='ACTIVE'
    AND NEW.account_setup_completed_at IS NOT NULL
  );

  IF (loses_active_identity OR (OLD.is_owner AND NOT NEW.is_owner)
      OR OLD.account_kind IS DISTINCT FROM NEW.account_kind)
    AND EXISTS (
      SELECT 1
      FROM public.role_assignments assignment
      JOIN public.roles role ON role.id=assignment.role_id
      WHERE assignment.user_id=OLD.id
        AND assignment.active AND assignment.revoked_at IS NULL
        AND assignment.scope_type='PLATFORM'
        AND role.role_key IN ('PLATFORM_OWNER','ADMIN')
    ) THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended('axora-critical-platform-owner',0)
    );
    IF public.axora_active_platform_owner_count(OLD.id,NULL)<1 THEN
      RAISE EXCEPTION 'The last active Platform Owner cannot be deactivated';
    END IF;
  END IF;

  IF loses_active_identity
    OR OLD.account_kind IS DISTINCT FROM NEW.account_kind THEN
    FOR company_scope IN
      SELECT DISTINCT assignment.company_id
      FROM public.role_assignments assignment
      JOIN public.roles role ON role.id=assignment.role_id
      WHERE assignment.user_id=OLD.id
        AND assignment.active AND assignment.revoked_at IS NULL
        AND assignment.scope_type='COMPANY'
        AND assignment.company_id IS NOT NULL
        AND role.role_key IN ('COMPANY_ADMIN','ADMIN')
    LOOP
      PERFORM pg_advisory_xact_lock(
        hashtextextended(
          'axora-critical-company-admin:' || company_scope.company_id::text,0
        )
      );
      IF public.axora_active_company_admin_count(
        company_scope.company_id,OLD.id,NULL
      )<1 THEN
        RAISE EXCEPTION 'The last active Company Administrator cannot be deactivated';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_critical_account_state
  ON public.users;
CREATE TRIGGER protect_critical_account_state
BEFORE UPDATE OF
  active,account_status,account_setup_completed_at,is_owner,account_kind
OR DELETE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_critical_account_state();

CREATE OR REPLACE FUNCTION public.axora_apply_preferred_role_assignment(
  p_user_id uuid,
  p_assignment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  selected_role_id uuid;
  selected_scope_type text;
  selected_company_id uuid;
  selected_branch_id uuid;
  selected_role_key text;
  selected_account_kind text;
BEGIN
  SELECT
    assignment.role_id,
    assignment.scope_type,
    assignment.company_id,
    assignment.branch_id,
    role.role_key,
    account.account_kind
  INTO
    selected_role_id,
    selected_scope_type,
    selected_company_id,
    selected_branch_id,
    selected_role_key,
    selected_account_kind
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id=assignment.role_id
  JOIN public.users account ON account.id=assignment.user_id
  WHERE assignment.id=p_assignment_id
    AND assignment.user_id=p_user_id
    AND assignment.active AND assignment.revoked_at IS NULL;

  IF selected_role_id IS NULL THEN
    RAISE EXCEPTION 'The preferred role assignment is unavailable';
  END IF;

  UPDATE public.users account
  SET role_id=selected_role_id,
      is_owner=(
        selected_account_kind='PLATFORM'
        AND selected_role_key IN ('PLATFORM_OWNER','ADMIN')
      ),
      company_id=CASE
        WHEN selected_account_kind='COMPANY' THEN selected_company_id
        ELSE NULL
      END,
      branch_id=CASE
        WHEN selected_account_kind='COMPANY'
          AND selected_scope_type IN ('BRANCH','DEPARTMENT')
        THEN selected_branch_id
        ELSE NULL
      END
  WHERE account.id=p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.axora_refresh_preferred_role_assignment(
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  next_assignment_id uuid;
BEGIN
  SELECT assignment.id INTO next_assignment_id
  FROM public.role_assignments assignment
  WHERE assignment.user_id=p_user_id
    AND assignment.active AND assignment.revoked_at IS NULL
  ORDER BY assignment.assigned_at DESC,assignment.id
  LIMIT 1;

  IF next_assignment_id IS NULL THEN
    UPDATE public.users account
    SET is_owner=false
    WHERE account.id=p_user_id;
    RETURN;
  END IF;

  PERFORM public.axora_apply_preferred_role_assignment(
    p_user_id,next_assignment_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_assign_user_role_scope(
  p_command_id uuid,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_role_key text,
  p_scope_type text,
  p_company_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(
  role_assignment_id uuid,
  auth_version integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  actor_role_key text;
  target_account_kind text;
  target_is_owner boolean;
  target_current_role_id uuid;
  target_current_company_id uuid;
  target_current_branch_id uuid;
  target_auth_version integer;
  selected_role_id uuid;
  existing_command public.permission_change_history%ROWTYPE;
  existing_assignment_id uuid;
  previous_identity jsonb;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
  prospective_owner boolean;
  expected_company_id uuid;
  expected_branch_id uuid;
BEGIN
  IF p_command_id IS NULL OR p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'The role-assignment authorization context is incomplete';
  END IF;
  IF p_actor_user_id=p_target_user_id THEN
    RAISE EXCEPTION 'Users cannot change their own role assignment';
  END IF;
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500
    OR clean_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;

  SELECT history.* INTO existing_command
  FROM public.permission_change_history history
  WHERE history.correlation_id=p_command_id
    AND history.change_type IN ('ROLE_ASSIGNED','ROLE_REVOKED')
  FOR SHARE;
  IF existing_command.id IS NOT NULL THEN
    IF existing_command.change_type='ROLE_ASSIGNED'
      AND existing_command.target_user_id=p_target_user_id
      AND existing_command.new_value->>'roleKey'=p_role_key
      AND existing_command.new_value->>'scopeType'=p_scope_type
      AND NULLIF(existing_command.new_value->>'companyId','')::uuid
        IS NOT DISTINCT FROM p_company_id
      AND NULLIF(existing_command.new_value->>'branchId','')::uuid
        IS NOT DISTINCT FROM p_branch_id
      AND NULLIF(existing_command.new_value->>'departmentId','')::uuid
        IS NOT DISTINCT FROM p_department_id
      AND NULLIF(existing_command.new_value->>'supplierId','')::uuid
        IS NOT DISTINCT FROM p_supplier_id
      AND existing_command.reason=clean_reason THEN
      RETURN QUERY SELECT
        (existing_command.new_value->>'assignmentId')::uuid,
        (SELECT account.auth_version FROM public.users account
         WHERE account.id=p_target_user_id),
        0,false;
      RETURN;
    END IF;
    RAISE EXCEPTION 'The role-assignment command ID conflicts with another request';
  END IF;

  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,p_target_user_id)
  ORDER BY account.id
  FOR UPDATE;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,now()
  );
  IF actor_snapshot IS NULL THEN
    RAISE EXCEPTION 'The actor authorization context is no longer active';
  END IF;
  actor_role_key:=actor_snapshot->>'roleKey';
  IF actor_role_key='ADMIN' THEN
    actor_role_key:=CASE
      WHEN COALESCE((actor_snapshot->>'isOwner')::boolean,false)
        THEN 'PLATFORM_OWNER'
      ELSE 'COMPANY_ADMIN'
    END;
  END IF;

  SELECT
    account.account_kind,
    account.is_owner,
    account.role_id,
    account.company_id,
    account.branch_id,
    account.auth_version
  INTO
    target_account_kind,
    target_is_owner,
    target_current_role_id,
    target_current_company_id,
    target_current_branch_id,
    target_auth_version
  FROM public.users account
  WHERE account.id=p_target_user_id
    AND account.active
    AND account.account_status='ACTIVE'
    AND account.account_setup_completed_at IS NOT NULL;
  IF target_account_kind IS NULL THEN
    RAISE EXCEPTION 'The target account is not active and fully established';
  END IF;

  SELECT role.id INTO selected_role_id
  FROM public.roles role
  WHERE role.role_key=p_role_key
    AND role.role_key IN (
      'PLATFORM_OWNER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT',
      'CLIENT_ACCOUNT_MANAGER','COMPANY_ADMIN','BRANCH_ADMIN',
      'DEPARTMENT_ADMIN','COMPANY_APPROVER','BRANCH_APPROVER','REQUESTER',
      'FINANCE_REVIEWER','AUDITOR','RECEIVING_USER','SUPPLIER_USER',
      'DELIVERY_TEAM_SUPERVISOR','DELIVERY_AGENT','DELIVERY_DRIVER'
    )
  FOR KEY SHARE;
  IF selected_role_id IS NULL THEN
    RAISE EXCEPTION 'The selected canonical role is unavailable';
  END IF;

  prospective_owner:=p_role_key='PLATFORM_OWNER';
  IF target_is_owner AND NOT prospective_owner THEN
    RAISE EXCEPTION 'Revoke the current Platform Owner assignment before assigning a non-owner role';
  END IF;
  IF NOT public.axora_role_scope_contract_is_valid(
    target_account_kind,prospective_owner,p_role_key,
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) OR NOT public.axora_role_scope_resource_is_active(
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RAISE EXCEPTION 'The selected role does not fit the account or scope';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignment_management_rules rule
    JOIN public.roles manager_role ON manager_role.id=rule.manager_role_id
    WHERE manager_role.role_key=actor_role_key
      AND rule.target_role_id=selected_role_id
      AND rule.scope_type=p_scope_type
  ) THEN
    RAISE EXCEPTION 'The actor role cannot assign this role and scope';
  END IF;
  IF NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',
    p_scope_type,p_company_id,p_branch_id,p_department_id,p_supplier_id
  ) THEN
    RAISE EXCEPTION 'The actor cannot manage role assignments in this scope';
  END IF;

  IF target_account_kind='COMPANY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.company_memberships membership
      WHERE membership.user_id=p_target_user_id
        AND membership.company_id=p_company_id
        AND membership.status='ACTIVE'
    ) THEN
      RAISE EXCEPTION 'The target account does not belong to the requested company';
    END IF;
    IF p_scope_type='BRANCH' THEN
      INSERT INTO public.branch_assignments(
        user_id,company_id,branch_id,status,is_primary,created_by
      ) VALUES (
        p_target_user_id,p_company_id,p_branch_id,'ACTIVE',false,p_actor_user_id
      )
      ON CONFLICT(user_id,branch_id) DO UPDATE
      SET company_id=EXCLUDED.company_id,status='ACTIVE',ended_at=NULL;
    END IF;
    IF p_scope_type='DEPARTMENT'
      AND NOT EXISTS (
        SELECT 1 FROM public.department_assignments assignment
        WHERE assignment.user_id=p_target_user_id
          AND assignment.department_id=p_department_id
          AND assignment.status='ACTIVE'
      ) THEN
      INSERT INTO public.department_assignments(
        user_id,company_id,department_id,status,is_primary,assigned_by
      ) VALUES (
        p_target_user_id,p_company_id,p_department_id,
        'ACTIVE',false,p_actor_user_id
      );
    END IF;
  ELSIF target_account_kind='SUPPLIER' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_memberships membership
      WHERE membership.user_id=p_target_user_id
        AND membership.supplier_id=p_supplier_id
        AND membership.status='ACTIVE'
    ) THEN
      RAISE EXCEPTION 'The target account does not belong to the requested supplier';
    END IF;
  ELSIF target_account_kind='DELIVERY'
    AND p_role_key IN ('DELIVERY_AGENT','DELIVERY_DRIVER')
    AND NOT EXISTS (
      SELECT 1 FROM public.delivery_agent_profiles profile
      WHERE profile.user_id=p_target_user_id AND profile.active
    ) THEN
    RAISE EXCEPTION 'The target delivery agent profile is not active';
  END IF;

  expected_company_id:=CASE
    WHEN target_account_kind='COMPANY' THEN p_company_id
    ELSE NULL
  END;
  expected_branch_id:=CASE
    WHEN target_account_kind='COMPANY'
      AND p_scope_type IN ('BRANCH','DEPARTMENT') THEN p_branch_id
    ELSE NULL
  END;
  previous_identity:=jsonb_strip_nulls(jsonb_build_object(
    'roleId',target_current_role_id,
    'companyId',target_current_company_id,
    'branchId',target_current_branch_id,
    'isOwner',target_is_owner
  ));

  IF prospective_owner AND NOT target_is_owner THEN
    UPDATE public.users account
    SET is_owner=true,role_id=selected_role_id,
        company_id=NULL,branch_id=NULL
    WHERE account.id=p_target_user_id;
  END IF;

  SELECT assignment.id INTO existing_assignment_id
  FROM public.role_assignments assignment
  WHERE assignment.user_id=p_target_user_id
    AND assignment.role_id=selected_role_id
    AND assignment.scope_type=p_scope_type
    AND assignment.company_id IS NOT DISTINCT FROM p_company_id
    AND assignment.branch_id IS NOT DISTINCT FROM p_branch_id
    AND assignment.department_id IS NOT DISTINCT FROM p_department_id
    AND assignment.supplier_id IS NOT DISTINCT FROM p_supplier_id
    AND assignment.active
  FOR UPDATE;

  IF existing_assignment_id IS NOT NULL
    AND target_current_role_id=selected_role_id
    AND target_is_owner=prospective_owner
    AND target_current_company_id IS NOT DISTINCT FROM expected_company_id
    AND target_current_branch_id IS NOT DISTINCT FROM expected_branch_id THEN
    RETURN QUERY SELECT existing_assignment_id,target_auth_version,0,false;
    RETURN;
  END IF;

  IF existing_assignment_id IS NULL THEN
    INSERT INTO public.role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,department_id,
      supplier_id,active,assigned_by,assigned_at,revoked_at,
      revoked_by,revoke_reason
    ) VALUES (
      p_command_id,p_target_user_id,selected_role_id,p_scope_type,
      p_company_id,p_branch_id,p_department_id,p_supplier_id,
      true,p_actor_user_id,now(),NULL,NULL,NULL
    ) RETURNING id INTO existing_assignment_id;
  END IF;

  PERFORM public.axora_apply_preferred_role_assignment(
    p_target_user_id,existing_assignment_id
  );

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,change_type,
    previous_value,new_value,reason,correlation_id
  ) VALUES (
    p_actor_user_id,p_target_user_id,'ROLE_ASSIGNED',
    previous_identity,
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',existing_assignment_id,
      'roleId',selected_role_id,
      'roleKey',p_role_key,
      'scopeType',p_scope_type,
      'companyId',p_company_id,
      'branchId',p_branch_id,
      'departmentId',p_department_id,
      'supplierId',p_supplier_id,
      'preferred',true
    )),
    clean_reason,p_command_id
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    p_target_user_id,p_actor_user_id,
    'Role or scope assigned: ' || clean_reason
  );
  RETURN QUERY SELECT existing_assignment_id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END;
$$;

CREATE OR REPLACE FUNCTION public.axora_revoke_user_role_scope(
  p_command_id uuid,
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_role_assignment_id uuid,
  p_reason text
)
RETURNS TABLE(
  role_assignment_id uuid,
  auth_version integer,
  revoked_sessions integer,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  actor_role_key text;
  assignment_user_id uuid;
  assignment_role_id uuid;
  assignment_scope_type text;
  assignment_company_id uuid;
  assignment_branch_id uuid;
  assignment_department_id uuid;
  assignment_supplier_id uuid;
  assignment_active boolean;
  target_auth_version integer;
  revoked_role_key text;
  existing_command public.permission_change_history%ROWTYPE;
  invalidation record;
  clean_reason text:=btrim(COALESCE(p_reason,''));
BEGIN
  IF p_command_id IS NULL OR p_actor_user_id IS NULL
    OR p_actor_role_assignment_id IS NULL
    OR p_target_role_assignment_id IS NULL THEN
    RAISE EXCEPTION 'The role-revocation authorization context is incomplete';
  END IF;
  IF char_length(clean_reason) NOT BETWEEN 3 AND 500
    OR clean_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required';
  END IF;

  SELECT history.* INTO existing_command
  FROM public.permission_change_history history
  WHERE history.correlation_id=p_command_id
    AND history.change_type IN ('ROLE_ASSIGNED','ROLE_REVOKED')
  FOR SHARE;
  IF existing_command.id IS NOT NULL THEN
    IF existing_command.change_type='ROLE_REVOKED'
      AND existing_command.previous_value->>'assignmentId'
        =p_target_role_assignment_id::text
      AND existing_command.reason=clean_reason THEN
      RETURN QUERY SELECT p_target_role_assignment_id,
        (SELECT account.auth_version FROM public.users account
         WHERE account.id=existing_command.target_user_id),
        0,false;
      RETURN;
    END IF;
    RAISE EXCEPTION 'The role-revocation command ID conflicts with another request';
  END IF;

  SELECT
    assignment.user_id,
    assignment.role_id,
    assignment.scope_type,
    assignment.company_id,
    assignment.branch_id,
    assignment.department_id,
    assignment.supplier_id,
    assignment.active,
    account.auth_version,
    role.role_key
  INTO
    assignment_user_id,
    assignment_role_id,
    assignment_scope_type,
    assignment_company_id,
    assignment_branch_id,
    assignment_department_id,
    assignment_supplier_id,
    assignment_active,
    target_auth_version,
    revoked_role_key
  FROM public.role_assignments assignment
  JOIN public.users account ON account.id=assignment.user_id
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE assignment.id=p_target_role_assignment_id
  FOR UPDATE OF assignment,account;

  IF assignment_user_id IS NULL THEN
    RAISE EXCEPTION 'The selected role assignment is unavailable';
  END IF;
  IF assignment_user_id=p_actor_user_id THEN
    RAISE EXCEPTION 'Users cannot revoke their own role assignment';
  END IF;
  IF NOT assignment_active THEN
    RETURN QUERY SELECT p_target_role_assignment_id,target_auth_version,0,false;
    RETURN;
  END IF;

  actor_snapshot:=public.axora_effective_access_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,now()
  );
  IF actor_snapshot IS NULL THEN
    RAISE EXCEPTION 'The actor authorization context is no longer active';
  END IF;
  actor_role_key:=actor_snapshot->>'roleKey';
  IF actor_role_key='ADMIN' THEN
    actor_role_key:=CASE
      WHEN COALESCE((actor_snapshot->>'isOwner')::boolean,false)
        THEN 'PLATFORM_OWNER'
      ELSE 'COMPANY_ADMIN'
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignment_management_rules rule
    JOIN public.roles manager_role ON manager_role.id=rule.manager_role_id
    WHERE manager_role.role_key=actor_role_key
      AND rule.target_role_id=assignment_role_id
      AND rule.scope_type=assignment_scope_type
  ) THEN
    RAISE EXCEPTION 'The actor role cannot revoke this role and scope';
  END IF;
  IF NOT public.axora_snapshot_has_permission(
    actor_snapshot,'user.permission.manage',
    assignment_scope_type,assignment_company_id,
    assignment_branch_id,assignment_department_id,
    assignment_supplier_id
  ) THEN
    RAISE EXCEPTION 'The actor cannot manage role assignments in this scope';
  END IF;

  UPDATE public.role_assignments assignment
  SET active=false,revoked_at=now(),revoked_by=p_actor_user_id,
      revoke_reason=clean_reason
  WHERE assignment.id=p_target_role_assignment_id;

  INSERT INTO public.permission_change_history(
    actor_user_id,target_user_id,change_type,
    previous_value,new_value,reason,correlation_id
  ) VALUES (
    p_actor_user_id,assignment_user_id,'ROLE_REVOKED',
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',p_target_role_assignment_id,
      'roleId',assignment_role_id,
      'roleKey',revoked_role_key,
      'scopeType',assignment_scope_type,
      'companyId',assignment_company_id,
      'branchId',assignment_branch_id,
      'departmentId',assignment_department_id,
      'supplierId',assignment_supplier_id,
      'active',true
    )),
    jsonb_build_object('active',false,'revokedAt',now()),
    clean_reason,p_command_id
  );

  PERFORM public.axora_refresh_preferred_role_assignment(
    assignment_user_id
  );

  SELECT * INTO invalidation
  FROM public.axora_invalidate_authorization_sessions(
    assignment_user_id,p_actor_user_id,
    'Role or scope revoked: ' || clean_reason
  );
  RETURN QUERY SELECT p_target_role_assignment_id,invalidation.auth_version,
    invalidation.revoked_sessions,true;
END;
$$;

REVOKE ALL ON TABLE public.role_assignment_management_rules FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_role_scope_contract_is_valid(
  text,boolean,text,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_role_scope_resource_is_active(
  text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_role_assignment_target_is_ready(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_validate_role_assignment_write()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_reject_role_assignment_delete()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_active_platform_owner_count(uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_active_company_admin_count(uuid,uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_protect_critical_role_assignment()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_protect_critical_account_state()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_apply_preferred_role_assignment(uuid,uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_refresh_preferred_role_assignment(uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_assign_user_role_scope(
  uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_revoke_user_role_scope(
  uuid,uuid,uuid,uuid,text
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.role_assignment_management_rules
      FROM axora_app;
    REVOKE UPDATE,DELETE ON TABLE public.role_assignments FROM axora_app;
    GRANT SELECT,INSERT ON TABLE public.role_assignments TO axora_app;

    REVOKE ALL ON FUNCTION public.axora_role_scope_contract_is_valid(
      text,boolean,text,text,uuid,uuid,uuid,uuid
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_role_scope_resource_is_active(
      text,uuid,uuid,uuid,uuid
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_role_assignment_target_is_ready(
      uuid,uuid,text,uuid,uuid,uuid,uuid
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_validate_role_assignment_write()
      FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_reject_role_assignment_delete()
      FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_active_platform_owner_count(uuid,uuid)
      FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_active_company_admin_count(
      uuid,uuid,uuid
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_protect_critical_role_assignment()
      FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_protect_critical_account_state()
      FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_apply_preferred_role_assignment(
      uuid,uuid
    ) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_refresh_preferred_role_assignment(uuid)
      FROM axora_app;

    GRANT EXECUTE ON FUNCTION public.axora_assign_user_role_scope(
      uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,text
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_revoke_user_role_scope(
      uuid,uuid,uuid,uuid,text
    ) TO axora_app;
  END IF;
END $$;

COMMIT;
