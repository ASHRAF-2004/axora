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

  RAISE EXCEPTION 'Hard deletion is unavailable until the constraint-safe ownership DAG is installed by migration 091';
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
