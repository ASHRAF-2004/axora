BEGIN;

ALTER TABLE public.company_deletion_tombstones
  ADD COLUMN command_id uuid,
  ADD COLUMN cleanup_status text NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (cleanup_status IN ('NOT_REQUIRED','PENDING','COMPLETE','FAILED'));
UPDATE public.company_deletion_tombstones SET command_id=gen_random_uuid()
WHERE command_id IS NULL;
ALTER TABLE public.company_deletion_tombstones ALTER COLUMN command_id SET NOT NULL;
ALTER TABLE public.company_deletion_tombstones ALTER COLUMN command_id SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX company_deletion_tombstones_command_uq
  ON public.company_deletion_tombstones(command_id);

CREATE TABLE public.company_deletion_ownership_rules (
  table_name text PRIMARY KEY CHECK (table_name ~ '^[a-z][a-z0-9_]{1,62}$'),
  unprotected_action text NOT NULL CHECK (unprotected_action IN ('HARD_DELETE','CASCADE_DELETE','BLOCK')),
  protected_action text NOT NULL CHECK (protected_action IN ('ANONYMIZE_AND_RETAIN','RETAIN_WITH_ACCESS_REVOKED','BLOCK')),
  rationale text NOT NULL CHECK (char_length(rationale) BETWEEN 8 AND 500)
);

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
)
SELECT table_name,'CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
  'Company-owned data is disposable only when no protected financial, delivery, receipt or legal evidence exists.'
FROM unnest(ARRAY[
  'account_setup_invitations','approval_limits','attachments','audit_logs',
  'branch_assignments','branch_delivery_service_levels','branches',
  'budget_accounts','budget_adjustment_decisions','budget_adjustment_requests',
  'budget_alert_states','budget_cycle_change_decisions','budget_cycle_change_requests',
  'budget_cycle_schedules','budget_ledger_entries','budget_periods',
  'budget_refresh_job_events','budget_refresh_jobs','budget_reservation_events',
  'budget_reservation_rollovers','budget_reservations','business_units',
  'company_assignments','company_brand_theme_events','company_brand_theme_workflows',
  'company_brand_themes','company_ceiling_history','company_duplicate_candidates',
  'company_logos','company_manager_continuity_events','company_memberships',
  'company_notification_preferences','company_onboarding_items',
  'company_onboarding_reminders','company_publication_history',
  'company_status_history','company_verification_history','cost_centres',
  'customer_three_way_matches','delegated_access_scopes','delivery_evidence',
  'delivery_job_assignments','delivery_job_events','delivery_job_lines','delivery_jobs',
  'delivery_locations','delivery_otp_challenges','delivery_otp_events',
  'delivery_proof_exceptions','delivery_tracking_points',
  'delivery_tracking_route_summaries','delivery_tracking_session_events',
  'delivery_tracking_sessions','delivery_workflow_commands','department_assignments',
  'departments','document_enqueue_failures','document_generation_events',
  'document_generation_jobs','email_delivery_attempts','email_delivery_usage_daily',
  'email_operations_delivery_queue','email_operations_events',
  'email_provider_delivery_lifecycle','fulfilment_purchase_assignments',
  'generated_documents','in_app_notifications','invoices',
  'organization_structure_history','payment_accountability_events',
  'procurement_variance_policies','procurement_variance_policy_changes',
  'procurement_variance_policy_decisions','products','receipt_lines','receipts',
  'request_actual_decisions','request_actual_submissions',
  'request_approval_decisions','request_approval_escalations',
  'request_approval_outbox','request_approval_policies','request_approval_snapshots',
  'request_line_receipt_baseline_sources','request_line_receipt_baselines','requests',
  'role_assignments','supplier_purchase_order_events',
  'supplier_purchase_order_workflows','supplier_quotation_responses',
  'supplier_rfq_acknowledgements','supplier_rfq_documents','supplier_rfqs','suppliers',
  'three_way_match_exceptions','three_way_matches','user_permission_overrides',
  'user_scopes','users','workflow_email_outbox','workflow_events'
]::text[]) AS owned(table_name)
JOIN pg_catalog.pg_namespace namespace ON namespace.nspname='public'
JOIN pg_catalog.pg_class relation
  ON relation.relnamespace=namespace.oid
 AND relation.relname=owned.table_name
 AND relation.relkind IN ('r','p');

INSERT INTO public.company_deletion_ownership_rules VALUES
  ('companies','HARD_DELETE','RETAIN_WITH_ACCESS_REVOKED','The tenant root is deleted only for unprotected disposable data; otherwise it is archived.'),
  ('company_deletion_tombstones','BLOCK','RETAIN_WITH_ACCESS_REVOKED','Deletion tombstones are minimum accountability evidence and are never cascaded.');

CREATE TABLE public.company_deletion_commands (
  command_id uuid PRIMARY KEY,
  requested_company_id uuid NOT NULL,
  company_code text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_mode text NOT NULL CHECK (requested_mode IN ('HARD_DELETE','ARCHIVE_RETAIN')),
  status text NOT NULL CHECK (status IN ('RUNNING','DATABASE_COMPLETE','CLEANUP_PENDING','COMPLETE','FAILED')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  impact jsonb NOT NULL CHECK (jsonb_typeof(impact)='object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE TABLE public.company_deletion_cleanup_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id uuid NOT NULL REFERENCES public.company_deletion_commands(command_id) ON DELETE RESTRICT,
  task_kind text NOT NULL CHECK (task_kind IN ('FILE','CACHE','SEARCH_INDEX')),
  locator text NOT NULL CHECK (char_length(locator) BETWEEN 1 AND 1200 AND locator !~ '[[:cntrl:]]'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETE','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  last_error text CHECK (last_error IS NULL OR char_length(last_error)<=500),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(command_id,task_kind,locator)
);

ALTER TABLE public.company_deletion_ownership_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_ownership_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_cleanup_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_deletion_cleanup_tasks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_deletion_ownership_rules,public.company_deletion_commands,
  public.company_deletion_cleanup_tasks FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.axora_company_deletion_impact_v2(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE base jsonb;
DECLARE owned_counts jsonb:='{}'::jsonb;
DECLARE rule record;
DECLARE row_count bigint;
DECLARE file_count bigint;
BEGIN
  base:=public.axora_company_deletion_impact(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_at
  );
  FOR rule IN SELECT table_name,unprotected_action,protected_action
    FROM public.company_deletion_ownership_rules
    WHERE table_name NOT IN ('companies','company_deletion_tombstones')
    ORDER BY table_name
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id=$1',rule.table_name)
      INTO row_count USING p_company_id;
    owned_counts:=owned_counts||jsonb_build_object(rule.table_name,jsonb_build_object(
      'count',row_count,'unprotectedAction',rule.unprotected_action,
      'protectedAction',rule.protected_action
    ));
  END LOOP;
  SELECT
    (SELECT count(*) FROM public.attachments WHERE company_id=p_company_id)
    +(SELECT count(*) FROM public.generated_documents WHERE company_id=p_company_id)
  INTO file_count;
  RETURN base||jsonb_build_object(
    'confirmation',CASE
      WHEN (base->>'protectedEvidence')::bigint>0 THEN 'ARCHIVE AND REVOKE '||(base->>'companyCode')
      ELSE 'PERMANENTLY DELETE '||(base->>'companyCode')
    END,
    'hardDeleteEligible',((base->>'protectedEvidence')::bigint=0 AND (base->>'inFlightWork')::bigint=0),
    'recommendedMode',CASE
      WHEN (base->>'inFlightWork')::bigint>0 THEN 'BLOCK'
      WHEN (base->>'protectedEvidence')::bigint=0 THEN 'HARD_DELETE'
      ELSE 'ARCHIVE_RETAIN'
    END,
    'ownership',owned_counts,'externalFileCount',file_count,
    'retentionPolicy','Protected financial, delivery and receipt evidence is retained with normal access revoked; no broader anonymization is performed without an approved retention policy.'
  );
END
$$;

CREATE OR REPLACE FUNCTION public.axora_validate_all_foreign_keys()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE relation record;
DECLARE orphaned boolean;
BEGIN
  FOR relation IN
    SELECT constraint_row.oid,
      child_namespace.nspname AS child_schema,child.relname AS child_table,
      parent_namespace.nspname AS parent_schema,parent.relname AS parent_table,
      string_agg(format('child.%I=parent.%I',child_attribute.attname,parent_attribute.attname),' AND ' ORDER BY columns.ordinality) AS join_sql,
      string_agg(format('child.%I IS NOT NULL',child_attribute.attname),' AND ' ORDER BY columns.ordinality) AS child_present_sql,
      min(parent_attribute.attname) AS parent_probe
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid=constraint_row.conrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=constraint_row.confrelid
    JOIN pg_namespace parent_namespace ON parent_namespace.oid=parent.relnamespace
    JOIN LATERAL unnest(constraint_row.conkey,constraint_row.confkey) WITH ORDINALITY
      AS columns(child_number,parent_number,ordinality) ON true
    JOIN pg_attribute child_attribute ON child_attribute.attrelid=child.oid AND child_attribute.attnum=columns.child_number
    JOIN pg_attribute parent_attribute ON parent_attribute.attrelid=parent.oid AND parent_attribute.attnum=columns.parent_number
    WHERE constraint_row.contype='f' AND child_namespace.nspname='public'
    GROUP BY constraint_row.oid,child_namespace.nspname,child.relname,parent_namespace.nspname,parent.relname
  LOOP
    EXECUTE format(
      'SELECT EXISTS(SELECT 1 FROM %I.%I child LEFT JOIN %I.%I parent ON %s WHERE %s AND parent.%I IS NULL)',
      relation.child_schema,relation.child_table,relation.parent_schema,relation.parent_table,
      relation.join_sql,relation.child_present_sql,relation.parent_probe
    ) INTO orphaned;
    IF orphaned THEN
      RAISE EXCEPTION 'Deletion would leave an orphan through foreign key %',relation.oid;
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.axora_delete_or_archive_company_v2(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_company_id uuid,
  p_command_id uuid,p_confirmation text,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE company_row public.companies%ROWTYPE;
DECLARE deletion_impact jsonb;
DECLARE prior_result jsonb;
DECLARE mode text;
DECLARE command_result jsonb;
DECLARE cleanup_count integer:=0;
DECLARE rule record;
BEGIN
  IF p_command_id IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'A deletion command and reason are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command_id::text,889));
  SELECT command.result INTO prior_result FROM public.company_deletion_commands command
  WHERE command.command_id=p_command_id AND command.actor_user_id=p_actor_user_id;
  IF prior_result IS NOT NULL THEN RETURN prior_result; END IF;
  SELECT * INTO company_row FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF company_row.id IS NULL OR EXISTS (
    SELECT 1 FROM public.company_deletion_tombstones tombstone WHERE tombstone.company_id=p_company_id
  ) THEN RAISE EXCEPTION 'Company deletion is unavailable'; END IF;
  deletion_impact:=public.axora_company_deletion_impact_v2(
    p_actor_user_id,p_actor_role_assignment_id,p_company_id,p_at
  );
  IF p_confirmation IS DISTINCT FROM deletion_impact->>'confirmation' THEN
    RAISE EXCEPTION 'The irreversible confirmation did not match';
  END IF;
  IF (deletion_impact->>'inFlightWork')::bigint>0 THEN
    RAISE EXCEPTION 'Company deletion is temporarily unavailable while work is in flight';
  END IF;
  mode:=CASE WHEN COALESCE((deletion_impact->>'hardDeleteEligible')::boolean,false)
    THEN 'HARD_DELETE' ELSE 'ARCHIVE_RETAIN' END;
  INSERT INTO public.company_deletion_commands(
    command_id,requested_company_id,company_code,actor_user_id,requested_mode,
    status,reason,impact,created_at
  ) VALUES (p_command_id,p_company_id,company_row.company_code,p_actor_user_id,
    mode,'RUNNING',btrim(p_reason),deletion_impact,p_at);

  IF mode='ARCHIVE_RETAIN' THEN
    command_result:=public.axora_delete_or_archive_company(
      p_actor_user_id,p_actor_role_assignment_id,p_company_id,
      'DELETE '||company_row.company_code,p_reason,p_at
    )||jsonb_build_object('commandId',p_command_id,'cleanupStatus','NOT_REQUIRED');
    UPDATE public.company_deletion_tombstones SET command_id=p_command_id,
      impact=deletion_impact,cleanup_status='NOT_REQUIRED' WHERE company_id=p_company_id;
    UPDATE public.company_deletion_commands SET status='COMPLETE',result=command_result,completed_at=p_at
    WHERE command_id=p_command_id;
    RETURN command_result;
  END IF;

  CREATE TEMP TABLE axora_delete_users(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_requests(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_request_lines(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_invoices(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_tokens(id uuid PRIMARY KEY,kind text NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_notifications(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_workflow_emails(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_products(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_suppliers(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_leads(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_role_assignments(id uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE axora_delete_documents(id uuid PRIMARY KEY) ON COMMIT DROP;

  INSERT INTO axora_delete_users SELECT id FROM public.users WHERE company_id=p_company_id;
  INSERT INTO axora_delete_requests SELECT id FROM public.requests WHERE company_id=p_company_id;
  INSERT INTO axora_delete_request_lines SELECT line.id FROM public.request_lines line JOIN axora_delete_requests request ON request.id=line.request_id;
  INSERT INTO axora_delete_invoices SELECT id FROM public.invoices WHERE company_id=p_company_id;
  INSERT INTO axora_delete_tokens SELECT token.id,'PASSWORD' FROM public.password_reset_tokens token JOIN axora_delete_users account ON account.id=token.user_id;
  INSERT INTO axora_delete_tokens SELECT token.id,'VERIFICATION' FROM public.email_verification_tokens token JOIN axora_delete_users account ON account.id=token.user_id;
  INSERT INTO axora_delete_notifications SELECT id FROM public.in_app_notifications WHERE company_id=p_company_id;
  INSERT INTO axora_delete_workflow_emails SELECT id FROM public.workflow_email_outbox WHERE company_id=p_company_id;
  INSERT INTO axora_delete_products SELECT id FROM public.products WHERE company_id=p_company_id;
  INSERT INTO axora_delete_suppliers SELECT id FROM public.suppliers WHERE company_id=p_company_id;
  INSERT INTO axora_delete_leads SELECT id FROM public.company_leads WHERE converted_company_id=p_company_id;
  INSERT INTO axora_delete_role_assignments SELECT id FROM public.role_assignments WHERE company_id=p_company_id OR user_id IN (SELECT id FROM axora_delete_users);
  INSERT INTO axora_delete_documents SELECT id FROM public.generated_documents WHERE company_id=p_company_id;

  INSERT INTO public.company_deletion_cleanup_tasks(command_id,task_kind,locator)
    SELECT p_command_id,'FILE',attachment.storage_path FROM public.attachments attachment
    WHERE attachment.company_id=p_company_id
  ON CONFLICT DO NOTHING;
  INSERT INTO public.company_deletion_cleanup_tasks(command_id,task_kind,locator)
    SELECT p_command_id,'FILE',document.storage_path FROM public.generated_documents document
    WHERE document.company_id=p_company_id
  ON CONFLICT DO NOTHING;
  INSERT INTO public.company_deletion_cleanup_tasks(command_id,task_kind,locator)
  VALUES (p_command_id,'CACHE','company:'||p_company_id::text),
    (p_command_id,'SEARCH_INDEX','company:'||p_company_id::text)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('session_replication_role','replica',true);

  DELETE FROM public.notification_email_relations WHERE notification_id IN (SELECT id FROM axora_delete_notifications) OR workflow_email_outbox_id IN (SELECT id FROM axora_delete_workflow_emails);
  DELETE FROM public.notification_state_events WHERE notification_id IN (SELECT id FROM axora_delete_notifications) OR related_notification_id IN (SELECT id FROM axora_delete_notifications);
  DELETE FROM public.notification_reminders WHERE original_notification_id IN (SELECT id FROM axora_delete_notifications) OR materialized_notification_id IN (SELECT id FROM axora_delete_notifications) OR recipient_user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.email_resend_versions WHERE original_delivery_id IN (SELECT id FROM axora_delete_workflow_emails) OR new_delivery_id IN (SELECT id FROM axora_delete_workflow_emails);
  DELETE FROM public.transactional_email_outbox outbox WHERE
    outbox.invoice_id IN (SELECT id FROM axora_delete_invoices)
    OR outbox.generated_document_id IN (SELECT id FROM axora_delete_documents)
    OR outbox.password_reset_token_id IN (SELECT id FROM axora_delete_tokens WHERE kind='PASSWORD')
    OR outbox.email_verification_token_id IN (SELECT id FROM axora_delete_tokens WHERE kind='VERIFICATION')
    OR outbox.contact_submission_id IN (
      SELECT submission.id FROM public.public_contact_submissions submission JOIN axora_delete_leads lead ON lead.id=submission.lead_id
    );
  DELETE FROM public.invoice_allocations WHERE invoice_id IN (SELECT id FROM axora_delete_invoices) OR request_line_id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.payments WHERE invoice_id IN (SELECT id FROM axora_delete_invoices);
  DELETE FROM public.approvals WHERE request_id IN (SELECT id FROM axora_delete_requests);
  DELETE FROM public.deliveries WHERE request_line_id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.quotations WHERE request_line_id IN (SELECT id FROM axora_delete_request_lines) OR supplier_id IN (SELECT id FROM axora_delete_suppliers);
  DELETE FROM public.request_line_supplier_rule_snapshots WHERE request_line_id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.request_actual_lines WHERE request_id IN (SELECT id FROM axora_delete_requests) OR request_line_id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.request_lines WHERE id IN (SELECT id FROM axora_delete_request_lines);
  DELETE FROM public.product_suppliers WHERE product_id IN (SELECT id FROM axora_delete_products) OR supplier_id IN (SELECT id FROM axora_delete_suppliers);
  DELETE FROM public.product_images WHERE product_id IN (SELECT id FROM axora_delete_products) OR created_by IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.supplier_memberships WHERE supplier_id IN (SELECT id FROM axora_delete_suppliers) OR user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.delegated_access_permissions WHERE delegated_access_id IN (
    SELECT access.id FROM public.delegated_access access WHERE access.grantee_user_id IN (SELECT id FROM axora_delete_users) OR access.grantee_role_assignment_id IN (SELECT id FROM axora_delete_role_assignments)
  );
  DELETE FROM public.delegated_access WHERE grantee_user_id IN (SELECT id FROM axora_delete_users) OR grantee_role_assignment_id IN (SELECT id FROM axora_delete_role_assignments);
  DELETE FROM public.company_lead_access_events WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_assignments WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_duplicate_candidates WHERE lead_id IN (SELECT id FROM axora_delete_leads) OR candidate_lead_id IN (SELECT id FROM axora_delete_leads) OR candidate_company_id=p_company_id;
  DELETE FROM public.company_lead_events WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_notes WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_status_history WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_lead_tasks WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.public_contact_submissions WHERE lead_id IN (SELECT id FROM axora_delete_leads);
  UPDATE public.company_leads SET duplicate_of_company_id=NULL WHERE duplicate_of_company_id=p_company_id AND id NOT IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.company_leads WHERE id IN (SELECT id FROM axora_delete_leads);
  DELETE FROM public.delivery_recovery_commands WHERE delivery_job_id IN (SELECT id FROM public.delivery_jobs WHERE company_id=p_company_id) OR previous_assignment_id IN (SELECT id FROM public.delivery_job_assignments WHERE company_id=p_company_id);
  DELETE FROM public.permission_change_history WHERE actor_user_id IN (SELECT id FROM axora_delete_users) OR target_user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.notification_commands WHERE actor_user_id IN (SELECT id FROM axora_delete_users) OR actor_role_assignment_id IN (SELECT id FROM axora_delete_role_assignments);
  DELETE FROM public.account_credentials WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.password_reset_tokens WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.email_verification_tokens WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.onboarding_progress WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.notification_preferences WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.profile_image_versions WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.tutorial_step_progress WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.user_atmosphere_preferences WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.user_profiles WHERE user_id IN (SELECT id FROM axora_delete_users);
  DELETE FROM public.user_sessions WHERE user_id IN (SELECT id FROM axora_delete_users);

  FOR rule IN SELECT table_name FROM public.company_deletion_ownership_rules
    WHERE unprotected_action IN ('HARD_DELETE','CASCADE_DELETE')
      AND table_name NOT IN ('companies','company_deletion_tombstones')
    ORDER BY table_name
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE company_id=$1',rule.table_name) USING p_company_id;
  END LOOP;
  DELETE FROM public.companies WHERE id=p_company_id;

  PERFORM set_config('session_replication_role','origin',true);
  PERFORM public.axora_validate_all_foreign_keys();

  SELECT count(*) INTO cleanup_count FROM public.company_deletion_cleanup_tasks
  WHERE command_id=p_command_id AND status='PENDING';
  INSERT INTO public.company_deletion_tombstones(
    company_id,company_code,deletion_mode,reason,deleted_by,deleted_at,impact,
    command_id,cleanup_status
  ) VALUES (
    p_company_id,company_row.company_code,'HARD_DELETED',btrim(p_reason),
    p_actor_user_id,p_at,deletion_impact,p_command_id,CASE WHEN cleanup_count>0 THEN 'PENDING' ELSE 'NOT_REQUIRED' END
  );
  INSERT INTO public.audit_logs(entity_type,record_id,action,new_values,actor_id,reason,occurred_at)
  VALUES ('companies',p_company_id,'HARD_DELETED',jsonb_build_object(
    'commandId',p_command_id,'cleanupTasks',cleanup_count
  ),p_actor_user_id,btrim(p_reason),p_at);
  command_result:=jsonb_build_object(
    'companyId',p_company_id,'mode','HARD_DELETED','commandId',p_command_id,
    'impact',deletion_impact,'cleanupStatus',CASE WHEN cleanup_count>0 THEN 'PENDING' ELSE 'NOT_REQUIRED' END,
    'pendingCleanupTasks',cleanup_count
  );
  UPDATE public.company_deletion_commands SET
    status=CASE WHEN cleanup_count>0 THEN 'CLEANUP_PENDING' ELSE 'COMPLETE' END,
    result=command_result,completed_at=p_at WHERE command_id=p_command_id;
  RETURN command_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('session_replication_role','origin',true);
  RAISE;
END
$$;

REVOKE ALL ON FUNCTION public.axora_company_deletion_impact_v2(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_validate_all_foreign_keys() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delete_or_archive_company_v2(uuid,uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_delete_or_archive_company(uuid,uuid,uuid,text,text,timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON public.company_deletion_ownership_rules,public.company_deletion_commands,
      public.company_deletion_cleanup_tasks FROM axora_app;
    REVOKE ALL ON FUNCTION public.axora_delete_or_archive_company(uuid,uuid,uuid,text,text,timestamptz) FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_company_deletion_impact_v2(uuid,uuid,uuid,timestamptz) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_delete_or_archive_company_v2(uuid,uuid,uuid,uuid,text,text,timestamptz) TO axora_app;
  END IF;
END $$;

COMMIT;
