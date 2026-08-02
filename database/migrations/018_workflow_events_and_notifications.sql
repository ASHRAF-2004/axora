BEGIN;

-- Workflow metadata is deliberately small and must not become a shadow store
-- for credentials, message bodies, or uploaded documents. This validator is
-- shared by later append-only operational event tables.
CREATE OR REPLACE FUNCTION workflow_metadata_is_safe(p_metadata jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  item record;
  array_item jsonb;
BEGIN
  IF p_metadata IS NULL OR octet_length(p_metadata::text) > 16384 THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_metadata) = 'object' THEN
    FOR item IN SELECT key, value FROM jsonb_each(p_metadata) LOOP
      IF item.key ~* '(password|passphrase|secret|token|authorization|cookie|credential|private[_-]?key|raw[_-]?(body|content)|file[_-]?(body|content|bytes))'
        OR char_length(item.key) > 120
        OR NOT workflow_metadata_is_safe(item.value) THEN
        RETURN false;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_metadata) = 'array' THEN
    IF jsonb_array_length(p_metadata) > 100 THEN
      RETURN false;
    END IF;
    FOR array_item IN SELECT value FROM jsonb_array_elements(p_metadata) LOOP
      IF NOT workflow_metadata_is_safe(array_item) THEN
        RETURN false;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_metadata) = 'string' THEN
    IF octet_length(p_metadata::text) > 2048 THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END $$;

-- Composite keys let every optional workflow scope prove that it belongs to
-- the same tenant instead of relying on an application-side comparison.
CREATE UNIQUE INDEX IF NOT EXISTS requests_id_company_uq
  ON requests(id, company_id);

CREATE TABLE IF NOT EXISTS workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  branch_id uuid,
  request_id uuid,
  aggregate_type text NOT NULL
    CHECK (char_length(aggregate_type) BETWEEN 2 AND 80
      AND aggregate_type ~ '^[a-z][a-z0-9_.-]*$'),
  aggregate_id uuid NOT NULL,
  event_key text NOT NULL
    CHECK (char_length(event_key) BETWEEN 2 AND 120
      AND event_key ~ '^[a-z][a-z0-9_.-]*$'),
  event_version integer NOT NULL CHECK (event_version > 0),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL
    CHECK (actor_kind IN ('PLATFORM','COMPANY','SUPPLIER','DELIVERY','SYSTEM')),
  correlation_id uuid NOT NULL,
  causation_event_id uuid,
  idempotency_key text NOT NULL
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 200
      AND idempotency_key !~ '[[:cntrl:]]'),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object' AND workflow_metadata_is_safe(metadata)),
  UNIQUE(id, company_id),
  UNIQUE(company_id, idempotency_key),
  UNIQUE(company_id, aggregate_type, aggregate_id, event_version),
  FOREIGN KEY(branch_id, company_id)
    REFERENCES branches(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY(request_id, company_id)
    REFERENCES requests(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY(causation_event_id, company_id)
    REFERENCES workflow_events(id, company_id) ON DELETE RESTRICT,
  CHECK (occurred_at <= recorded_at + interval '5 minutes'),
  CHECK (causation_event_id IS NULL OR causation_event_id <> id)
);

CREATE INDEX IF NOT EXISTS workflow_events_aggregate_idx
  ON workflow_events(company_id, aggregate_type, aggregate_id, event_version DESC);
CREATE INDEX IF NOT EXISTS workflow_events_correlation_idx
  ON workflow_events(company_id, correlation_id, recorded_at);
CREATE INDEX IF NOT EXISTS workflow_events_request_idx
  ON workflow_events(company_id, request_id, recorded_at DESC)
  WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_workflow_event_actor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_kind_value text;
  account_is_active boolean;
BEGIN
  IF NEW.actor_kind = 'SYSTEM' THEN
    IF NEW.actor_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'System workflow events cannot impersonate a user';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Non-system workflow events require an actor';
  END IF;

  SELECT account_kind, active AND account_status = 'ACTIVE'
  INTO account_kind_value, account_is_active
  FROM users
  WHERE id = NEW.actor_user_id;

  IF account_is_active IS DISTINCT FROM true
    OR account_kind_value IS DISTINCT FROM NEW.actor_kind THEN
    RAISE EXCEPTION 'Workflow actor kind must match an active account';
  END IF;

  IF NEW.actor_kind = 'COMPANY' AND NOT EXISTS (
    SELECT 1
    FROM company_memberships membership
    WHERE membership.user_id = NEW.actor_user_id
      AND membership.company_id = NEW.company_id
      AND membership.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Company workflow actor must belong to the event tenant';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_workflow_event_actor_insert ON workflow_events;
CREATE TRIGGER validate_workflow_event_actor_insert
BEFORE INSERT ON workflow_events
FOR EACH ROW EXECUTE FUNCTION validate_workflow_event_actor();

CREATE OR REPLACE FUNCTION reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END $$;

DROP TRIGGER IF EXISTS workflow_events_are_append_only ON workflow_events;
CREATE TRIGGER workflow_events_are_append_only
BEFORE UPDATE OR DELETE ON workflow_events
FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

CREATE OR REPLACE FUNCTION axora_context_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  context_value text;
BEGIN
  context_value := current_setting('axora.user_id', true);
  IF context_value IS NULL OR context_value = '' THEN
    RETURN NULL;
  END IF;
  RETURN context_value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION axora_user_is_platform(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users account
    WHERE account.id = p_user_id
      AND account.active
      AND account.account_status = 'ACTIVE'
      AND (
        account.is_owner
        OR EXISTS (
          SELECT 1
          FROM public.role_assignments assignment
          JOIN public.roles role ON role.id = assignment.role_id
          WHERE assignment.user_id = account.id
            AND assignment.active
            AND assignment.scope_type = 'PLATFORM'
            AND role.role_key IN ('PLATFORM_OWNER','PLATFORM_OPERATIONS')
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION axora_context_is_platform()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT axora_user_is_platform(axora_context_user_id())
$$;

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  workflow_event_id uuid NOT NULL,
  event_key text NOT NULL
    CHECK (char_length(event_key) BETWEEN 2 AND 120
      AND event_key ~ '^[a-z][a-z0-9_.-]*$'),
  dedupe_key text NOT NULL
    CHECK (char_length(dedupe_key) BETWEEN 8 AND 200
      AND dedupe_key !~ '[[:cntrl:]]'),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 180),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  priority text NOT NULL DEFAULT 'NORMAL'
    CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  route_path text CHECK (
    route_path IS NULL OR (
      char_length(route_path) BETWEEN 1 AND 500
      AND route_path ~ '^/[^/].*|^/$'
      AND route_path !~ '[[:cntrl:]]'
      AND route_path !~ '://'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  archived_at timestamptz,
  UNIQUE(company_id, recipient_user_id, dedupe_key),
  FOREIGN KEY(workflow_event_id, company_id)
    REFERENCES workflow_events(id, company_id) ON DELETE RESTRICT,
  CHECK (read_at IS NULL OR read_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE INDEX IF NOT EXISTS in_app_notifications_unread_idx
  ON in_app_notifications(recipient_user_id, created_at DESC)
  WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS in_app_notifications_event_idx
  ON in_app_notifications(company_id, workflow_event_id);

CREATE OR REPLACE FUNCTION validate_in_app_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_event_key text;
  recipient_is_active boolean;
BEGIN
  SELECT event_key
  INTO source_event_key
  FROM workflow_events
  WHERE id = NEW.workflow_event_id AND company_id = NEW.company_id;

  IF source_event_key IS NULL OR source_event_key <> NEW.event_key THEN
    RAISE EXCEPTION 'Notification event key and tenant must match its workflow event';
  END IF;

  SELECT active AND account_status IN ('ACTIVE','INVITED')
  INTO recipient_is_active
  FROM users
  WHERE id = NEW.recipient_user_id;

  IF recipient_is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Notification recipient must be an active account';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_in_app_notification_insert ON in_app_notifications;
CREATE TRIGGER validate_in_app_notification_insert
BEFORE INSERT ON in_app_notifications
FOR EACH ROW EXECUTE FUNCTION validate_in_app_notification();

CREATE OR REPLACE FUNCTION protect_in_app_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'In-app notifications cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['read_at','archived_at'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['read_at','archived_at']) THEN
    RAISE EXCEPTION 'Notification identity and content are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
    OR (OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at) THEN
    RAISE EXCEPTION 'Notification read and archive timestamps are monotonic'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_in_app_notification_mutation ON in_app_notifications;
CREATE TRIGGER protect_in_app_notification_mutation
BEFORE UPDATE OR DELETE ON in_app_notifications
FOR EACH ROW EXECUTE FUNCTION protect_in_app_notification();

-- Migration 016 created the per-event preferences. Extend that single source
-- of truth; email_enabled remains a preference only and is intentionally not
-- coupled to an email outbox here.
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS digest_mode text NOT NULL DEFAULT 'IMMEDIATE',
  ADD COLUMN IF NOT EXISTS muted_until timestamptz;

ALTER TABLE notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_digest_mode_check;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_digest_mode_check
    CHECK (digest_mode IN ('IMMEDIATE','DAILY','WEEKLY'));

DROP TRIGGER IF EXISTS set_updated_at_notification_preferences ON notification_preferences;
CREATE TRIGGER set_updated_at_notification_preferences
BEFORE UPDATE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE in_app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS in_app_notifications_select_scope ON in_app_notifications;
CREATE POLICY in_app_notifications_select_scope ON in_app_notifications FOR SELECT
  USING (
    recipient_user_id = axora_context_user_id()
    OR axora_context_is_platform()
  );
DROP POLICY IF EXISTS in_app_notifications_insert_scope ON in_app_notifications;
CREATE POLICY in_app_notifications_insert_scope ON in_app_notifications FOR INSERT
  WITH CHECK (
    axora_context_is_platform()
    OR EXISTS (
      SELECT 1
      FROM workflow_events source_event
      WHERE source_event.id = in_app_notifications.workflow_event_id
        AND source_event.company_id = in_app_notifications.company_id
        AND source_event.actor_user_id = axora_context_user_id()
    )
  );
DROP POLICY IF EXISTS in_app_notifications_update_scope ON in_app_notifications;
CREATE POLICY in_app_notifications_update_scope ON in_app_notifications FOR UPDATE
  USING (recipient_user_id = axora_context_user_id())
  WITH CHECK (recipient_user_id = axora_context_user_id());

DROP POLICY IF EXISTS notification_preferences_self_scope ON notification_preferences;
CREATE POLICY notification_preferences_self_scope ON notification_preferences FOR ALL
  USING (user_id = axora_context_user_id())
  WITH CHECK (user_id = axora_context_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT SELECT, INSERT ON TABLE workflow_events TO axora_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE workflow_events FROM axora_app;

    GRANT SELECT, INSERT, UPDATE ON TABLE in_app_notifications TO axora_app;
    REVOKE DELETE, TRUNCATE ON TABLE in_app_notifications FROM axora_app;

    GRANT SELECT, INSERT, UPDATE ON TABLE notification_preferences TO axora_app;
    REVOKE DELETE, TRUNCATE ON TABLE notification_preferences FROM axora_app;

    GRANT EXECUTE ON FUNCTION workflow_metadata_is_safe(jsonb) TO axora_app;
    GRANT EXECUTE ON FUNCTION
      axora_context_user_id(),
      axora_user_is_platform(uuid),
      axora_context_is_platform()
    TO axora_app;
  END IF;
END $$;

REVOKE ALL ON FUNCTION axora_user_is_platform(uuid) FROM PUBLIC;

COMMIT;
