BEGIN;

-- Explicit, generic roles for the rebuilt product. Legacy role rows remain in
-- place during the expand/contract migration so the currently deployed
-- application can be rolled back safely.
INSERT INTO roles(role_key, label, description) VALUES
  ('PLATFORM_OWNER', 'Axora platform owner', 'Controls tenants, global procurement operations and platform governance'),
  ('PLATFORM_OPERATIONS', 'Axora operations administrator', 'Runs sourcing, fulfilment and operational coordination'),
  ('COMPANY_ADMIN', 'Company administrator', 'Manages one customer company, its people, branches and budgets'),
  ('BRANCH_APPROVER', 'Branch approver', 'Approves eligible requests for assigned branches'),
  ('COMPANY_APPROVER', 'Company approver', 'Approves eligible requests across one company'),
  ('FINANCE_REVIEWER', 'Finance reviewer', 'Reviews invoices, COD evidence, matching and exceptions'),
  ('AUDITOR', 'Read-only auditor', 'Reviews tenant-scoped evidence and audit history without mutation rights'),
  ('TECHNICAL_SUPPORT', 'Technical support', 'Performs audited technical diagnostics without commercial authority'),
  ('SUPPLIER_USER', 'Supplier user', 'Responds to assigned sourcing work for one supplier organization'),
  ('DELIVERY_DRIVER', 'Delivery driver', 'Handles only assigned delivery jobs and operational evidence'),
  ('RECEIVING_USER', 'Receiving user', 'Confirms and inspects receipts for assigned company branches')
ON CONFLICT(role_key) DO UPDATE SET
  label=EXCLUDED.label,
  description=EXCLUDED.description;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- The legacy rule required every non-owner to carry company_id, so relax it
-- inside this transaction before normalizing platform support identities. The
-- stronger account_kind-aware replacement is installed immediately below.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_owner_company_rule;

-- Legacy technical-support users were historically attached to a company only
-- because the old users shape required it. Preserve that former relationship
-- for recovery/audit, then remove it from the live identity before assigning
-- the canonical platform-scoped TECHNICAL_SUPPORT role below.
CREATE TEMP TABLE identity_legacy_it_support_scopes ON COMMIT DROP AS
SELECT account.id AS user_id,account.company_id,account.branch_id,
  account.created_at
FROM users account
JOIN roles legacy_role ON legacy_role.id=account.role_id
WHERE NOT account.is_owner
  AND legacy_role.role_key='IT_SUPPORT'
  AND account.company_id IS NOT NULL;

UPDATE users account
SET account_kind=CASE
      WHEN account.is_owner OR legacy_role.role_key='IT_SUPPORT' THEN 'PLATFORM'
      ELSE 'COMPANY'
    END,
    account_status=CASE
      WHEN NOT account.active THEN 'DEACTIVATED'
      WHEN account.account_setup_completed_at IS NULL THEN 'INVITED'
      ELSE 'ACTIVE'
    END,
    company_id=CASE
      WHEN legacy_role.role_key='IT_SUPPORT' THEN NULL
      ELSE account.company_id
    END,
    branch_id=CASE
      WHEN legacy_role.role_key='IT_SUPPORT' THEN NULL
      ELSE account.branch_id
    END
FROM roles legacy_role
WHERE legacy_role.id=account.role_id;

-- Keep old administrative tools rollback-compatible: older inserts set
-- is_owner/company_id but know nothing about account_kind.
CREATE OR REPLACE FUNCTION sync_user_account_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_owner THEN
    NEW.account_kind := 'PLATFORM';
  ELSIF NEW.company_id IS NOT NULL THEN
    NEW.account_kind := 'COMPANY';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_user_account_kind_trigger ON users;
CREATE TRIGGER sync_user_account_kind_trigger
BEFORE INSERT OR UPDATE OF is_owner, company_id, account_kind ON users
FOR EACH ROW EXECUTE FUNCTION sync_user_account_kind();

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_kind_check;
ALTER TABLE users ADD CONSTRAINT users_account_kind_check
  CHECK (account_kind IN ('PLATFORM','COMPANY','SUPPLIER','DELIVERY'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE users ADD CONSTRAINT users_account_status_check
  CHECK (account_status IN ('INVITED','ACTIVE','SUSPENDED','DEACTIVATED'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_owner_company_rule;
ALTER TABLE users ADD CONSTRAINT users_owner_company_rule CHECK (
  (is_owner AND account_kind='PLATFORM' AND company_id IS NULL)
  OR
  (NOT is_owner AND account_kind='COMPANY' AND company_id IS NOT NULL)
  OR
  (NOT is_owner AND account_kind IN ('PLATFORM','SUPPLIER','DELIVERY') AND company_id IS NULL)
);

CREATE INDEX IF NOT EXISTS users_status_kind_idx
  ON users(account_status, account_kind, active);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 200),
  job_title text NOT NULL DEFAULT '' CHECK (char_length(job_title) <= 160),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  preferred_locale text NOT NULL DEFAULT 'en' CHECK (preferred_locale IN ('en','ar','ms')),
  timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur' CHECK (char_length(timezone) BETWEEN 1 AND 80),
  avatar_file_name text,
  avatar_content_type text CHECK (avatar_content_type IS NULL OR avatar_content_type IN ('image/jpeg','image/png','image/webp')),
  avatar_content bytea,
  avatar_sha256 text CHECK (avatar_sha256 IS NULL OR avatar_sha256 ~ '^[0-9a-f]{64}$'),
  notification_email_enabled boolean NOT NULL DEFAULT true,
  notification_in_app_enabled boolean NOT NULL DEFAULT true,
  required_policy_version text,
  required_policy_accepted_at timestamptz,
  profile_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((avatar_content IS NULL AND avatar_content_type IS NULL AND avatar_file_name IS NULL AND avatar_sha256 IS NULL)
    OR (avatar_content IS NOT NULL AND avatar_content_type IS NOT NULL AND avatar_file_name IS NOT NULL AND avatar_sha256 IS NOT NULL))
);

INSERT INTO user_profiles(user_id, display_name, preferred_locale, profile_completed_at, created_at, updated_at)
SELECT id, display_name, 'en',
  CASE WHEN account_setup_completed_at IS NOT NULL THEN account_setup_completed_at ELSE NULL END,
  created_at, updated_at
FROM users
ON CONFLICT(user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text,
  password_algorithm text CHECK (password_algorithm IS NULL OR password_algorithm IN ('argon2id','bcrypt')),
  password_changed_at timestamptz,
  failed_sign_in_count integer NOT NULL DEFAULT 0 CHECK (failed_sign_in_count >= 0),
  first_failed_sign_in_at timestamptz,
  locked_until timestamptz,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((password_hash IS NULL AND password_algorithm IS NULL)
    OR (password_hash IS NOT NULL AND password_algorithm IS NOT NULL))
);

INSERT INTO account_credentials(
  user_id, password_hash, password_algorithm, password_changed_at,
  credential_version, created_at, updated_at
)
SELECT id,
  CASE WHEN account_setup_completed_at IS NOT NULL THEN password_hash ELSE NULL END,
  CASE
    WHEN account_setup_completed_at IS NULL THEN NULL
    WHEN password_hash LIKE '$argon2id$%' THEN 'argon2id'
    ELSE 'bcrypt'
  END,
  account_setup_completed_at,
  auth_version,
  created_at,
  updated_at
FROM users
ON CONFLICT(user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','ENDED')),
  is_primary boolean NOT NULL DEFAULT true,
  joined_at timestamptz,
  ended_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, company_id),
  CHECK ((status='ENDED' AND ended_at IS NOT NULL) OR (status<>'ENDED' AND ended_at IS NULL))
);

INSERT INTO company_memberships(user_id, company_id, status, is_primary, joined_at, ended_at, created_at, updated_at)
SELECT id, company_id,
  CASE
    WHEN NOT active THEN 'ENDED'
    WHEN account_setup_completed_at IS NULL THEN 'INVITED'
    ELSE 'ACTIVE'
  END,
  true,
  account_setup_completed_at,
  CASE WHEN NOT active THEN updated_at ELSE NULL END,
  created_at,
  updated_at
FROM users
WHERE company_id IS NOT NULL
ON CONFLICT(user_id, company_id) DO NOTHING;

INSERT INTO company_memberships(
  user_id,company_id,status,is_primary,joined_at,ended_at,created_at,updated_at
)
SELECT user_id,company_id,'ENDED',false,created_at,now(),created_at,now()
FROM identity_legacy_it_support_scopes
ON CONFLICT(user_id,company_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS branch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','ENDED')),
  is_primary boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  FOREIGN KEY(branch_id, company_id) REFERENCES branches(id, company_id) ON DELETE RESTRICT,
  UNIQUE(user_id, branch_id),
  CHECK ((status='ENDED' AND ended_at IS NOT NULL) OR (status<>'ENDED' AND ended_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS branch_assignments_one_primary_uq
  ON branch_assignments(user_id) WHERE is_primary AND status='ACTIVE';

INSERT INTO branch_assignments(user_id, company_id, branch_id, status, is_primary, created_at, ended_at)
SELECT id, company_id, branch_id,
  CASE WHEN active THEN 'ACTIVE' ELSE 'ENDED' END,
  true,
  created_at,
  CASE WHEN NOT active THEN updated_at ELSE NULL END
FROM users
WHERE company_id IS NOT NULL AND branch_id IS NOT NULL
ON CONFLICT(user_id, branch_id) DO NOTHING;

INSERT INTO branch_assignments(
  user_id,company_id,branch_id,status,is_primary,created_at,ended_at
)
SELECT user_id,company_id,branch_id,'ENDED',false,created_at,now()
FROM identity_legacy_it_support_scopes
WHERE branch_id IS NOT NULL
ON CONFLICT(user_id,branch_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  scope_type text NOT NULL CHECK (scope_type IN ('PLATFORM','COMPANY','BRANCH','SUPPLIER','DELIVERY')),
  company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  FOREIGN KEY(branch_id, company_id) REFERENCES branches(id, company_id) ON DELETE RESTRICT,
  CHECK (
    (scope_type='PLATFORM' AND company_id IS NULL AND branch_id IS NULL AND supplier_id IS NULL)
    OR (scope_type='COMPANY' AND company_id IS NOT NULL AND branch_id IS NULL AND supplier_id IS NULL)
    OR (scope_type='BRANCH' AND company_id IS NOT NULL AND branch_id IS NOT NULL AND supplier_id IS NULL)
    OR (scope_type='SUPPLIER' AND company_id IS NULL AND branch_id IS NULL AND supplier_id IS NOT NULL)
    OR (scope_type='DELIVERY' AND company_id IS NULL AND branch_id IS NULL AND supplier_id IS NULL)
  ),
  CHECK ((active AND revoked_at IS NULL) OR (NOT active AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_active_scope_uq
  ON role_assignments(
    user_id, role_id, scope_type,
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE active;

INSERT INTO role_assignments(user_id, role_id, scope_type, company_id, branch_id, active, assigned_at, revoked_at)
SELECT
  u.id,
  mapped.id,
  CASE
    WHEN u.is_owner OR legacy.role_key IN ('IT_SUPPORT') THEN 'PLATFORM'
    WHEN u.branch_id IS NOT NULL AND legacy.role_key IN ('BRANCH_ADMIN','APPROVER','REQUESTER') THEN 'BRANCH'
    ELSE 'COMPANY'
  END,
  CASE WHEN u.is_owner OR legacy.role_key IN ('IT_SUPPORT') THEN NULL ELSE u.company_id END,
  CASE WHEN u.branch_id IS NOT NULL AND legacy.role_key IN ('BRANCH_ADMIN','APPROVER','REQUESTER') THEN u.branch_id ELSE NULL END,
  u.active,
  u.created_at,
  CASE WHEN NOT u.active THEN u.updated_at ELSE NULL END
FROM users u
JOIN roles legacy ON legacy.id=u.role_id
JOIN roles mapped ON mapped.role_key=CASE
  WHEN u.is_owner THEN 'PLATFORM_OWNER'
  WHEN legacy.role_key='ADMIN' THEN 'COMPANY_ADMIN'
  WHEN legacy.role_key='APPROVER' AND u.branch_id IS NULL THEN 'COMPANY_APPROVER'
  WHEN legacy.role_key='APPROVER' THEN 'BRANCH_APPROVER'
  WHEN legacy.role_key='FINANCE' THEN 'FINANCE_REVIEWER'
  WHEN legacy.role_key='VIEWER' THEN 'AUDITOR'
  WHEN legacy.role_key='IT_SUPPORT' THEN 'TECHNICAL_SUPPORT'
  WHEN legacy.role_key='OPERATIONS' THEN 'REQUESTER'
  ELSE legacy.role_key
END
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS supplier_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','ENDED')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE(user_id, supplier_id),
  CHECK ((status='ENDED' AND ended_at IS NOT NULL) OR (status<>'ENDED' AND ended_at IS NULL))
);

CREATE TABLE IF NOT EXISTS delivery_agent_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  agent_code text NOT NULL UNIQUE,
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  vehicle_description text NOT NULL DEFAULT '' CHECK (char_length(vehicle_description) <= 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 240),
  network_hash text CHECK (network_hash IS NULL OR network_hash ~ '^[0-9a-f]{64}$'),
  user_agent_summary text CHECK (user_agent_summary IS NULL OR char_length(user_agent_summary) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at),
  CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

CREATE INDEX IF NOT EXISTS user_sessions_active_idx
  ON user_sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  request_network_hash text CHECK (request_network_hash IS NULL OR request_network_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > requested_at AND expires_at <= requested_at + interval '2 hours'),
  CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_one_live_token_uq
  ON password_reset_tokens(user_id) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) <= 254),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CHECK (NOT (used_at IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_one_live_token_uq
  ON email_verification_tokens(user_id) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS onboarding_progress (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_stage_status text NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (profile_stage_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED')),
  started_at timestamptz,
  completed_at timestamptz,
  current_step_key text CHECK (current_step_key IS NULL OR char_length(current_step_key) <= 120),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR profile_stage_status='COMPLETED')
);

CREATE TABLE IF NOT EXISTS tutorial_step_progress (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key text NOT NULL,
  step_key text NOT NULL CHECK (char_length(step_key) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED','VIEWED','COMPLETED','SKIPPED','DISMISSED_TEMPORARILY')),
  first_viewed_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, role_key, step_key)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 120),
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, event_key)
);

ALTER TABLE account_setup_invitations
  ADD COLUMN IF NOT EXISTS intended_role_id uuid REFERENCES roles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS intended_branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revoked_reason text;

UPDATE account_setup_invitations invitation
SET intended_role_id=user_row.role_id,
    intended_branch_id=user_row.branch_id
FROM users user_row
WHERE user_row.id=invitation.user_id
  AND invitation.intended_role_id IS NULL;

ALTER TABLE account_setup_invitations
  DROP CONSTRAINT IF EXISTS account_setup_invitation_retry_count_check;
ALTER TABLE account_setup_invitations
  ADD CONSTRAINT account_setup_invitation_retry_count_check CHECK (retry_count >= 0 AND retry_count <= 20);
ALTER TABLE account_setup_invitations
  DROP CONSTRAINT IF EXISTS account_setup_invitation_revoked_reason_check;
ALTER TABLE account_setup_invitations
  ADD CONSTRAINT account_setup_invitation_revoked_reason_check
    CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 240);

DROP TRIGGER IF EXISTS set_updated_at_user_profiles ON user_profiles;
CREATE TRIGGER set_updated_at_user_profiles
BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_account_credentials ON account_credentials;
CREATE TRIGGER set_updated_at_account_credentials
BEFORE UPDATE ON account_credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_company_memberships ON company_memberships;
CREATE TRIGGER set_updated_at_company_memberships
BEFORE UPDATE ON company_memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_delivery_agent_profiles ON delivery_agent_profiles;
CREATE TRIGGER set_updated_at_delivery_agent_profiles
BEFORE UPDATE ON delivery_agent_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Migration 014 protects the invitation identity that existed at that point.
-- The normalized intended role and branch added here are equally security
-- sensitive and may never be retargeted after a bearer token is issued.
CREATE OR REPLACE FUNCTION protect_account_setup_invitation_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.intended_role_id IS DISTINCT FROM OLD.intended_role_id
    OR NEW.intended_branch_id IS DISTINCT FROM OLD.intended_branch_id THEN
    RAISE EXCEPTION 'Account setup invitation role and branch scope are immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_account_setup_invitation_scope_trigger
  ON account_setup_invitations;
CREATE TRIGGER protect_account_setup_invitation_scope_trigger
BEFORE UPDATE ON account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION protect_account_setup_invitation_scope();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      user_profiles, account_credentials, company_memberships,
      branch_assignments, role_assignments, supplier_memberships,
      delivery_agent_profiles, user_sessions, password_reset_tokens,
      email_verification_tokens, onboarding_progress,
      tutorial_step_progress, notification_preferences
    TO axora_app;
    REVOKE DELETE ON TABLE
      account_credentials, role_assignments, user_sessions,
      password_reset_tokens, email_verification_tokens
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION protect_account_setup_invitation_scope() TO axora_app;
  END IF;
END $$;

COMMIT;
