BEGIN;

SELECT pg_advisory_xact_lock(96217731);

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '300s';

-- A removed Axora account is permanently erased as an authentication and
-- personal-data identity. The UUID row remains only as a non-identifying
-- referential tombstone because production contains immutable invoices,
-- requests, deliveries and accountability evidence that reference it.
-- Replacing the email immediately releases the original address for a brand
-- new account with a new UUID and no inherited access or history.
CREATE TABLE IF NOT EXISTS public.user_deletion_commands (
  command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL UNIQUE
    REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL,
  status text NOT NULL CHECK (
    status IN ('RUNNING','CLEANUP_PENDING','COMPLETE','FAILED')
  ),
  reason text NOT NULL CHECK (
    char_length(btrim(reason)) BETWEEN 3 AND 500
    AND reason !~ '[[:cntrl:]]'
  ),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status IN ('COMPLETE','FAILED'))=(completed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.user_deletion_cleanup_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL
    REFERENCES public.user_deletion_commands(command_id) ON DELETE CASCADE,
  task_kind text NOT NULL CHECK (task_kind='FILE'),
  locator text NOT NULL CHECK (
    char_length(locator) BETWEEN 1 AND 1200
    AND locator !~ '[[:cntrl:]]'
    AND locator !~ '(^|/)\.\.(/|$)'
    AND locator !~ '^/'
  ),
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','LEASED','RETRY_WAIT','COMPLETE','TERMINAL_FAILED')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  leased_by text CHECK (
    leased_by IS NULL OR leased_by ~ '^[A-Za-z0-9._:-]{1,160}$'
  ),
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_error text CHECK (
    last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 500
  ),
  outcome jsonb CHECK (outcome IS NULL OR jsonb_typeof(outcome)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(command_id,task_kind,locator),
  CHECK (
    (status='LEASED' AND lease_id IS NOT NULL AND leased_by IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR (status<>'LEASED' AND lease_id IS NULL AND leased_by IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status IN ('COMPLETE','TERMINAL_FAILED'))=(completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS user_deletion_cleanup_tasks_claim_idx
  ON public.user_deletion_cleanup_tasks(
    status,available_at,created_at,id
  ) WHERE status IN ('PENDING','RETRY_WAIT','LEASED');

CREATE TABLE IF NOT EXISTS public.user_deletion_execution_authorizations (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  command_id uuid NOT NULL UNIQUE
    REFERENCES public.user_deletion_commands(command_id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(backend_pid,transaction_id)
);

ALTER TABLE public.user_deletion_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_deletion_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_deletion_cleanup_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_deletion_cleanup_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_deletion_execution_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_deletion_execution_authorizations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_deletion_commands FROM PUBLIC;
REVOKE ALL ON TABLE public.user_deletion_cleanup_tasks FROM PUBLIC;
REVOKE ALL ON TABLE public.user_deletion_execution_authorizations FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_user_deletion_trigger_is_authorized()
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_deletion_execution_authorizations authorization
    JOIN public.user_deletion_commands deletion_command
      ON deletion_command.command_id=authorization.command_id
    WHERE authorization.backend_pid=pg_backend_pid()
      AND authorization.transaction_id=txid_current()
      AND deletion_command.status='RUNNING'
  )
$$;

-- Audit evidence remains append-only for every ordinary caller. The narrow
-- deletion capability may redact personal snapshots and then recompute the
-- complete integrity chain before its authorization row is removed.
CREATE OR REPLACE FUNCTION public.axora_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF TG_OP='UPDATE' AND public.axora_user_deletion_trigger_is_authorized()
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION
    'Audit evidence is append-only; insert a correction event instead';
END
$$;

CREATE OR REPLACE FUNCTION public.axora_user_privacy_scrub_json(
  p_value jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  value_kind text;
  result_value jsonb;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  value_kind:=jsonb_typeof(p_value);
  IF value_kind='object' THEN
    SELECT COALESCE(jsonb_object_agg(
      entry.key,
      CASE
        WHEN lower(entry.key) ~ '(^|_)(email|display_name|phone|requester_contact|requested_by|avatar_file_name|avatar_sha256)($|_)'
          OR lower(entry.key) IN (
            'displayname','recipientemail','recipientname','contactemail',
            'contactphone','requestercontact','requestedby'
          )
        THEN to_jsonb('[DELETED]'::text)
        ELSE public.axora_user_privacy_scrub_json(entry.value)
      END
    ),'{}'::jsonb)
    INTO result_value
    FROM jsonb_each(p_value) entry;
    RETURN result_value;
  ELSIF value_kind='array' THEN
    SELECT COALESCE(
      jsonb_agg(public.axora_user_privacy_scrub_json(item.value)),
      '[]'::jsonb
    ) INTO result_value
    FROM jsonb_array_elements(p_value) item;
    RETURN result_value;
  END IF;
  RETURN p_value;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_rebuild_audit_integrity_after_privacy_purge()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  audit_event public.audit_logs%ROWTYPE;
  current_partition text:=NULL;
  previous_hash text:=NULL;
BEGIN
  IF NOT public.axora_user_deletion_trigger_is_authorized() THEN
    RAISE EXCEPTION 'Audit privacy repair is unavailable';
  END IF;

  LOCK TABLE public.audit_logs IN ACCESS EXCLUSIVE MODE;
  DELETE FROM public.audit_integrity_heads;

  FOR audit_event IN
    SELECT * FROM public.audit_logs
    ORDER BY integrity_partition,occurred_at,id
  LOOP
    IF current_partition IS DISTINCT FROM audit_event.integrity_partition THEN
      current_partition:=audit_event.integrity_partition;
      previous_hash:=NULL;
    END IF;

    audit_event.previous_integrity_hash:=previous_hash;
    audit_event.integrity_hash:=public.axora_audit_hash(audit_event);

    UPDATE public.audit_logs
    SET previous_integrity_hash=audit_event.previous_integrity_hash,
        integrity_hash=audit_event.integrity_hash
    WHERE id=audit_event.id;

    INSERT INTO public.audit_integrity_heads(
      partition_key,latest_event_id,latest_hash,updated_at
    ) VALUES (
      current_partition,audit_event.id,audit_event.integrity_hash,
      clock_timestamp()
    )
    ON CONFLICT(partition_key) DO UPDATE
    SET latest_event_id=EXCLUDED.latest_event_id,
        latest_hash=EXCLUDED.latest_hash,
        updated_at=EXCLUDED.updated_at;

    previous_hash:=audit_event.integrity_hash;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_refresh_user_deletion_command(
  p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  command_row public.user_deletion_commands%ROWTYPE;
  pending_count integer;
  failed_count integer;
  command_result jsonb;
BEGIN
  SELECT * INTO command_row
  FROM public.user_deletion_commands
  WHERE command_id=p_command_id
  FOR UPDATE;
  IF command_row.command_id IS NULL THEN
    RAISE EXCEPTION 'User deletion command is unavailable';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE status IN ('PENDING','LEASED','RETRY_WAIT')
    )::integer,
    count(*) FILTER (WHERE status='TERMINAL_FAILED')::integer
  INTO pending_count,failed_count
  FROM public.user_deletion_cleanup_tasks
  WHERE command_id=p_command_id;

  command_result:=COALESCE(command_row.result,'{}'::jsonb);
  UPDATE public.user_deletion_commands
  SET status=CASE
        WHEN failed_count>0 THEN 'FAILED'
        WHEN pending_count>0 THEN 'CLEANUP_PENDING'
        ELSE 'COMPLETE'
      END,
      completed_at=CASE
        WHEN pending_count>0 THEN NULL
        ELSE COALESCE(completed_at,p_at)
      END
  WHERE command_id=p_command_id;

  RETURN command_result;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_reconcile_user_deletion_cleanup_tasks(
  p_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  changed integer;
  command_identifier uuid;
  affected_commands uuid[]:=ARRAY[]::uuid[];
BEGIN
  WITH expired AS (
    UPDATE public.user_deletion_cleanup_tasks task
    SET status=CASE
          WHEN task.attempts>=task.max_attempts
            THEN 'TERMINAL_FAILED'
          ELSE 'RETRY_WAIT'
        END,
        available_at=CASE
          WHEN task.attempts>=task.max_attempts THEN task.available_at
          ELSE p_at+make_interval(
            secs=>LEAST(3600,5*power(2,LEAST(task.attempts,9))::integer)
          )
        END,
        last_error=COALESCE(task.last_error,'worker_lease_expired'),
        lease_id=NULL,
        leased_by=NULL,
        lease_expires_at=NULL,
        updated_at=p_at,
        completed_at=CASE
          WHEN task.attempts>=task.max_attempts THEN p_at ELSE NULL
        END
    WHERE task.status='LEASED' AND task.lease_expires_at<=p_at
    RETURNING task.command_id
  )
  SELECT count(*)::integer,
    COALESCE(array_agg(DISTINCT command_id),ARRAY[]::uuid[])
  INTO changed,affected_commands
  FROM expired;

  FOREACH command_identifier IN ARRAY affected_commands
  LOOP
    PERFORM public.axora_refresh_user_deletion_command(
      command_identifier,p_at
    );
  END LOOP;
  RETURN changed;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_claim_user_deletion_cleanup_task(
  p_worker_id text,
  p_lease_seconds integer,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  task_id uuid,
  command_id uuid,
  task_kind text,
  locator text,
  attempts integer,
  max_attempts integer,
  lease_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF p_worker_id !~ '^[A-Za-z0-9._:-]{1,160}$'
    OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Cleanup worker claim is unavailable';
  END IF;
  PERFORM public.axora_reconcile_user_deletion_cleanup_tasks(p_at);
  RETURN QUERY
  WITH candidate AS (
    SELECT task.id
    FROM public.user_deletion_cleanup_tasks task
    WHERE task.status IN ('PENDING','RETRY_WAIT')
      AND task.available_at<=p_at
    ORDER BY task.available_at,task.created_at,task.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.user_deletion_cleanup_tasks task
  SET status='LEASED',
      attempts=task.attempts+1,
      lease_id=gen_random_uuid(),
      leased_by=p_worker_id,
      lease_expires_at=p_at+make_interval(secs=>p_lease_seconds),
      last_started_at=p_at,
      updated_at=p_at,
      completed_at=NULL
  FROM candidate
  WHERE task.id=candidate.id
  RETURNING task.id,task.command_id,task.task_kind,task.locator,
    task.attempts,task.max_attempts,task.lease_id;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_complete_user_deletion_cleanup_task(
  p_task_id uuid,
  p_lease_id uuid,
  p_worker_id text,
  p_outcome jsonb,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  task_row public.user_deletion_cleanup_tasks%ROWTYPE;
BEGIN
  IF p_outcome IS NULL OR jsonb_typeof(p_outcome)<>'object' THEN
    RAISE EXCEPTION 'Cleanup completion is unavailable';
  END IF;
  SELECT * INTO task_row
  FROM public.user_deletion_cleanup_tasks
  WHERE id=p_task_id
  FOR UPDATE;
  IF task_row.id IS NULL OR task_row.status<>'LEASED'
    OR task_row.lease_id IS DISTINCT FROM p_lease_id
    OR task_row.leased_by IS DISTINCT FROM p_worker_id
    OR task_row.lease_expires_at<=p_at THEN
    RAISE EXCEPTION 'Cleanup worker lease is unavailable';
  END IF;

  UPDATE public.user_deletion_cleanup_tasks
  SET status='COMPLETE',
      lease_id=NULL,
      leased_by=NULL,
      lease_expires_at=NULL,
      last_error=NULL,
      outcome=p_outcome,
      completed_at=p_at,
      updated_at=p_at
  WHERE id=p_task_id;

  RETURN public.axora_refresh_user_deletion_command(
    task_row.command_id,p_at
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_fail_user_deletion_cleanup_task(
  p_task_id uuid,
  p_lease_id uuid,
  p_worker_id text,
  p_error text,
  p_retryable boolean,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  task_row public.user_deletion_cleanup_tasks%ROWTYPE;
  terminal boolean;
BEGIN
  IF char_length(btrim(COALESCE(p_error,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Cleanup failure report is unavailable';
  END IF;
  SELECT * INTO task_row
  FROM public.user_deletion_cleanup_tasks
  WHERE id=p_task_id
  FOR UPDATE;
  IF task_row.id IS NULL OR task_row.status<>'LEASED'
    OR task_row.lease_id IS DISTINCT FROM p_lease_id
    OR task_row.leased_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Cleanup worker lease is unavailable';
  END IF;

  terminal:=NOT p_retryable OR task_row.attempts>=task_row.max_attempts;
  UPDATE public.user_deletion_cleanup_tasks
  SET status=CASE
        WHEN terminal THEN 'TERMINAL_FAILED' ELSE 'RETRY_WAIT'
      END,
      available_at=CASE
        WHEN terminal THEN available_at
        ELSE p_at+make_interval(
          secs=>LEAST(3600,5*power(2,LEAST(attempts,9))::integer)
        )
      END,
      lease_id=NULL,
      leased_by=NULL,
      lease_expires_at=NULL,
      last_error=left(
        regexp_replace(btrim(p_error),'[[:cntrl:]]+',' ','g'),500
      ),
      completed_at=CASE WHEN terminal THEN p_at ELSE NULL END,
      updated_at=p_at
  WHERE id=p_task_id;

  RETURN public.axora_refresh_user_deletion_command(
    task_row.command_id,p_at
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_remove_user_account(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  clean_reason text:=btrim(COALESCE(p_reason,''));
  target public.users%ROWTYPE;
  target_snapshot jsonb;
  command_identifier uuid:=gen_random_uuid();
  existing_result jsonb;
  tombstone_email text;
  revoked_assignments integer:=0;
  revoked_invitations integer:=0;
  disabled_overrides integer:=0;
  cancelled_workflow_emails integer:=0;
  resulting_auth_version integer;
  command_result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_target_user_id IS NULL OR p_actor_user_id=p_target_user_id
    OR p_at IS NULL OR char_length(clean_reason) NOT BETWEEN 3 AND 500
    OR clean_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'The user account cannot be permanently deleted';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('axora-user-deletion:'||p_target_user_id::text,0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.users actor
    JOIN public.role_assignments assignment
      ON assignment.id=p_actor_role_assignment_id
     AND assignment.user_id=actor.id
     AND assignment.active
     AND assignment.revoked_at IS NULL
     AND assignment.scope_type='PLATFORM'
    JOIN public.roles role ON role.id=assignment.role_id
    WHERE actor.id=p_actor_user_id
      AND actor.active
      AND actor.account_status='ACTIVE'
      AND actor.is_owner
      AND role.role_key='PLATFORM_OWNER'
  ) THEN
    RAISE EXCEPTION 'The user account cannot be permanently deleted';
  END IF;

  SELECT deletion_command.result INTO existing_result
  FROM public.user_deletion_commands deletion_command
  WHERE deletion_command.target_user_id=p_target_user_id;
  IF existing_result IS NOT NULL THEN RETURN existing_result; END IF;

  SELECT * INTO target
  FROM public.users
  WHERE id=p_target_user_id
  FOR UPDATE;
  IF target.id IS NULL OR target.is_owner THEN
    RAISE EXCEPTION 'The user account cannot be permanently deleted';
  END IF;

  IF target.account_status<>'DEACTIVATED' THEN
    target_snapshot:=public.axora_lock_user_target_access(
      p_actor_user_id,p_actor_role_assignment_id,
      'user.deactivate',p_target_user_id,p_at
    );
    IF target_snapshot IS NULL THEN
      RAISE EXCEPTION 'The user account cannot be permanently deleted';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.account_setup_invitations invitation
    WHERE invitation.user_id=p_target_user_id
      AND invitation.delivery_status='SENDING'
  ) OR EXISTS (
    SELECT 1
    FROM public.transactional_email_outbox outbox
    WHERE outbox.delivery_status='SENDING'
      AND (
        outbox.password_reset_token_id IN (
          SELECT token.id
          FROM public.password_reset_tokens token
          WHERE token.user_id=p_target_user_id
        )
        OR outbox.email_verification_token_id IN (
          SELECT token.id
          FROM public.email_verification_tokens token
          WHERE token.user_id=p_target_user_id
        )
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.workflow_email_outbox outbox
    WHERE outbox.recipient_user_id=p_target_user_id
      AND outbox.delivery_status='SENDING'
  ) THEN
    RAISE EXCEPTION
      'The user account cannot be deleted while email delivery is in flight';
  END IF;

  INSERT INTO public.user_deletion_commands(
    command_id,target_user_id,actor_user_id,actor_role_assignment_id,
    status,reason,created_at
  ) VALUES (
    command_identifier,p_target_user_id,p_actor_user_id,
    p_actor_role_assignment_id,'RUNNING',clean_reason,p_at
  );

  INSERT INTO public.user_deletion_execution_authorizations(
    backend_pid,transaction_id,command_id,target_user_id
  ) VALUES (
    pg_backend_pid(),txid_current(),command_identifier,p_target_user_id
  );

  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  PERFORM set_config(
    'axora.role_assignment_id',p_actor_role_assignment_id::text,true
  );
  PERFORM set_config('axora.change_reason',clean_reason,true);
  PERFORM set_config('axora.reason_code','USER_PERMANENT_DELETION',true);
  PERFORM set_config('axora.result_code','IDENTITY_PURGED',true);
  PERFORM set_config('axora.outcome','SUCCESS',true);
  PERFORM set_config('axora.command_id',command_identifier::text,true);

  INSERT INTO public.user_deletion_cleanup_tasks(
    command_id,task_kind,locator
  )
  SELECT command_identifier,'FILE',path_value
  FROM public.profile_image_versions image
  CROSS JOIN LATERAL unnest(ARRAY[
    image.storage_path_64,image.storage_path_128,image.storage_path_256
  ]) path_value
  WHERE image.user_id=p_target_user_id
  ON CONFLICT(command_id,task_kind,locator) DO NOTHING;

  UPDATE public.workflow_email_outbox
  SET delivery_status='CANCELLED',
      last_delivery_error='account_removed'
  WHERE recipient_user_id=p_target_user_id
    AND delivery_status='PENDING';
  GET DIAGNOSTICS cancelled_workflow_emails=ROW_COUNT;

  UPDATE public.role_assignments
  SET active=false,
      revoked_at=COALESCE(revoked_at,p_at),
      revoked_by=COALESCE(revoked_by,p_actor_user_id),
      revoke_reason=COALESCE(revoke_reason,clean_reason)
  WHERE user_id=p_target_user_id
    AND active
    AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked_assignments=ROW_COUNT;

  UPDATE public.user_permission_overrides
  SET active=false,
      ends_at=COALESCE(ends_at,p_at)
  WHERE user_id=p_target_user_id AND active;
  GET DIAGNOSTICS disabled_overrides=ROW_COUNT;

  UPDATE public.user_scopes
  SET active=false,
      ends_at=COALESCE(ends_at,p_at)
  WHERE user_id=p_target_user_id AND active;

  UPDATE public.delegated_access
  SET status='REVOKED',
      revoked_at=COALESCE(revoked_at,p_at),
      revoked_by=COALESCE(revoked_by,p_actor_user_id)
  WHERE grantee_user_id=p_target_user_id
    AND status='ACTIVE';

  UPDATE public.company_memberships
  SET status='ENDED',
      ended_at=COALESCE(ended_at,p_at),
      updated_at=p_at
  WHERE user_id=p_target_user_id AND status<>'ENDED';

  UPDATE public.branch_assignments
  SET status='ENDED',
      ended_at=COALESCE(ended_at,p_at)
  WHERE user_id=p_target_user_id AND status<>'ENDED';

  UPDATE public.department_assignments
  SET status='ENDED',
      ended_at=COALESCE(ended_at,p_at)
  WHERE user_id=p_target_user_id AND status<>'ENDED';

  UPDATE public.supplier_memberships
  SET status='ENDED',
      ended_at=COALESCE(ended_at,p_at)
  WHERE user_id=p_target_user_id AND status<>'ENDED';

  DELETE FROM public.approval_limits
  WHERE user_id=p_target_user_id;

  UPDATE public.requests
  SET requested_by='Deleted user',
      requester_contact=''
  WHERE created_by=p_target_user_id
    AND (requested_by<>'Deleted user' OR requester_contact<>'');

  SELECT count(*)::integer INTO revoked_invitations
  FROM public.account_setup_invitations
  WHERE user_id=p_target_user_id;

  DELETE FROM public.account_setup_invitations
  WHERE user_id=p_target_user_id;
  DELETE FROM public.password_reset_tokens
  WHERE user_id=p_target_user_id;
  DELETE FROM public.email_verification_tokens
  WHERE user_id=p_target_user_id;
  DELETE FROM public.account_credentials
  WHERE user_id=p_target_user_id;
  DELETE FROM public.user_sessions
  WHERE user_id=p_target_user_id;
  DELETE FROM public.notification_preferences
  WHERE user_id=p_target_user_id;
  DELETE FROM public.user_atmosphere_preferences
  WHERE user_id=p_target_user_id;
  DELETE FROM public.tutorial_step_progress
  WHERE user_id=p_target_user_id;
  DELETE FROM public.onboarding_progress
  WHERE user_id=p_target_user_id;
  DELETE FROM public.delivery_agent_profiles
  WHERE user_id=p_target_user_id;
  DELETE FROM public.company_manager_profiles
  WHERE manager_user_id=p_target_user_id;

  UPDATE public.user_profiles
  SET active_avatar_version_id=NULL
  WHERE user_id=p_target_user_id;
  DELETE FROM public.profile_image_versions
  WHERE user_id=p_target_user_id;
  DELETE FROM public.user_profiles
  WHERE user_id=p_target_user_id;

  tombstone_email:=
    'deleted-'||replace(p_target_user_id::text,'-','')||'@deleted.invalid';

  UPDATE public.users
  SET email=tombstone_email,
      display_name='Deleted user',
      password_hash='!permanently-deleted!',
      active=false,
      last_login_at=NULL,
      is_owner=false,
      company_id=NULL,
      branch_id=NULL,
      account_setup_completed_at=NULL,
      auth_version=auth_version+1,
      account_kind='PLATFORM',
      account_status='DEACTIVATED',
      email_verified_at=NULL,
      updated_at=p_at
  WHERE id=p_target_user_id
  RETURNING auth_version INTO resulting_auth_version;

  -- Scrub historical audit snapshots that belonged to the removed identity or
  -- contain its account/profile/request personal fields. Business record IDs,
  -- dates, amounts and non-personal evidence remain intact.
  UPDATE public.audit_logs audit
  SET actor_name_snapshot='Deleted user',
      actor_email_snapshot=NULL,
      actor_role_snapshot=NULL,
      actor_authority_snapshot=jsonb_build_object(
        'capture','deleted_identity','actorId',p_target_user_id
      ),
      actor_scope_snapshot=jsonb_build_object(
        'accountKind','DELETED','scopes','[]'::jsonb
      ),
      actor_effective_permissions=ARRAY[]::text[],
      actor_delegation_snapshot='[]'::jsonb
  WHERE audit.actor_id=p_target_user_id;

  UPDATE public.audit_logs audit
  SET old_values=CASE
        WHEN audit.entity_type='users' AND audit.record_id=p_target_user_id
          THEN jsonb_build_object(
            'id',p_target_user_id,'privacyState','DELETED'
          )
        ELSE public.axora_user_privacy_scrub_json(audit.old_values)
      END,
      new_values=CASE
        WHEN audit.entity_type='users' AND audit.record_id=p_target_user_id
          THEN jsonb_build_object(
            'id',p_target_user_id,'privacyState','DELETED'
          )
        ELSE public.axora_user_privacy_scrub_json(audit.new_values)
      END,
      safe_diff=jsonb_build_object(
        'before',jsonb_build_object('privacyState','DELETED'),
        'after',jsonb_build_object('privacyState','DELETED'),
        'changedFields','[]'::jsonb
      )
  WHERE (audit.entity_type='users' AND audit.record_id=p_target_user_id)
     OR audit.actor_id=p_target_user_id
     OR COALESCE(audit.old_values->>'user_id','')=p_target_user_id::text
     OR COALESCE(audit.new_values->>'user_id','')=p_target_user_id::text
     OR audit.related_request_id IN (
       SELECT request.id
       FROM public.requests request
       WHERE request.created_by=p_target_user_id
     );

  PERFORM public.axora_rebuild_audit_integrity_after_privacy_purge();

  command_result:=jsonb_build_object(
    'removed',true,
    'userId',p_target_user_id,
    'authVersion',resulting_auth_version,
    'revokedAssignments',revoked_assignments,
    'revokedInvitations',revoked_invitations,
    'disabledOverrides',disabled_overrides,
    'cancelledWorkflowEmails',cancelled_workflow_emails
  );

  UPDATE public.user_deletion_commands
  SET result=command_result
  WHERE command_id=command_identifier;

  DELETE FROM public.user_deletion_execution_authorizations
  WHERE backend_pid=pg_backend_pid()
    AND transaction_id=txid_current();

  PERFORM public.axora_refresh_user_deletion_command(
    command_identifier,p_at
  );

  RETURN command_result;
END
$$;

REVOKE ALL ON FUNCTION public.axora_user_deletion_trigger_is_authorized()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_user_privacy_scrub_json(jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_rebuild_audit_integrity_after_privacy_purge()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_refresh_user_deletion_command(uuid,timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_reconcile_user_deletion_cleanup_tasks(timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_claim_user_deletion_cleanup_task(text,integer,timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_complete_user_deletion_cleanup_task(
    uuid,uuid,text,jsonb,timestamptz
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_fail_user_deletion_cleanup_task(
    uuid,uuid,text,text,boolean,timestamptz
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_remove_user_account(
  uuid,uuid,uuid,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_reject_audit_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.user_deletion_commands FROM axora_app;
    REVOKE ALL ON TABLE public.user_deletion_cleanup_tasks FROM axora_app;
    REVOKE ALL ON TABLE public.user_deletion_execution_authorizations
      FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_remove_user_account(
      uuid,uuid,uuid,text,timestamptz
    ) TO axora_app;
    REVOKE ALL ON FUNCTION
      public.axora_user_deletion_trigger_is_authorized(),
      public.axora_user_privacy_scrub_json(jsonb),
      public.axora_rebuild_audit_integrity_after_privacy_purge(),
      public.axora_refresh_user_deletion_command(uuid,timestamptz),
      public.axora_reconcile_user_deletion_cleanup_tasks(timestamptz),
      public.axora_claim_user_deletion_cleanup_task(
        text,integer,timestamptz
      ),
      public.axora_complete_user_deletion_cleanup_task(
        uuid,uuid,text,jsonb,timestamptz
      ),
      public.axora_fail_user_deletion_cleanup_task(
        uuid,uuid,text,text,boolean,timestamptz
      ),
      public.axora_reject_audit_mutation()
    FROM axora_app;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='axora_cleanup_worker'
  ) THEN
    REVOKE ALL ON TABLE public.user_deletion_commands
      FROM axora_cleanup_worker;
    REVOKE ALL ON TABLE public.user_deletion_cleanup_tasks
      FROM axora_cleanup_worker;
    REVOKE ALL ON TABLE public.user_deletion_execution_authorizations
      FROM axora_cleanup_worker;
    GRANT EXECUTE ON FUNCTION
      public.axora_claim_user_deletion_cleanup_task(
        text,integer,timestamptz
      ),
      public.axora_complete_user_deletion_cleanup_task(
        uuid,uuid,text,jsonb,timestamptz
      ),
      public.axora_fail_user_deletion_cleanup_task(
        uuid,uuid,text,text,boolean,timestamptz
      )
    TO axora_cleanup_worker;
  END IF;
END
$$;

-- Upgrade the previous soft-deletion contract. Existing non-owner rows already
-- marked DEACTIVATED are anonymized now, which releases their original email
-- addresses without assigning any old access or history to a future account.
DO $upgrade$
DECLARE
  owner_user_id uuid;
  owner_assignment_id uuid;
  removed_account record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE account_status='DEACTIVATED' AND NOT is_owner
      AND email NOT LIKE 'deleted-%@deleted.invalid'
  ) THEN
    SELECT account.id,assignment.id
    INTO owner_user_id,owner_assignment_id
    FROM public.users account
    JOIN public.role_assignments assignment
      ON assignment.user_id=account.id
     AND assignment.active
     AND assignment.revoked_at IS NULL
     AND assignment.scope_type='PLATFORM'
    JOIN public.roles role ON role.id=assignment.role_id
    WHERE account.active
      AND account.account_status='ACTIVE'
      AND account.is_owner
      AND role.role_key='PLATFORM_OWNER'
    ORDER BY assignment.assigned_at,assignment.id
    LIMIT 1;

    IF owner_user_id IS NULL OR owner_assignment_id IS NULL THEN
      RAISE EXCEPTION
        'An active Platform Owner is required to purge legacy removed users';
    END IF;

    FOR removed_account IN
      SELECT id
      FROM public.users
      WHERE account_status='DEACTIVATED' AND NOT is_owner
        AND email NOT LIKE 'deleted-%@deleted.invalid'
      ORDER BY created_at,id
    LOOP
      PERFORM public.axora_remove_user_account(
        owner_user_id,owner_assignment_id,removed_account.id,
        'Migration 096 permanent identity purge',clock_timestamp()
      );
    END LOOP;
  END IF;
END
$upgrade$;

COMMIT;
