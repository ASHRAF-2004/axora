BEGIN;

SELECT pg_advisory_xact_lock(97217731);

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Account invitation enforcement originally predated Human Resources
-- Management, platform-scoped Client Account Managers, Delivery Guy and
-- department-scoped identities. Align the trigger with the canonical creation
-- capability while preserving exact assignment binding and deny-by-default
-- creator authorization.
CREATE OR REPLACE FUNCTION public.enforce_account_setup_invitation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  target public.users%ROWTYPE;
  intended_role_key text;
  creator_snapshot jsonb;
BEGIN
  SELECT * INTO target
  FROM public.users
  WHERE id=NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account setup invitation user is unavailable';
  END IF;

  SELECT role.role_key INTO intended_role_key
  FROM public.roles role
  WHERE role.id=NEW.intended_role_id;
  IF intended_role_key IS NULL THEN
    RAISE EXCEPTION 'Account setup invitation role is unavailable';
  END IF;

  IF NEW.consumed_at IS NULL AND NEW.revoked_at IS NULL
    AND target.account_status<>'INVITED' THEN
    RAISE EXCEPTION
      'A live account setup invitation requires an invited account';
  END IF;
  IF NEW.consumed_at IS NOT NULL AND target.account_status<>'ACTIVE' THEN
    RAISE EXCEPTION
      'Consumed account setup invitation requires an active account';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id=target.id
      AND assignment.role_id=NEW.intended_role_id
      AND assignment.scope_type=NEW.intended_scope_type
      AND assignment.company_id IS NOT DISTINCT FROM NEW.company_id
      AND assignment.branch_id IS NOT DISTINCT FROM NEW.intended_branch_id
      AND assignment.department_id
        IS NOT DISTINCT FROM NEW.intended_department_id
      AND assignment.supplier_id
        IS NOT DISTINCT FROM NEW.intended_supplier_id
      AND assignment.active
      AND assignment.revoked_at IS NULL
  ) THEN
    -- Lifecycle updates for invitations created before canonical assignments
    -- were introduced retain the legacy-role fallback. Every new invitation
    -- must bind to one exact current assignment.
    IF TG_OP='INSERT'
      OR target.role_id IS DISTINCT FROM NEW.intended_role_id THEN
      RAISE EXCEPTION
        'Account setup invitation does not match its role assignment';
    END IF;
  END IF;

  IF TG_OP='INSERT' AND NOT (
    (
      NEW.intended_scope_type='PLATFORM'
      AND intended_role_key IN (
        'PLATFORM_OWNER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT',
        'HUMAN_RESOURCES_MANAGEMENT','CLIENT_ACCOUNT_MANAGER'
      )
    )
    OR (
      NEW.intended_scope_type='COMPANY'
      AND intended_role_key IN (
        'CLIENT_ACCOUNT_MANAGER','COMPANY_ADMIN','COMPANY_APPROVER',
        'FINANCE_REVIEWER','AUDITOR','RECEIVING_USER'
      )
    )
    OR (
      NEW.intended_scope_type='BRANCH'
      AND intended_role_key IN (
        'BRANCH_ADMIN','BRANCH_APPROVER','REQUESTER','FINANCE_REVIEWER',
        'AUDITOR','RECEIVING_USER'
      )
    )
    OR (
      NEW.intended_scope_type='DEPARTMENT'
      AND intended_role_key IN (
        'DEPARTMENT_ADMIN','REQUESTER','FINANCE_REVIEWER',
        'AUDITOR','RECEIVING_USER'
      )
    )
    OR (
      NEW.intended_scope_type='SUPPLIER'
      AND intended_role_key='SUPPLIER_USER'
    )
    OR (
      NEW.intended_scope_type='DELIVERY'
      AND intended_role_key IN (
        'DELIVERY_GUY','DELIVERY_TEAM_SUPERVISOR',
        'DELIVERY_AGENT','DELIVERY_DRIVER'
      )
    )
  ) THEN
    RAISE EXCEPTION
      'Account setup invitation role is incompatible with its scope';
  END IF;

  IF NEW.intended_scope_type='PLATFORM' THEN
    IF target.account_kind<>'PLATFORM'
      OR target.company_id IS NOT NULL
      OR target.branch_id IS NOT NULL
      OR NEW.company_id IS NOT NULL
      OR NEW.intended_branch_id IS NOT NULL
      OR NEW.intended_department_id IS NOT NULL
      OR NEW.intended_supplier_id IS NOT NULL
      OR intended_role_key NOT IN (
        'PLATFORM_OWNER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT',
        'HUMAN_RESOURCES_MANAGEMENT','CLIENT_ACCOUNT_MANAGER'
      )
      OR target.is_owner
        IS DISTINCT FROM (intended_role_key='PLATFORM_OWNER') THEN
      RAISE EXCEPTION 'Platform setup invitation scope is invalid';
    END IF;
  ELSIF NEW.intended_scope_type='COMPANY' THEN
    IF target.account_kind NOT IN ('COMPANY','PLATFORM')
      OR target.is_owner
      OR target.company_id IS DISTINCT FROM NEW.company_id
      OR target.branch_id IS NOT NULL
      OR NEW.intended_branch_id IS NOT NULL
      OR NEW.intended_department_id IS NOT NULL
      OR NEW.intended_supplier_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.companies company
        WHERE company.id=NEW.company_id AND company.active
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.company_memberships membership
        WHERE membership.user_id=target.id
          AND membership.company_id=NEW.company_id
          AND membership.status IN ('INVITED','ACTIVE')
      ) THEN
      RAISE EXCEPTION 'Company setup invitation scope is invalid';
    END IF;
  ELSIF NEW.intended_scope_type='BRANCH' THEN
    IF target.account_kind<>'COMPANY'
      OR target.is_owner
      OR target.company_id IS DISTINCT FROM NEW.company_id
      OR target.branch_id IS DISTINCT FROM NEW.intended_branch_id
      OR NEW.intended_department_id IS NOT NULL
      OR NEW.intended_supplier_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.companies company
        WHERE company.id=NEW.company_id AND company.active
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.company_memberships membership
        WHERE membership.user_id=target.id
          AND membership.company_id=NEW.company_id
          AND membership.status IN ('INVITED','ACTIVE')
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.branches branch
        JOIN public.branch_assignments assignment
          ON assignment.branch_id=branch.id
         AND assignment.company_id=branch.company_id
        WHERE branch.id=NEW.intended_branch_id
          AND branch.company_id=NEW.company_id
          AND branch.active
          AND assignment.user_id=target.id
          AND assignment.status='ACTIVE'
      ) THEN
      RAISE EXCEPTION 'Branch setup invitation scope is invalid';
    END IF;
  ELSIF NEW.intended_scope_type='DEPARTMENT' THEN
    IF target.account_kind<>'COMPANY'
      OR target.is_owner
      OR target.company_id IS DISTINCT FROM NEW.company_id
      OR target.branch_id IS DISTINCT FROM NEW.intended_branch_id
      OR NEW.intended_department_id IS NULL
      OR NEW.intended_supplier_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.companies company
        WHERE company.id=NEW.company_id AND company.active
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.company_memberships membership
        WHERE membership.user_id=target.id
          AND membership.company_id=NEW.company_id
          AND membership.status IN ('INVITED','ACTIVE')
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.departments department
        JOIN public.department_assignments assignment
          ON assignment.department_id=department.id
         AND assignment.company_id=department.company_id
        WHERE department.id=NEW.intended_department_id
          AND department.company_id=NEW.company_id
          AND department.branch_id
            IS NOT DISTINCT FROM NEW.intended_branch_id
          AND department.active
          AND assignment.user_id=target.id
          AND assignment.status='ACTIVE'
      ) THEN
      RAISE EXCEPTION 'Department setup invitation scope is invalid';
    END IF;
  ELSIF NEW.intended_scope_type='SUPPLIER' THEN
    IF target.account_kind<>'SUPPLIER'
      OR target.is_owner
      OR target.company_id IS NOT NULL
      OR target.branch_id IS NOT NULL
      OR NEW.company_id IS NOT NULL
      OR NEW.intended_branch_id IS NOT NULL
      OR NEW.intended_department_id IS NOT NULL
      OR intended_role_key<>'SUPPLIER_USER'
      OR NOT EXISTS (
        SELECT 1
        FROM public.suppliers supplier
        JOIN public.supplier_memberships membership
          ON membership.supplier_id=supplier.id
        WHERE supplier.id=NEW.intended_supplier_id
          AND supplier.active
          AND membership.user_id=target.id
          AND membership.status IN ('INVITED','ACTIVE')
      ) THEN
      RAISE EXCEPTION 'Supplier setup invitation scope is invalid';
    END IF;
  ELSIF NEW.intended_scope_type='DELIVERY' THEN
    IF target.account_kind<>'DELIVERY'
      OR target.is_owner
      OR target.company_id IS NOT NULL
      OR target.branch_id IS NOT NULL
      OR NEW.company_id IS NOT NULL
      OR NEW.intended_branch_id IS NOT NULL
      OR NEW.intended_department_id IS NOT NULL
      OR NEW.intended_supplier_id IS NOT NULL
      OR intended_role_key NOT IN (
        'DELIVERY_GUY','DELIVERY_TEAM_SUPERVISOR',
        'DELIVERY_AGENT','DELIVERY_DRIVER'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.delivery_agent_profiles profile
        WHERE profile.user_id=target.id AND profile.active
      ) THEN
      RAISE EXCEPTION 'Delivery setup invitation scope is invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'Account setup invitation scope is invalid';
  END IF;

  IF NEW.created_by IS NULL THEN
    IF intended_role_key<>'PLATFORM_OWNER' THEN
      IF TG_OP='INSERT' THEN
        RAISE EXCEPTION
          'Only first-owner bootstrap may omit the invitation creator';
      ELSIF OLD.created_by IS NOT NULL THEN
        RAISE EXCEPTION
          'Account setup invitation creator cannot be cleared';
      END IF;
    END IF;
  ELSIF TG_OP='INSERT' THEN
    SELECT snapshot.value INTO creator_snapshot
    FROM public.users creator
    JOIN public.role_assignments assignment
      ON assignment.user_id=creator.id
     AND assignment.active
     AND assignment.revoked_at IS NULL
    JOIN public.role_assignment_management_rules management_rule
      ON management_rule.manager_role_id=assignment.role_id
     AND management_rule.target_role_id=NEW.intended_role_id
     AND management_rule.scope_type=NEW.intended_scope_type
    CROSS JOIN LATERAL (
      SELECT public.axora_live_authorization_snapshot(
        creator.id,assignment.id,NEW.created_at
      ) AS value
    ) snapshot
    WHERE creator.id=NEW.created_by
      AND creator.active
      AND creator.account_status='ACTIVE'
      AND snapshot.value IS NOT NULL
      AND public.axora_snapshot_has_permission(
        snapshot.value,'user.create',NEW.intended_scope_type,
        NEW.company_id,NEW.intended_branch_id,
        NEW.intended_department_id,NEW.intended_supplier_id
      )
      AND public.axora_snapshot_has_permission(
        snapshot.value,'user.invite',NEW.intended_scope_type,
        NEW.company_id,NEW.intended_branch_id,
        NEW.intended_department_id,NEW.intended_supplier_id
      )
    ORDER BY assignment.assigned_at DESC,assignment.id DESC
    LIMIT 1;

    IF creator_snapshot IS NULL THEN
      RAISE EXCEPTION
        'Account setup invitation creator is outside the permitted account scope';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enforce_account_setup_invitation_scope()
FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION public.enforce_account_setup_invitation_scope()
    FROM axora_app;
  END IF;
END
$$;

COMMIT;
