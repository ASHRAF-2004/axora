BEGIN;

-- Support diagnostics deliberately run with less authority than ordinary
-- platform operations. The application supplies the authenticated user in a
-- transaction-local setting; this private helper resolves that setting only
-- when it still maps to a live canonical PLATFORM_OWNER or
-- TECHNICAL_SUPPORT assignment. Legacy roles and malformed scopes fail
-- closed.
CREATE OR REPLACE FUNCTION axora_authorized_support_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor_text text;
  actor_id uuid;
BEGIN
  actor_text := current_setting('axora.user_id', true);
  IF actor_text IS NULL
    OR actor_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Support actor context is unavailable';
  END IF;
  actor_id := actor_text::uuid;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users account
    JOIN public.role_assignments assignment
      ON assignment.user_id=account.id
    JOIN public.roles role ON role.id=assignment.role_id
    WHERE account.id=actor_id
      AND account.active=true
      AND account.account_status='ACTIVE'
      AND account.account_setup_completed_at IS NOT NULL
      AND account.account_kind='PLATFORM'
      AND assignment.active=true
      AND assignment.revoked_at IS NULL
      AND assignment.scope_type='PLATFORM'
      AND assignment.company_id IS NULL
      AND assignment.branch_id IS NULL
      AND assignment.supplier_id IS NULL
      AND (
        (role.role_key='PLATFORM_OWNER' AND account.is_owner=true)
        OR
        (role.role_key='TECHNICAL_SUPPORT' AND account.is_owner=false)
      )
  ) THEN
    RAISE EXCEPTION 'Support actor is not authorized';
  END IF;

  RETURN actor_id;
END $$;

-- The private workflow-email queue remains unreadable to axora_app. Expose
-- only aggregate operational counts, after the same live canonical actor
-- check, so diagnostics do not become a route to subjects, recipients,
-- payloads, provider identifiers, or tenant business rows.
CREATE OR REPLACE FUNCTION axora_support_system_summary()
RETURNS TABLE(
  checked_at timestamptz,
  latest_migration text,
  active_sessions integer,
  pending_invitations integer,
  email_exceptions integer,
  workflow_exceptions integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.axora_authorized_support_actor();

  RETURN QUERY
  SELECT
    now(),
    COALESCE((
      SELECT migration.filename
      FROM public.schema_migrations migration
      ORDER BY migration.filename DESC
      LIMIT 1
    ),'none'),
    (SELECT count(*)::integer
     FROM public.user_sessions session
     WHERE session.revoked_at IS NULL AND session.expires_at>now()),
    (SELECT count(*)::integer
     FROM public.account_setup_invitations invitation
     WHERE invitation.consumed_at IS NULL
       AND invitation.revoked_at IS NULL
       AND invitation.expires_at>now()),
    (
      (SELECT count(*)
       FROM public.account_setup_invitations invitation
       WHERE invitation.delivery_status IN ('FAILED','UNCERTAIN'))
      +
      (SELECT count(*)
       FROM public.transactional_email_outbox message
       WHERE message.delivery_status IN ('FAILED','UNCERTAIN'))
      +
      (SELECT count(*)
       FROM public.workflow_email_outbox message
       WHERE message.delivery_status IN ('FAILED','UNCERTAIN'))
    )::integer,
    (SELECT count(*)::integer
     FROM public.requests request
     JOIN public.lookup_values status ON status.id=request.status_id
     WHERE status.label IN ('On Hold','Cancelled'));
END $$;

-- axora_app cannot INSERT audit_logs directly. This capability accepts one of
-- two fixed event shapes and constructs all metadata inside the database. It
-- never accepts an entity name, action, JSON value, actor ID, company ID, or
-- arbitrary audit payload from the application.
CREATE OR REPLACE FUNCTION axora_record_support_audit(
  p_event_key text,
  p_target_id uuid,
  p_matched boolean,
  p_sessions_revoked integer,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  actor_id uuid;
  safe_reason text;
BEGIN
  actor_id := public.axora_authorized_support_actor();

  IF p_reason IS NULL OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Support audit reason is invalid';
  END IF;
  safe_reason := regexp_replace(btrim(p_reason),'[[:space:]]+',' ','g');
  IF char_length(safe_reason) < 10 OR char_length(safe_reason) > 240 THEN
    RAISE EXCEPTION 'Support audit reason is invalid';
  END IF;

  IF p_event_key='ACCOUNT_DIAGNOSTIC' THEN
    IF p_matched IS NULL
      OR p_sessions_revoked IS NOT NULL
      OR (p_matched AND p_target_id IS NULL)
      OR (NOT p_matched AND p_target_id IS NOT NULL)
      OR (p_target_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.users target WHERE target.id=p_target_id
      )) THEN
      RAISE EXCEPTION 'Support diagnostic audit shape is invalid';
    END IF;

    INSERT INTO public.audit_logs(
      entity_type,record_id,action,new_values,actor_id,company_id,reason
    ) VALUES (
      'support_account_diagnostic',p_target_id,'READ',
      CASE WHEN p_matched THEN jsonb_build_object(
        'matched',true,
        'fields',jsonb_build_array('account_status','scope','sessions')
      ) ELSE jsonb_build_object('matched',false) END,
      actor_id,NULL,safe_reason
    );
    RETURN;
  END IF;

  IF p_event_key='SESSION_CONTROL' THEN
    IF p_target_id IS NULL
      OR p_matched IS NOT NULL
      OR p_sessions_revoked IS NULL
      OR p_sessions_revoked < 0
      OR p_sessions_revoked > 100000
      OR p_target_id=actor_id
      OR NOT EXISTS (
        SELECT 1
        FROM public.users target
        WHERE target.id=p_target_id
          AND target.account_kind<>'PLATFORM'
          AND target.is_owner=false
      ) THEN
      RAISE EXCEPTION 'Support session audit shape is invalid';
    END IF;

    INSERT INTO public.audit_logs(
      entity_type,record_id,action,new_values,actor_id,company_id,reason
    ) VALUES (
      'support_session_control',p_target_id,'UPDATE',
      jsonb_build_object(
        'sessions_revoked',p_sessions_revoked,
        'auth_version_rotated',true
      ),actor_id,NULL,safe_reason
    );
    RETURN;
  END IF;

  RAISE EXCEPTION 'Support audit event is invalid';
END $$;

REVOKE ALL ON FUNCTION axora_authorized_support_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_support_system_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION axora_record_support_audit(
  text,uuid,boolean,integer,text
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON FUNCTION axora_authorized_support_actor() FROM axora_app;
    GRANT EXECUTE ON FUNCTION axora_support_system_summary() TO axora_app;
    GRANT EXECUTE ON FUNCTION axora_record_support_audit(
      text,uuid,boolean,integer,text
    ) TO axora_app;
  END IF;
END $$;

COMMIT;

-- Rollback: keep these compatible functions and their audit evidence during
-- an application rollback. Remove them only in a later reviewed forward
-- migration after no released application calls them.
