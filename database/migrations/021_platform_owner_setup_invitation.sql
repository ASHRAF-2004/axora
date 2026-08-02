BEGIN;

-- Company invitations remain tenant-bound.  The only company-less setup
-- invitation is the first PLATFORM_OWNER created by the audited operator
-- bootstrap command.  Existing 014-020 migrations remain immutable.
ALTER TABLE account_setup_invitations
  ALTER COLUMN company_id DROP NOT NULL;

-- The original composite foreign key intentionally remains in place for
-- company invitations.  MATCH SIMPLE skips it when company_id is NULL, so a
-- standalone user reference preserves referential integrity for owner setup.
ALTER TABLE account_setup_invitations
  DROP CONSTRAINT IF EXISTS account_setup_invitations_user_id_fkey;
ALTER TABLE account_setup_invitations
  ADD CONSTRAINT account_setup_invitations_user_id_fkey
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE account_setup_invitations
  DROP CONSTRAINT IF EXISTS account_setup_invitation_platform_scope_check;
ALTER TABLE account_setup_invitations
  ADD CONSTRAINT account_setup_invitation_platform_scope_check CHECK (
    company_id IS NOT NULL OR intended_branch_id IS NULL
  );

CREATE TABLE IF NOT EXISTS platform_owner_bootstrap_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL UNIQUE
    REFERENCES account_setup_invitations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operator_identity text NOT NULL CHECK (
    char_length(btrim(operator_identity)) BETWEEN 3 AND 200
    AND operator_identity !~ '[[:cntrl:]]'
  ),
  reason text NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 10 AND 500
    AND reason !~ '[[:cntrl:]]'
  ),
  command_version text NOT NULL DEFAULT 'first-platform-owner-v1'
    CHECK (command_version='first-platform-owner-v1'),
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_owner_bootstrap_audits_user_idx
  ON platform_owner_bootstrap_audits(user_id, executed_at DESC);

CREATE OR REPLACE FUNCTION enforce_account_setup_invitation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  target users%ROWTYPE;
  intended_role_key text;
BEGIN
  SELECT * INTO target FROM public.users WHERE id=NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account setup invitation user is unavailable';
  END IF;

  IF NEW.intended_role_id IS NOT NULL THEN
    SELECT role_key INTO intended_role_key
    FROM public.roles WHERE id=NEW.intended_role_id;
  END IF;

  IF NEW.company_id IS NULL THEN
    IF NOT target.is_owner
      OR target.company_id IS NOT NULL
      OR target.branch_id IS NOT NULL
      OR target.account_kind <> 'PLATFORM'
      OR (NEW.consumed_at IS NULL AND target.account_status <> 'INVITED')
      OR (NEW.consumed_at IS NOT NULL AND target.account_status <> 'ACTIVE')
      OR NEW.intended_role_id IS NULL
      OR intended_role_key <> 'PLATFORM_OWNER'
      OR NEW.intended_branch_id IS NOT NULL
      OR NEW.created_by IS NOT NULL THEN
      RAISE EXCEPTION
        'Company-less setup invitations are restricted to the first PLATFORM_OWNER bootstrap';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.roles legacy_role
      WHERE legacy_role.id=target.role_id
        AND legacy_role.role_key='PLATFORM_OWNER'
    ) THEN
      RAISE EXCEPTION 'Platform owner legacy identity does not match its intended role';
    END IF;
  ELSE
    IF target.is_owner
      OR target.company_id IS DISTINCT FROM NEW.company_id
      OR intended_role_key='PLATFORM_OWNER' THEN
      RAISE EXCEPTION 'Company setup invitation scope is invalid';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_account_setup_invitation_scope_trigger
  ON account_setup_invitations;
CREATE TRIGGER enforce_account_setup_invitation_scope_trigger
BEFORE INSERT OR UPDATE ON account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION enforce_account_setup_invitation_scope();

CREATE OR REPLACE FUNCTION require_platform_owner_bootstrap_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NOT EXISTS (
    SELECT 1
    FROM public.platform_owner_bootstrap_audits audit
    WHERE audit.invitation_id=NEW.id AND audit.user_id=NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Platform owner setup invitation requires operator audit evidence';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS require_platform_owner_bootstrap_audit_trigger
  ON account_setup_invitations;
CREATE CONSTRAINT TRIGGER require_platform_owner_bootstrap_audit_trigger
AFTER INSERT OR UPDATE ON account_setup_invitations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_platform_owner_bootstrap_audit();

CREATE OR REPLACE FUNCTION protect_platform_owner_bootstrap_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Platform owner bootstrap audit evidence is immutable';
END $$;

DROP TRIGGER IF EXISTS protect_platform_owner_bootstrap_audits
  ON platform_owner_bootstrap_audits;
CREATE TRIGGER protect_platform_owner_bootstrap_audits
BEFORE UPDATE OR DELETE ON platform_owner_bootstrap_audits
FOR EACH ROW EXECUTE FUNCTION protect_platform_owner_bootstrap_audit();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT, INSERT ON TABLE platform_owner_bootstrap_audits TO axora_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE platform_owner_bootstrap_audits FROM axora_app;
    GRANT EXECUTE ON FUNCTION enforce_account_setup_invitation_scope() TO axora_app;
    GRANT EXECUTE ON FUNCTION require_platform_owner_bootstrap_audit() TO axora_app;
    GRANT EXECUTE ON FUNCTION protect_platform_owner_bootstrap_audit() TO axora_app;
  END IF;
END $$;

COMMIT;

-- Rollback note: application rollback is safe because ordinary company
-- invitations retain their original composite tenant foreign key.  Do not SET
-- company_id NOT NULL while a PLATFORM_OWNER invitation exists.  First revoke
-- and remove that unconsumed invitation/user in an audited recovery procedure,
-- preserve platform_owner_bootstrap_audits externally, then remove the three
-- triggers/table/standalone FK and restore NOT NULL.  No automatic destructive
-- down migration is provided.
