-- P0-10: immutable, scoped and privacy-safe accountability evidence.
--
-- This migration deliberately normalizes every audit producer at the table
-- boundary. Existing specialized triggers keep their business vocabulary,
-- while this trigger adds the authority, scope, redaction and integrity
-- envelope consistently.

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS event_schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS actor_name_snapshot text,
  ADD COLUMN IF NOT EXISTS actor_email_snapshot text,
  ADD COLUMN IF NOT EXISTS actor_role_snapshot text,
  ADD COLUMN IF NOT EXISTS actor_role_assignment_id uuid,
  ADD COLUMN IF NOT EXISTS actor_authority_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS actor_scope_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS actor_effective_permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS actor_delegation_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS department_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_scope_id uuid,
  ADD COLUMN IF NOT EXISTS related_request_id uuid,
  ADD COLUMN IF NOT EXISTS related_budget_account_id uuid,
  ADD COLUMN IF NOT EXISTS related_document_id uuid,
  ADD COLUMN IF NOT EXISTS related_email_id uuid,
  ADD COLUMN IF NOT EXISTS related_delivery_id uuid,
  ADD COLUMN IF NOT EXISTS safe_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS result_code text,
  ADD COLUMN IF NOT EXISTS display_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS command_id text,
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN IF NOT EXISTS system_identity text,
  ADD COLUMN IF NOT EXISTS correction_of bigint REFERENCES public.audit_logs(id),
  ADD COLUMN IF NOT EXISTS integrity_partition text,
  ADD COLUMN IF NOT EXISTS previous_integrity_hash text,
  ADD COLUMN IF NOT EXISTS integrity_hash text;

CREATE TABLE IF NOT EXISTS public.audit_integrity_heads (
  partition_key text PRIMARY KEY,
  latest_event_id bigint,
  latest_hash text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.axora_try_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.axora_audit_redact(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_type text;
  v_result jsonb;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  v_type := jsonb_typeof(p_value);
  IF v_type = 'object' THEN
    SELECT COALESCE(
      jsonb_object_agg(
        entry.key,
        CASE
          WHEN lower(entry.key) ~ '(password|passphrase|token|secret|credential|authorization|cookie|session[_-]?key|private[_-]?key|api[_-]?key|cvv|cvc|card[_-]?number|bank[_-]?account|routing[_-]?number|iban|swift|email[_-]?(body|html|text)|(^|_)(email|phone)($|_)|file[_-]?(content|bytes)|image[_-]?(content|bytes)|document[_-]?(content|bytes)|avatar[_-]?(content|bytes)|logo[_-]?(content|bytes)|storage[_-]?path|(^|_)(latitude|longitude|coordinates|gps)($|_))'
            THEN to_jsonb('[REDACTED]'::text)
          ELSE public.axora_audit_redact(entry.value)
        END
      ),
      '{}'::jsonb
    )
    INTO v_result
    FROM jsonb_each(p_value) AS entry;
    RETURN v_result;
  ELSIF v_type = 'array' THEN
    SELECT COALESCE(jsonb_agg(public.axora_audit_redact(item.value)), '[]'::jsonb)
    INTO v_result
    FROM jsonb_array_elements(p_value) AS item;
    RETURN v_result;
  END IF;

  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.axora_audit_safe_diff(p_before jsonb, p_after jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT
      CASE WHEN jsonb_typeof(p_before) = 'object' THEN public.axora_audit_redact(p_before) ELSE '{}'::jsonb END AS before_value,
      CASE WHEN jsonb_typeof(p_after) = 'object' THEN public.axora_audit_redact(p_after) ELSE '{}'::jsonb END AS after_value
  ), keys AS (
    SELECT key FROM normalized, LATERAL jsonb_object_keys(before_value) AS key
    UNION
    SELECT key FROM normalized, LATERAL jsonb_object_keys(after_value) AS key
  ), changed AS (
    SELECT key
    FROM keys, normalized
    WHERE before_value -> key IS DISTINCT FROM after_value -> key
  )
  SELECT jsonb_build_object(
    'before', before_value,
    'after', after_value,
    'changedFields', COALESCE((SELECT jsonb_agg(key ORDER BY key) FROM changed), '[]'::jsonb)
  )
  FROM normalized;
$$;

CREATE OR REPLACE FUNCTION public.axora_audit_hash(p_event public.audit_logs)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT encode(
    sha256(convert_to((to_jsonb(p_event) - 'integrity_hash')::text, 'UTF8')),
    'hex'
  );
$$;

-- Existing rows are retained, privacy-normalized and explicitly marked as
-- legacy evidence. We never invent historical authority that was not captured.
UPDATE public.audit_logs AS audit
SET
  event_type = COALESCE(audit.event_type, upper(replace(audit.entity_type, '_', '.')) || '.' || upper(audit.action)),
  actor_kind = CASE WHEN audit.actor_id IS NULL THEN 'SYSTEM' ELSE 'USER' END,
  actor_name_snapshot = COALESCE(
    audit.actor_name_snapshot,
    (SELECT COALESCE(to_jsonb(app_user) ->> 'name', to_jsonb(app_user) ->> 'full_name')
       FROM public.users AS app_user WHERE app_user.id = audit.actor_id),
    CASE WHEN audit.actor_id IS NULL THEN 'Axora system' ELSE 'Historical user' END
  ),
  actor_email_snapshot = COALESCE(
    audit.actor_email_snapshot,
    (SELECT to_jsonb(app_user) ->> 'email' FROM public.users AS app_user WHERE app_user.id = audit.actor_id)
  ),
  actor_authority_snapshot = CASE
    WHEN audit.actor_authority_snapshot = '{}'::jsonb THEN jsonb_build_object(
      'capture', 'legacy_unknown',
      'actorId', audit.actor_id,
      'occurredAt', audit.occurred_at
    )
    ELSE audit.actor_authority_snapshot
  END,
  old_values = public.axora_audit_redact(audit.old_values),
  new_values = public.axora_audit_redact(audit.new_values),
  safe_diff = public.axora_audit_safe_diff(audit.old_values, audit.new_values),
  company_id = COALESCE(
    audit.company_id,
    public.axora_try_uuid(audit.new_values ->> 'company_id'),
    public.axora_try_uuid(audit.new_values ->> 'companyId'),
    public.axora_try_uuid(audit.old_values ->> 'company_id'),
    public.axora_try_uuid(audit.old_values ->> 'companyId')
  ),
  branch_id = COALESCE(
    audit.branch_id,
    public.axora_try_uuid(audit.new_values ->> 'branch_id'),
    public.axora_try_uuid(audit.new_values ->> 'branchId'),
    public.axora_try_uuid(audit.old_values ->> 'branch_id'),
    public.axora_try_uuid(audit.old_values ->> 'branchId')
  ),
  department_id = COALESCE(
    audit.department_id,
    public.axora_try_uuid(audit.new_values ->> 'department_id'),
    public.axora_try_uuid(audit.new_values ->> 'departmentId'),
    public.axora_try_uuid(audit.old_values ->> 'department_id'),
    public.axora_try_uuid(audit.old_values ->> 'departmentId')
  ),
  supplier_id = COALESCE(
    audit.supplier_id,
    public.axora_try_uuid(audit.new_values ->> 'supplier_id'),
    public.axora_try_uuid(audit.new_values ->> 'supplierId'),
    public.axora_try_uuid(audit.old_values ->> 'supplier_id'),
    public.axora_try_uuid(audit.old_values ->> 'supplierId')
  ),
  related_request_id = COALESCE(
    audit.related_request_id,
    public.axora_try_uuid(audit.new_values ->> 'request_id'),
    public.axora_try_uuid(audit.new_values ->> 'requestId'),
    public.axora_try_uuid(audit.old_values ->> 'request_id'),
    public.axora_try_uuid(audit.old_values ->> 'requestId'),
    CASE WHEN audit.entity_type IN ('requests', 'purchase_requests') THEN audit.record_id END
  ),
  related_budget_account_id = COALESCE(
    audit.related_budget_account_id,
    public.axora_try_uuid(audit.new_values ->> 'budget_account_id'),
    public.axora_try_uuid(audit.new_values ->> 'budgetAccountId'),
    public.axora_try_uuid(audit.old_values ->> 'budget_account_id'),
    public.axora_try_uuid(audit.old_values ->> 'budgetAccountId')
  ),
  related_document_id = COALESCE(
    audit.related_document_id,
    public.axora_try_uuid(audit.new_values ->> 'attachment_id'),
    public.axora_try_uuid(audit.new_values ->> 'document_id'),
    public.axora_try_uuid(audit.old_values ->> 'attachment_id'),
    public.axora_try_uuid(audit.old_values ->> 'document_id'),
    CASE WHEN audit.entity_type IN ('attachments', 'supplier_documents') THEN audit.record_id END
  ),
  related_email_id = COALESCE(
    audit.related_email_id,
    public.axora_try_uuid(audit.new_values ->> 'email_message_id'),
    public.axora_try_uuid(audit.new_values ->> 'emailMessageId'),
    public.axora_try_uuid(audit.old_values ->> 'email_message_id'),
    public.axora_try_uuid(audit.old_values ->> 'emailMessageId'),
    CASE WHEN audit.entity_type IN ('email_messages', 'email_events') THEN audit.record_id END
  ),
  related_delivery_id = COALESCE(
    audit.related_delivery_id,
    public.axora_try_uuid(audit.new_values ->> 'delivery_id'),
    public.axora_try_uuid(audit.new_values ->> 'deliveryId'),
    public.axora_try_uuid(audit.old_values ->> 'delivery_id'),
    public.axora_try_uuid(audit.old_values ->> 'deliveryId'),
    CASE WHEN audit.entity_type IN ('deliveries', 'delivery_evidence') THEN audit.record_id END
  ),
  reason_code = COALESCE(audit.reason_code, 'LEGACY_EVENT'),
  result_code = COALESCE(audit.result_code, 'RECORDED'),
  outcome = CASE
    WHEN upper(audit.action) ~ '(FAIL|DENIED|REJECTED|ERROR)' THEN 'FAILURE'
    ELSE COALESCE(NULLIF(audit.outcome, ''), 'SUCCESS')
  END,
  display_timezone = COALESCE(NULLIF(audit.display_timezone, ''), 'UTC'),
  correlation_id = COALESCE(NULLIF(audit.correlation_id, ''), gen_random_uuid()::text),
  integrity_partition = COALESCE(audit.company_id::text, 'PLATFORM');

UPDATE public.audit_logs
SET integrity_partition = COALESCE(company_id::text, 'PLATFORM');

TRUNCATE TABLE public.audit_integrity_heads;

DO $$
DECLARE
  v_event public.audit_logs%ROWTYPE;
  v_partition text := NULL;
  v_previous text := NULL;
BEGIN
  FOR v_event IN
    SELECT * FROM public.audit_logs
    ORDER BY integrity_partition, occurred_at, id
  LOOP
    IF v_partition IS DISTINCT FROM v_event.integrity_partition THEN
      v_partition := v_event.integrity_partition;
      v_previous := NULL;
    END IF;

    v_event.previous_integrity_hash := v_previous;
    v_event.integrity_hash := public.axora_audit_hash(v_event);

    UPDATE public.audit_logs
    SET previous_integrity_hash = v_event.previous_integrity_hash,
        integrity_hash = v_event.integrity_hash
    WHERE id = v_event.id;

    INSERT INTO public.audit_integrity_heads(partition_key, latest_event_id, latest_hash, updated_at)
    VALUES (v_partition, v_event.id, v_event.integrity_hash, clock_timestamp())
    ON CONFLICT (partition_key) DO UPDATE
      SET latest_event_id = EXCLUDED.latest_event_id,
          latest_hash = EXCLUDED.latest_hash,
          updated_at = EXCLUDED.updated_at;

    v_previous := v_event.integrity_hash;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.axora_prepare_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_id uuid;
  v_assignment_id uuid;
  v_snapshot jsonb;
  v_user jsonb;
  v_scope jsonb;
  v_previous text;
  v_permissions text[] := ARRAY[]::text[];
BEGIN
  v_actor_id := COALESCE(
    NEW.actor_id,
    public.axora_try_uuid(NULLIF(current_setting('axora.user_id', true), ''))
  );
  v_assignment_id := COALESCE(
    NEW.actor_role_assignment_id,
    public.axora_try_uuid(NULLIF(current_setting('axora.role_assignment_id', true), ''))
  );

  NEW.actor_id := v_actor_id;
  NEW.actor_role_assignment_id := v_assignment_id;
  NEW.actor_kind := CASE WHEN v_actor_id IS NULL THEN 'SYSTEM' ELSE 'USER' END;
  NEW.system_identity := COALESCE(
    NEW.system_identity,
    NULLIF(current_setting('axora.system_identity', true), ''),
    CASE WHEN v_actor_id IS NULL THEN current_user END
  );

  IF v_actor_id IS NOT NULL THEN
    SELECT to_jsonb(app_user) INTO v_user
    FROM public.users AS app_user
    WHERE app_user.id = v_actor_id;

    NEW.actor_name_snapshot := COALESCE(
      NEW.actor_name_snapshot,
      v_user ->> 'name',
      v_user ->> 'full_name',
      'User ' || v_actor_id::text
    );
    NEW.actor_email_snapshot := COALESCE(NEW.actor_email_snapshot, v_user ->> 'email');
    NEW.display_timezone := COALESCE(
      NULLIF(current_setting('axora.display_timezone', true), ''),
      NULLIF(NEW.display_timezone, ''),
      v_user ->> 'timezone',
      'UTC'
    );

    IF v_assignment_id IS NOT NULL THEN
      BEGIN
        v_snapshot := public.axora_effective_access_snapshot(v_actor_id, v_assignment_id, clock_timestamp());
      EXCEPTION WHEN OTHERS THEN
        v_snapshot := NULL;
      END;
    END IF;

    IF v_snapshot IS NULL THEN
      v_snapshot := jsonb_build_object(
        'capture', 'no_selected_assignment',
        'actorId', v_actor_id,
        'roleAssignmentId', v_assignment_id,
        'capturedAt', clock_timestamp()
      );
    END IF;
  ELSE
    NEW.display_timezone := COALESCE(NULLIF(NEW.display_timezone, ''), 'UTC');
    v_snapshot := jsonb_build_object(
      'capture', 'system',
      'systemIdentity', NEW.system_identity,
      'capturedAt', clock_timestamp()
    );
    NEW.actor_name_snapshot := COALESCE(NEW.actor_name_snapshot, NEW.system_identity, 'Axora system');
  END IF;

  SELECT scope_row
  INTO v_scope
  FROM jsonb_array_elements(COALESCE(v_snapshot -> 'scopes', '[]'::jsonb)) AS scope_row
  ORDER BY CASE scope_row ->> 'type'
    WHEN 'DEPARTMENT' THEN 1
    WHEN 'BRANCH' THEN 2
    WHEN 'COMPANY' THEN 3
    WHEN 'SUPPLIER' THEN 4
    WHEN 'DELIVERY' THEN 5
    WHEN 'PLATFORM' THEN 6
    ELSE 7
  END
  LIMIT 1;
  v_scope := COALESCE(v_scope, '{}'::jsonb);

  NEW.actor_authority_snapshot := COALESCE(NULLIF(NEW.actor_authority_snapshot, '{}'::jsonb), v_snapshot, '{}'::jsonb);
  NEW.actor_role_snapshot := COALESCE(NEW.actor_role_snapshot, v_snapshot ->> 'roleKey');
  NEW.actor_scope_snapshot := COALESCE(
    NULLIF(NEW.actor_scope_snapshot, '{}'::jsonb),
    jsonb_build_object(
      'accountKind', v_snapshot -> 'accountKind',
      'scopes', COALESCE(v_snapshot -> 'scopes', '[]'::jsonb)
    )
  );
  NEW.actor_delegation_snapshot := COALESCE(v_snapshot -> 'delegations', '[]'::jsonb);

  SELECT COALESCE(array_agg(DISTINCT permission_key ORDER BY permission_key), ARRAY[]::text[])
  INTO v_permissions
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(v_snapshot -> 'rolePermissions', '[]'::jsonb)) AS permission_key
    UNION ALL
    SELECT permission_override ->> 'permission'
    FROM jsonb_array_elements(COALESCE(v_snapshot -> 'permissionOverrides', '[]'::jsonb)) AS permission_override
    WHERE upper(COALESCE(permission_override ->> 'effect', '')) = 'GRANT'
    UNION ALL
    SELECT jsonb_array_elements_text(COALESCE(delegation -> 'permissions', '[]'::jsonb))
    FROM jsonb_array_elements(COALESCE(v_snapshot -> 'delegations', '[]'::jsonb)) AS delegation
  ) AS granted
  WHERE permission_key IS NOT NULL
    AND permission_key <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_snapshot -> 'permissionOverrides', '[]'::jsonb)) AS denied
      WHERE upper(COALESCE(denied ->> 'effect', '')) = 'DENY'
        AND denied ->> 'permission' = granted.permission_key
    );
  NEW.actor_effective_permissions := v_permissions;

  NEW.old_values := public.axora_audit_redact(NEW.old_values);
  NEW.new_values := public.axora_audit_redact(NEW.new_values);
  NEW.safe_diff := public.axora_audit_safe_diff(NEW.old_values, NEW.new_values);
  NEW.event_type := COALESCE(
    NULLIF(NEW.event_type, ''),
    upper(replace(NEW.entity_type, '_', '.')) || '.' || upper(NEW.action)
  );
  NEW.event_schema_version := COALESCE(NEW.event_schema_version, 1);

  NEW.company_id := COALESCE(
    NEW.company_id,
    public.axora_try_uuid(NEW.new_values ->> 'company_id'),
    public.axora_try_uuid(NEW.new_values ->> 'companyId'),
    public.axora_try_uuid(NEW.old_values ->> 'company_id'),
    public.axora_try_uuid(NEW.old_values ->> 'companyId'),
    public.axora_try_uuid(v_scope ->> 'companyId')
  );
  NEW.branch_id := COALESCE(
    NEW.branch_id,
    public.axora_try_uuid(NEW.new_values ->> 'branch_id'),
    public.axora_try_uuid(NEW.new_values ->> 'branchId'),
    public.axora_try_uuid(NEW.old_values ->> 'branch_id'),
    public.axora_try_uuid(NEW.old_values ->> 'branchId'),
    public.axora_try_uuid(v_scope ->> 'branchId')
  );
  NEW.department_id := COALESCE(
    NEW.department_id,
    public.axora_try_uuid(NEW.new_values ->> 'department_id'),
    public.axora_try_uuid(NEW.new_values ->> 'departmentId'),
    public.axora_try_uuid(NEW.old_values ->> 'department_id'),
    public.axora_try_uuid(NEW.old_values ->> 'departmentId'),
    public.axora_try_uuid(v_scope ->> 'departmentId')
  );
  NEW.supplier_id := COALESCE(
    NEW.supplier_id,
    public.axora_try_uuid(NEW.new_values ->> 'supplier_id'),
    public.axora_try_uuid(NEW.new_values ->> 'supplierId'),
    public.axora_try_uuid(NEW.old_values ->> 'supplier_id'),
    public.axora_try_uuid(NEW.old_values ->> 'supplierId'),
    public.axora_try_uuid(v_scope ->> 'supplierId')
  );
  NEW.related_request_id := COALESCE(
    NEW.related_request_id,
    public.axora_try_uuid(NEW.new_values ->> 'request_id'),
    public.axora_try_uuid(NEW.new_values ->> 'requestId'),
    public.axora_try_uuid(NEW.old_values ->> 'request_id'),
    public.axora_try_uuid(NEW.old_values ->> 'requestId'),
    CASE WHEN NEW.entity_type IN ('requests', 'purchase_requests') THEN NEW.record_id END
  );
  NEW.related_budget_account_id := COALESCE(
    NEW.related_budget_account_id,
    public.axora_try_uuid(NEW.new_values ->> 'budget_account_id'),
    public.axora_try_uuid(NEW.new_values ->> 'budgetAccountId'),
    public.axora_try_uuid(NEW.old_values ->> 'budget_account_id'),
    public.axora_try_uuid(NEW.old_values ->> 'budgetAccountId')
  );
  NEW.related_document_id := COALESCE(
    NEW.related_document_id,
    public.axora_try_uuid(NEW.new_values ->> 'attachment_id'),
    public.axora_try_uuid(NEW.new_values ->> 'document_id'),
    public.axora_try_uuid(NEW.old_values ->> 'attachment_id'),
    public.axora_try_uuid(NEW.old_values ->> 'document_id'),
    CASE WHEN NEW.entity_type IN ('attachments', 'supplier_documents') THEN NEW.record_id END
  );
  NEW.related_email_id := COALESCE(
    NEW.related_email_id,
    public.axora_try_uuid(NEW.new_values ->> 'email_message_id'),
    public.axora_try_uuid(NEW.new_values ->> 'emailMessageId'),
    public.axora_try_uuid(NEW.old_values ->> 'email_message_id'),
    public.axora_try_uuid(NEW.old_values ->> 'emailMessageId'),
    CASE WHEN NEW.entity_type IN ('email_messages', 'email_events') THEN NEW.record_id END
  );
  NEW.related_delivery_id := COALESCE(
    NEW.related_delivery_id,
    public.axora_try_uuid(NEW.new_values ->> 'delivery_id'),
    public.axora_try_uuid(NEW.new_values ->> 'deliveryId'),
    public.axora_try_uuid(NEW.old_values ->> 'delivery_id'),
    public.axora_try_uuid(NEW.old_values ->> 'deliveryId'),
    CASE WHEN NEW.entity_type IN ('deliveries', 'delivery_evidence') THEN NEW.record_id END
  );

  NEW.reason := COALESCE(NEW.reason, NULLIF(current_setting('axora.change_reason', true), ''));
  NEW.reason_code := COALESCE(NEW.reason_code, NULLIF(current_setting('axora.reason_code', true), ''), 'BUSINESS_CHANGE');
  NEW.result_code := COALESCE(NEW.result_code, NULLIF(current_setting('axora.result_code', true), ''), 'RECORDED');
  NEW.outcome := COALESCE(
    NULLIF(current_setting('axora.outcome', true), ''),
    CASE WHEN upper(NEW.action) ~ '(FAIL|DENIED|REJECTED|ERROR)' THEN 'FAILURE' END,
    NULLIF(NEW.outcome, ''),
    'SUCCESS'
  );
  NEW.correlation_id := COALESCE(NULLIF(NEW.correlation_id, ''), NULLIF(current_setting('axora.correlation_id', true), ''), gen_random_uuid()::text);
  NEW.command_id := COALESCE(NULLIF(NEW.command_id, ''), NULLIF(current_setting('axora.command_id', true), ''));
  NEW.session_id := COALESCE(NEW.session_id, public.axora_try_uuid(NULLIF(current_setting('axora.session_id', true), '')));
  NEW.integrity_partition := COALESCE(NEW.company_id::text, 'PLATFORM');

  INSERT INTO public.audit_integrity_heads(partition_key)
  VALUES (NEW.integrity_partition)
  ON CONFLICT (partition_key) DO NOTHING;

  SELECT latest_hash INTO v_previous
  FROM public.audit_integrity_heads
  WHERE partition_key = NEW.integrity_partition
  FOR UPDATE;

  NEW.previous_integrity_hash := v_previous;
  NEW.integrity_hash := public.axora_audit_hash(NEW);

  UPDATE public.audit_integrity_heads
  SET latest_event_id = NEW.id,
      latest_hash = NEW.integrity_hash,
      updated_at = clock_timestamp()
  WHERE partition_key = NEW.integrity_partition;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_prepare_event ON public.audit_logs;
CREATE TRIGGER audit_logs_prepare_event
BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.axora_prepare_audit_event();

CREATE OR REPLACE FUNCTION public.axora_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Audit evidence is append-only; insert a correction event instead'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER audit_logs_append_only
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_audit_mutation();

-- Add generic coverage only where no specialized accountability trigger exists.
-- The existence and id checks make this forward-compatible across installations.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'users', 'user_sessions', 'invitations', 'role_assignments', 'delegations',
    'companies', 'company_leads', 'company_branches', 'company_departments',
    'budget_accounts', 'budget_ledger_entries', 'budget_reservations',
    'requests', 'request_lines', 'request_approvals',
    'deliveries', 'delivery_evidence', 'attachments',
    'suppliers', 'supplier_documents', 'products',
    'email_messages', 'email_events'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'id'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM pg_trigger AS trigger_row
         JOIN pg_class AS relation_row ON relation_row.oid = trigger_row.tgrelid
         JOIN pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
         JOIN pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
         WHERE namespace_row.nspname = 'public'
           AND relation_row.relname = v_table
           AND NOT trigger_row.tgisinternal
           AND (trigger_row.tgname ILIKE '%audit%' OR function_row.proname ILIKE '%audit%')
       ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_change()',
        v_table || '_audit',
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.axora_audit_rows(
  p_actor_id uuid,
  p_role_assignment_id uuid,
  p_event_type text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_record_id uuid DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_delivery_id uuid DEFAULT NULL,
  p_outcome text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id bigint,
  event_type text,
  entity_type text,
  record_id uuid,
  action text,
  actor_id uuid,
  actor_name text,
  actor_role text,
  company_id uuid,
  branch_id uuid,
  department_id uuid,
  related_request_id uuid,
  related_delivery_id uuid,
  outcome text,
  reason_code text,
  reason text,
  safe_diff jsonb,
  correlation_id text,
  integrity_hash text,
  occurred_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH access AS (
    SELECT public.axora_effective_access_snapshot(p_actor_id, p_role_assignment_id, clock_timestamp()) AS snapshot
  )
  SELECT
    audit.id,
    audit.event_type,
    audit.entity_type,
    audit.record_id,
    audit.action,
    audit.actor_id,
    audit.actor_name_snapshot,
    audit.actor_role_snapshot,
    audit.company_id,
    audit.branch_id,
    audit.department_id,
    audit.related_request_id,
    audit.related_delivery_id,
    audit.outcome,
    audit.reason_code,
    audit.reason,
    audit.safe_diff,
    audit.correlation_id,
    audit.integrity_hash,
    audit.occurred_at
  FROM public.audit_logs AS audit
  CROSS JOIN access
  WHERE public.axora_snapshot_has_permission(
      access.snapshot,
      'audit.view',
      CASE
        WHEN audit.company_id IS NULL THEN 'PLATFORM'
        WHEN audit.department_id IS NOT NULL THEN 'DEPARTMENT'
        WHEN audit.branch_id IS NOT NULL THEN 'BRANCH'
        ELSE 'COMPANY'
      END,
      audit.company_id,
      audit.branch_id,
      audit.department_id,
      audit.supplier_id
    )
    AND (p_event_type IS NULL OR audit.event_type = p_event_type OR audit.entity_type = p_event_type)
    AND (p_action IS NULL OR audit.action = p_action)
    AND (p_actor IS NULL OR audit.actor_name_snapshot ILIKE '%' || p_actor || '%' OR audit.actor_email_snapshot ILIKE '%' || p_actor || '%')
    AND (p_record_id IS NULL OR audit.record_id = p_record_id)
    AND (p_company_id IS NULL OR audit.company_id = p_company_id)
    AND (p_branch_id IS NULL OR audit.branch_id = p_branch_id)
    AND (p_department_id IS NULL OR audit.department_id = p_department_id)
    AND (p_request_id IS NULL OR audit.related_request_id = p_request_id)
    AND (p_delivery_id IS NULL OR audit.related_delivery_id = p_delivery_id)
    AND (p_outcome IS NULL OR audit.outcome = p_outcome)
    AND (p_from IS NULL OR audit.occurred_at >= p_from)
    AND (p_to IS NULL OR audit.occurred_at <= p_to)
  ORDER BY audit.occurred_at DESC, audit.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
$$;

CREATE OR REPLACE FUNCTION public.axora_record_accountability_access(
  p_actor_id uuid,
  p_role_assignment_id uuid,
  p_event_key text,
  p_target_id uuid DEFAULT NULL,
  p_row_count integer DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT clock_timestamp()
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_snapshot jsonb;
  v_scope jsonb;
  v_permission text;
  v_company_id uuid;
  v_branch_id uuid;
  v_department_id uuid;
  v_supplier_id uuid;
  v_scope_type text;
  v_event_id bigint;
BEGIN
  IF p_event_key NOT IN ('AUDIT_EXPORT', 'REQUEST_EXPORT', 'ATTACHMENT_DOWNLOAD', 'SUPPLIER_DOCUMENT_DOWNLOAD') THEN
    RAISE EXCEPTION 'Unsupported accountability access event'
      USING ERRCODE = '22023';
  END IF;

  v_snapshot := public.axora_effective_access_snapshot(p_actor_id, p_role_assignment_id, p_occurred_at);
  v_permission := CASE p_event_key
    WHEN 'AUDIT_EXPORT' THEN 'audit.view'
    WHEN 'REQUEST_EXPORT' THEN 'report.view'
    WHEN 'ATTACHMENT_DOWNLOAD' THEN 'document.download'
    WHEN 'SUPPLIER_DOCUMENT_DOWNLOAD' THEN 'supplier.portal.view'
  END;
  SELECT scope_row
  INTO v_scope
  FROM jsonb_array_elements(COALESCE(v_snapshot -> 'scopes', '[]'::jsonb)) AS scope_row
  ORDER BY CASE scope_row ->> 'type'
    WHEN 'DEPARTMENT' THEN 1
    WHEN 'BRANCH' THEN 2
    WHEN 'COMPANY' THEN 3
    WHEN 'SUPPLIER' THEN 4
    WHEN 'DELIVERY' THEN 5
    WHEN 'PLATFORM' THEN 6
    ELSE 7
  END
  LIMIT 1;
  v_scope := COALESCE(v_scope, '{}'::jsonb);
  v_scope_type := COALESCE(v_scope ->> 'type', 'PLATFORM');
  v_company_id := public.axora_try_uuid(v_scope ->> 'companyId');
  v_branch_id := public.axora_try_uuid(v_scope ->> 'branchId');
  v_department_id := public.axora_try_uuid(v_scope ->> 'departmentId');
  v_supplier_id := public.axora_try_uuid(v_scope ->> 'supplierId');

  IF NOT public.axora_snapshot_has_permission(
    v_snapshot,
    v_permission,
    v_scope_type,
    v_company_id,
    v_branch_id,
    v_department_id,
    v_supplier_id
  ) THEN
    RAISE EXCEPTION 'Accountability access denied'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs (
    event_type,
    entity_type,
    record_id,
    action,
    actor_id,
    actor_role_assignment_id,
    company_id,
    branch_id,
    department_id,
    supplier_id,
    related_document_id,
    reason_code,
    result_code,
    outcome,
    occurred_at,
    new_values
  )
  VALUES (
    p_event_key,
    CASE
      WHEN p_event_key = 'AUDIT_EXPORT' THEN 'audit_logs'
      WHEN p_event_key = 'REQUEST_EXPORT' THEN 'requests'
      WHEN p_event_key = 'ATTACHMENT_DOWNLOAD' THEN 'attachments'
      ELSE 'supplier_documents'
    END,
    p_target_id,
    CASE WHEN p_event_key LIKE '%EXPORT' THEN 'EXPORT' ELSE 'DOWNLOAD' END,
    p_actor_id,
    p_role_assignment_id,
    v_company_id,
    v_branch_id,
    v_department_id,
    v_supplier_id,
    CASE WHEN p_event_key LIKE '%DOWNLOAD' THEN p_target_id END,
    p_event_key,
    'AUTHORIZED',
    'SUCCESS',
    p_occurred_at,
    jsonb_build_object('rowCount', p_row_count, 'targetId', p_target_id)
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.axora_verify_audit_integrity(p_partition text DEFAULT NULL)
RETURNS TABLE(event_id bigint, partition_key text, is_valid boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH ordered AS (
    SELECT
      audit,
      lag(audit.integrity_hash) OVER (
        PARTITION BY audit.integrity_partition
        ORDER BY audit.occurred_at, audit.id
      ) AS expected_previous
    FROM public.audit_logs AS audit
    WHERE p_partition IS NULL OR audit.integrity_partition = p_partition
  )
  SELECT
    (ordered.audit).id,
    (ordered.audit).integrity_partition,
    (ordered.audit).integrity_hash = public.axora_audit_hash(ordered.audit)
      AND (ordered.audit).previous_integrity_hash IS NOT DISTINCT FROM ordered.expected_previous
  FROM ordered
  ORDER BY (ordered.audit).integrity_partition, (ordered.audit).occurred_at, (ordered.audit).id;
$$;

CREATE INDEX IF NOT EXISTS audit_logs_event_time_idx ON public.audit_logs(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_time_idx ON public.audit_logs(actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_company_time_idx ON public.audit_logs(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_branch_time_idx ON public.audit_logs(branch_id, occurred_at DESC) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_department_time_idx ON public.audit_logs(department_id, occurred_at DESC) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_request_time_idx ON public.audit_logs(related_request_id, occurred_at DESC) WHERE related_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_delivery_time_idx ON public.audit_logs(related_delivery_id, occurred_at DESC) WHERE related_delivery_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_outcome_time_idx ON public.audit_logs(outcome, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_correlation_idx ON public.audit_logs(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_integrity_partition_idx ON public.audit_logs(integrity_partition, occurred_at, id);

REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC;
REVOKE ALL ON TABLE public.audit_integrity_heads FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_audit_rows(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_record_accountability_access(uuid, uuid, text, uuid, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_verify_audit_integrity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_prepare_audit_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_reject_audit_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') THEN
    REVOKE ALL ON TABLE public.audit_logs FROM axora_app;
    REVOKE ALL ON TABLE public.audit_integrity_heads FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_audit_rows(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, integer) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_record_accountability_access(uuid, uuid, text, uuid, integer, timestamptz) TO axora_app;
    REVOKE ALL ON FUNCTION public.axora_verify_audit_integrity(text) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_prepare_audit_event() FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_reject_audit_mutation() FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_audit_redact(jsonb) FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_audit_hash(public.audit_logs) FROM axora_app;
  END IF;
END;
$$;

COMMENT ON TABLE public.audit_logs IS 'Append-only accountability evidence. Corrections are new rows linked through correction_of.';
COMMENT ON COLUMN public.audit_logs.actor_authority_snapshot IS 'Authority captured at event time; legacy_unknown explicitly denotes unavailable historical authority.';
COMMENT ON COLUMN public.audit_logs.integrity_hash IS 'SHA-256 link in a per-company (or platform) transactionally serialized integrity chain.';
