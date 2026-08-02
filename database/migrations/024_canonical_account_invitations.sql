BEGIN;

-- Invitations are bound to the normalized role assignment that will become
-- active after setup.  Company, supplier, delivery, and Axora platform
-- accounts all use the same one-time-password-creation lifecycle.
-- Drop the deferred 021 audit trigger before the data backfill. Otherwise an
-- existing invitation queues a deferred event and PostgreSQL refuses the
-- subsequent ALTER TABLE statements in this transaction. The canonical
-- replacement is recreated below before commit.
DROP TRIGGER IF EXISTS require_platform_owner_bootstrap_audit_trigger
  ON account_setup_invitations;

ALTER TABLE account_setup_invitations
  ADD COLUMN IF NOT EXISTS intended_scope_type text,
  ADD COLUMN IF NOT EXISTS intended_supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT;

-- The previous expand-phase trigger intentionally froze legacy role IDs. Drop
-- it only inside this migration transaction while those IDs are normalized;
-- stricter immutable-scope and eligibility triggers are recreated below.
DROP TRIGGER IF EXISTS protect_account_setup_invitation_scope_trigger
  ON account_setup_invitations;
DROP TRIGGER IF EXISTS enforce_account_setup_invitation_scope_trigger
  ON account_setup_invitations;

-- Expand/contract compatibility: invitations issued against legacy roles are
-- rebound to the normalized assignment created by migration 016. This also
-- corrects legacy company/branch columns (for example IT_SUPPORT becoming a
-- company-less TECHNICAL_SUPPORT account) before strict constraints land.
UPDATE account_setup_invitations invitation
SET intended_role_id=assignment.role_id,
    intended_scope_type=assignment.scope_type,
    company_id=assignment.company_id,
    intended_branch_id=assignment.branch_id,
    intended_supplier_id=assignment.supplier_id
FROM role_assignments assignment
JOIN roles assigned_role ON assigned_role.id=assignment.role_id
JOIN users target ON target.id=assignment.user_id
JOIN roles legacy_role ON legacy_role.id=target.role_id
WHERE assignment.user_id=invitation.user_id
  AND assignment.active=true
  AND assigned_role.role_key=CASE
    WHEN target.is_owner THEN 'PLATFORM_OWNER'
    WHEN legacy_role.role_key='ADMIN' THEN 'COMPANY_ADMIN'
    WHEN legacy_role.role_key='APPROVER' AND target.branch_id IS NULL
      THEN 'COMPANY_APPROVER'
    WHEN legacy_role.role_key='APPROVER' THEN 'BRANCH_APPROVER'
    WHEN legacy_role.role_key='FINANCE' THEN 'FINANCE_REVIEWER'
    WHEN legacy_role.role_key='VIEWER' THEN 'AUDITOR'
    WHEN legacy_role.role_key='IT_SUPPORT' THEN 'TECHNICAL_SUPPORT'
    WHEN legacy_role.role_key='OPERATIONS' THEN 'REQUESTER'
    ELSE legacy_role.role_key
  END;

UPDATE account_setup_invitations invitation
SET intended_scope_type=COALESCE(
  (
    SELECT assignment.scope_type
    FROM role_assignments assignment
    WHERE assignment.user_id=invitation.user_id
      AND assignment.active=true
      AND (
        assignment.role_id=invitation.intended_role_id
        OR invitation.intended_role_id IS NULL
      )
    ORDER BY assignment.assigned_at DESC,assignment.id
    LIMIT 1
  ),
  CASE
    WHEN invitation.company_id IS NULL THEN 'PLATFORM'
    WHEN invitation.intended_branch_id IS NOT NULL THEN 'BRANCH'
    ELSE 'COMPANY'
  END
)
WHERE intended_scope_type IS NULL;

UPDATE account_setup_invitations invitation
SET intended_supplier_id=(
  SELECT assignment.supplier_id
  FROM role_assignments assignment
  WHERE assignment.user_id=invitation.user_id
    AND assignment.active=true
    AND assignment.scope_type='SUPPLIER'
  ORDER BY assignment.assigned_at DESC,assignment.id
  LIMIT 1
)
WHERE intended_scope_type='SUPPLIER' AND intended_supplier_id IS NULL;

-- Invitations issued before normalized assignments existed may still point at
-- ADMIN/APPROVER/FINANCE/VIEWER/IT_SUPPORT. Bind those rows to the exact active
-- assignment selected by the migrated scope so the application can use one
-- fail-closed eligibility query for both old and new links.
UPDATE account_setup_invitations invitation
SET intended_role_id=(
  SELECT assignment.role_id
  FROM role_assignments assignment
  WHERE assignment.user_id=invitation.user_id
    AND assignment.active=true
    AND assignment.scope_type=invitation.intended_scope_type
    AND assignment.company_id IS NOT DISTINCT FROM invitation.company_id
    AND assignment.branch_id IS NOT DISTINCT FROM invitation.intended_branch_id
    AND assignment.supplier_id IS NOT DISTINCT FROM invitation.intended_supplier_id
  ORDER BY assignment.assigned_at DESC,assignment.id
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM role_assignments assignment
  WHERE assignment.user_id=invitation.user_id
    AND assignment.active=true
    AND assignment.scope_type=invitation.intended_scope_type
    AND assignment.company_id IS NOT DISTINCT FROM invitation.company_id
    AND assignment.branch_id IS NOT DISTINCT FROM invitation.intended_branch_id
    AND assignment.supplier_id IS NOT DISTINCT FROM invitation.intended_supplier_id
    AND assignment.role_id IS DISTINCT FROM invitation.intended_role_id
);

ALTER TABLE account_setup_invitations
  ALTER COLUMN intended_role_id SET NOT NULL,
  ALTER COLUMN intended_scope_type SET NOT NULL;
ALTER TABLE account_setup_invitations
  DROP CONSTRAINT IF EXISTS account_setup_invitation_scope_type_check;
ALTER TABLE account_setup_invitations
  ADD CONSTRAINT account_setup_invitation_scope_type_check CHECK (
    intended_scope_type IN ('PLATFORM','COMPANY','BRANCH','SUPPLIER','DELIVERY')
  );

ALTER TABLE account_setup_invitations
  DROP CONSTRAINT IF EXISTS account_setup_invitation_platform_scope_check;
ALTER TABLE account_setup_invitations
  ADD CONSTRAINT account_setup_invitation_platform_scope_check CHECK (
    (intended_scope_type='PLATFORM'
      AND company_id IS NULL AND intended_branch_id IS NULL
      AND intended_supplier_id IS NULL)
    OR
    (intended_scope_type='COMPANY'
      AND company_id IS NOT NULL AND intended_branch_id IS NULL
      AND intended_supplier_id IS NULL)
    OR
    (intended_scope_type='BRANCH'
      AND company_id IS NOT NULL AND intended_branch_id IS NOT NULL
      AND intended_supplier_id IS NULL)
    OR
    (intended_scope_type='SUPPLIER'
      AND company_id IS NULL AND intended_branch_id IS NULL
      AND intended_supplier_id IS NOT NULL)
    OR
    (intended_scope_type='DELIVERY'
      AND company_id IS NULL AND intended_branch_id IS NULL
      AND intended_supplier_id IS NULL)
  );

ALTER TABLE account_setup_invitations
  DROP CONSTRAINT IF EXISTS account_setup_invitations_email_locale_check;
ALTER TABLE account_setup_invitations
  ADD CONSTRAINT account_setup_invitations_email_locale_check
    CHECK (email_locale IN ('en','ar','ms'));

CREATE OR REPLACE FUNCTION protect_account_setup_invitation_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.intended_role_id IS DISTINCT FROM OLD.intended_role_id
    OR NEW.intended_branch_id IS DISTINCT FROM OLD.intended_branch_id
    OR NEW.intended_scope_type IS DISTINCT FROM OLD.intended_scope_type
    OR NEW.intended_supplier_id IS DISTINCT FROM OLD.intended_supplier_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Account setup invitation role, scope, and creator are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enforce_account_setup_invitation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target users%ROWTYPE;
  intended_role_key text;
  creator_is_owner boolean;
  creator_can_invite boolean;
BEGIN
  SELECT * INTO target FROM public.users WHERE id=NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account setup invitation user is unavailable';
  END IF;

  SELECT role_key INTO intended_role_key
  FROM public.roles WHERE id=NEW.intended_role_id;
  IF intended_role_key IS NULL THEN
    RAISE EXCEPTION 'Account setup invitation role is unavailable';
  END IF;

  IF NEW.consumed_at IS NULL AND NEW.revoked_at IS NULL
    AND target.account_status <> 'INVITED' THEN
    RAISE EXCEPTION 'A live account setup invitation requires an invited account';
  END IF;
  IF NEW.consumed_at IS NOT NULL AND target.account_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Consumed account setup invitation requires an active account';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_assignments assignment
    WHERE assignment.user_id=target.id
      AND assignment.role_id=NEW.intended_role_id
      AND assignment.scope_type=NEW.intended_scope_type
      AND assignment.company_id IS NOT DISTINCT FROM NEW.company_id
      AND assignment.branch_id IS NOT DISTINCT FROM NEW.intended_branch_id
      AND assignment.supplier_id IS NOT DISTINCT FROM NEW.intended_supplier_id
      AND assignment.active=true
  ) THEN
    -- The legacy-role fallback applies only to lifecycle updates of an
    -- invitation that predates this migration. Every post-migration insert is
    -- bound to an exact normalized role assignment.
    IF TG_OP='INSERT'
      OR target.role_id IS DISTINCT FROM NEW.intended_role_id THEN
      RAISE EXCEPTION 'Account setup invitation does not match its role assignment';
    END IF;
  END IF;

  IF TG_OP='INSERT' AND NOT (
    (NEW.intended_scope_type='PLATFORM'
      AND intended_role_key IN (
        'PLATFORM_OWNER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT'
      ))
    OR (NEW.intended_scope_type='COMPANY'
      AND intended_role_key IN (
        'COMPANY_ADMIN','COMPANY_APPROVER','FINANCE_REVIEWER',
        'AUDITOR','RECEIVING_USER'
      ))
    OR (NEW.intended_scope_type='BRANCH'
      AND intended_role_key IN (
        'BRANCH_ADMIN','BRANCH_APPROVER','REQUESTER','FINANCE_REVIEWER',
        'AUDITOR','RECEIVING_USER'
      ))
    OR (NEW.intended_scope_type='SUPPLIER'
      AND intended_role_key='SUPPLIER_USER')
    OR (NEW.intended_scope_type='DELIVERY'
      AND intended_role_key='DELIVERY_DRIVER')
  ) THEN
    RAISE EXCEPTION 'Account setup invitation role is incompatible with its scope';
  END IF;

  IF NEW.intended_scope_type='PLATFORM' THEN
    IF target.account_kind<>'PLATFORM'
      OR target.company_id IS NOT NULL OR target.branch_id IS NOT NULL
      OR NEW.company_id IS NOT NULL OR NEW.intended_branch_id IS NOT NULL
      OR NEW.intended_supplier_id IS NOT NULL
      OR intended_role_key NOT IN ('PLATFORM_OWNER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT')
      OR target.is_owner IS DISTINCT FROM (intended_role_key='PLATFORM_OWNER') THEN
      RAISE EXCEPTION 'Platform setup invitation scope is invalid';
    END IF;
  ELSIF NEW.intended_scope_type IN ('COMPANY','BRANCH') THEN
    IF target.account_kind<>'COMPANY' OR target.is_owner
      OR target.company_id IS DISTINCT FROM NEW.company_id
      OR target.branch_id IS DISTINCT FROM NEW.intended_branch_id
      OR NOT EXISTS (
        SELECT 1 FROM public.companies company
        WHERE company.id=NEW.company_id AND company.active=true
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.company_memberships membership
        WHERE membership.user_id=target.id
          AND membership.company_id=NEW.company_id
          AND membership.status IN ('INVITED','ACTIVE')
      ) THEN
      RAISE EXCEPTION 'Company setup invitation scope is invalid';
    END IF;
    IF NEW.intended_scope_type='BRANCH' AND NOT EXISTS (
      SELECT 1 FROM public.branches branch
      JOIN public.branch_assignments assignment
        ON assignment.branch_id=branch.id AND assignment.company_id=branch.company_id
      WHERE branch.id=NEW.intended_branch_id
        AND branch.company_id=NEW.company_id
        AND branch.active=true
        AND assignment.user_id=target.id
        AND assignment.status='ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Branch setup invitation scope is invalid';
    END IF;
  ELSIF NEW.intended_scope_type='SUPPLIER' THEN
    IF target.account_kind<>'SUPPLIER' OR target.is_owner
      OR target.company_id IS NOT NULL OR target.branch_id IS NOT NULL
      OR intended_role_key<>'SUPPLIER_USER'
      OR NOT EXISTS (
        SELECT 1 FROM public.suppliers supplier
        JOIN public.supplier_memberships membership
          ON membership.supplier_id=supplier.id
        WHERE supplier.id=NEW.intended_supplier_id
          AND supplier.active=true
          AND membership.user_id=target.id
          AND membership.status IN ('INVITED','ACTIVE')
      ) THEN
      RAISE EXCEPTION 'Supplier setup invitation scope is invalid';
    END IF;
  ELSIF NEW.intended_scope_type='DELIVERY' THEN
    IF target.account_kind<>'DELIVERY' OR target.is_owner
      OR target.company_id IS NOT NULL OR target.branch_id IS NOT NULL
      OR intended_role_key<>'DELIVERY_DRIVER'
      OR NOT EXISTS (
        SELECT 1 FROM public.delivery_agent_profiles profile
        WHERE profile.user_id=target.id AND profile.active=true
      ) THEN
      RAISE EXCEPTION 'Delivery setup invitation scope is invalid';
    END IF;
  END IF;

  IF NEW.created_by IS NULL THEN
    IF intended_role_key<>'PLATFORM_OWNER' THEN
      IF TG_OP='INSERT' THEN
        RAISE EXCEPTION 'Only first-owner bootstrap may omit the invitation creator';
      ELSIF OLD.created_by IS NOT NULL THEN
        RAISE EXCEPTION 'Account setup invitation creator cannot be cleared';
      END IF;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.users creator
      WHERE creator.id=NEW.created_by
        AND creator.active=true
        AND creator.account_status='ACTIVE'
        AND creator.is_owner=true
        AND creator.account_kind='PLATFORM'
    ) INTO creator_is_owner;

    IF TG_OP='INSERT' AND NOT creator_is_owner THEN
      IF NEW.intended_scope_type NOT IN ('COMPANY','BRANCH') THEN
        RAISE EXCEPTION 'This account scope requires an active platform owner invitation creator';
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.users creator
        JOIN public.company_memberships membership
          ON membership.user_id=creator.id
         AND membership.company_id=NEW.company_id
         AND membership.status='ACTIVE'
        JOIN public.role_assignments assignment
          ON assignment.user_id=creator.id
         AND assignment.company_id=NEW.company_id
         AND assignment.active=true
         AND assignment.revoked_at IS NULL
        JOIN public.roles creator_role ON creator_role.id=assignment.role_id
        WHERE creator.id=NEW.created_by
          AND creator.active=true
          AND creator.account_status='ACTIVE'
          AND creator.account_kind='COMPANY'
          AND creator.company_id=NEW.company_id
          AND (
            (creator_role.role_key='COMPANY_ADMIN'
              AND assignment.scope_type='COMPANY')
            OR
            (creator_role.role_key='BRANCH_ADMIN'
              AND assignment.scope_type='BRANCH'
              AND assignment.branch_id=NEW.intended_branch_id
              AND NEW.intended_scope_type='BRANCH'
              AND intended_role_key IN (
                'BRANCH_APPROVER','REQUESTER','RECEIVING_USER'
              ))
          )
      ) INTO creator_can_invite;

      IF NOT creator_can_invite THEN
        RAISE EXCEPTION 'Account setup invitation creator is outside the permitted account scope';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION require_platform_owner_bootstrap_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  intended_role_key text;
BEGIN
  SELECT role_key INTO intended_role_key
  FROM public.roles WHERE id=NEW.intended_role_id;
  IF intended_role_key='PLATFORM_OWNER' AND NEW.created_by IS NULL AND NOT EXISTS (
    SELECT 1
    FROM public.platform_owner_bootstrap_audits audit
    WHERE audit.invitation_id=NEW.id AND audit.user_id=NEW.user_id
  ) THEN
    RAISE EXCEPTION 'First platform owner setup invitation requires operator audit evidence';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_account_setup_invitation_scope_trigger
  ON account_setup_invitations;
CREATE TRIGGER protect_account_setup_invitation_scope_trigger
BEFORE UPDATE ON account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION protect_account_setup_invitation_scope();

DROP TRIGGER IF EXISTS enforce_account_setup_invitation_scope_trigger
  ON account_setup_invitations;
CREATE TRIGGER enforce_account_setup_invitation_scope_trigger
BEFORE INSERT OR UPDATE ON account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION enforce_account_setup_invitation_scope();

DROP TRIGGER IF EXISTS require_platform_owner_bootstrap_audit_trigger
  ON account_setup_invitations;
CREATE CONSTRAINT TRIGGER require_platform_owner_bootstrap_audit_trigger
AFTER INSERT OR UPDATE ON account_setup_invitations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_platform_owner_bootstrap_audit();

CREATE INDEX IF NOT EXISTS account_setup_invitation_supplier_created_idx
  ON account_setup_invitations(intended_supplier_id,created_at DESC)
  WHERE intended_supplier_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION protect_account_setup_invitation_scope() TO axora_app;
    GRANT EXECUTE ON FUNCTION enforce_account_setup_invitation_scope() TO axora_app;
    GRANT EXECUTE ON FUNCTION require_platform_owner_bootstrap_audit() TO axora_app;
  END IF;
END $$;

COMMIT;
