\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') THEN
    RAISE EXCEPTION 'Required database role axora_app does not exist';
  END IF;
END
$$;

SELECT format('GRANT CONNECT ON DATABASE %I TO axora_app', current_database())
\gexec

GRANT USAGE ON SCHEMA public TO axora_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO axora_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM axora_app;
GRANT DELETE ON TABLE public.products, public.product_suppliers, public.product_images TO axora_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO axora_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO axora_app;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.audit_logs FROM axora_app;
GRANT SELECT ON TABLE public.audit_logs TO axora_app;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.schema_migrations FROM axora_app;
GRANT SELECT ON TABLE public.schema_migrations TO axora_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO axora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO axora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO axora_app;

-- Broad grants keep ordinary application tables and routines deployable, but
-- migrations 026 onward deliberately expose sensitive state only through
-- narrow SECURITY DEFINER capabilities. Re-apply those boundaries here because
-- this script runs after migrations during hybrid imports and baseline resets.
REVOKE ALL ON TABLE
  public.workflow_email_outbox,
  public.request_line_receipt_baselines,
  public.request_line_receipt_baseline_sources,
  public.email_provider_events,
  public.email_recipient_suppressions,
  public.email_provider_delivery_lifecycle,
  public.public_visitor_counter_state,
  public.public_visitor_claims,
  public.public_visitor_claim_tokens,
  public.permissions,
  public.role_permissions,
  public.departments,
  public.department_assignments,
  public.user_scopes,
  public.user_permission_overrides,
  public.approval_limits,
  public.delegated_access,
  public.delegated_access_permissions,
  public.delegated_access_scopes,
  public.permission_change_history,
  public.role_assignment_management_rules
FROM axora_app;

GRANT SELECT ON TABLE public.permissions,public.role_permissions
TO axora_app;

-- Invitation creation still inserts one trigger-validated assignment. Every
-- post-setup role change uses the audited lifecycle commands below.
REVOKE UPDATE,DELETE ON TABLE public.role_assignments FROM axora_app;
GRANT SELECT,INSERT ON TABLE public.role_assignments TO axora_app;

REVOKE ALL ON FUNCTION
  public.axora_workflow_email_available_at(text,timestamptz),
  public.axora_workflow_notification_recipient_is_valid(uuid,uuid,uuid),
  public.axora_workflow_email_recipient_is_valid(uuid,uuid,uuid),
  public.protect_workflow_email_outbox(),
  public.audit_workflow_email_outbox(),
  public.axora_effective_received_quantity_internal(uuid),
  public.validate_receipt_line(),
  public.validate_delivery_job_line(),
  public.validate_request_received_transition(),
  public.validate_new_invoice_workflow(),
  public.prevent_invoice_overpayment(),
  public.axora_email_recipient_fingerprint(text),
  public.protect_email_provider_event(),
  public.axora_authorized_support_actor(),
  public.axora_support_system_summary(),
  public.axora_record_support_audit(text,uuid,boolean,integer,text),
  public.audit_user_session_revocation(),
  public.protect_public_visitor_counter_state(),
  public.reject_public_visitor_claim_mutation(),
  public.axora_effective_access_snapshot(uuid,uuid,timestamptz),
  public.axora_authorization_scope_contains(
    text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid
  ),
  public.axora_scope_contains_nullable(
    text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid
  ),
  public.axora_snapshot_scope_contains(jsonb,text,uuid,uuid,uuid,uuid),
  public.axora_snapshot_has_permission(jsonb,text,text,uuid,uuid,uuid,uuid),
  public.axora_invalidate_authorization_sessions(uuid,uuid,text),
  public.axora_set_user_permission_override(
    uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,
    timestamptz,timestamptz,text
  ),
  public.axora_remove_user_permission_override(uuid,uuid,uuid,text),
  public.axora_invalidate_approval_limit_subject(
    uuid,uuid,text,uuid,uuid,uuid,uuid,text
  ),
  public.axora_set_approval_limit(
    uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,numeric,
    boolean,timestamptz,timestamptz,text
  ),
  public.axora_remove_approval_limit(uuid,uuid,uuid,text),
  public.axora_role_assignment_scope_contains(
    uuid,uuid,text,uuid,uuid,uuid,uuid,timestamptz
  ),
  public.axora_role_assignment_has_direct_permission(
    uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz
  ),
  public.axora_delegation_scope_is_active(text,uuid,uuid,uuid,uuid),
  public.axora_delegation_authority_is_live(uuid,timestamptz),
  public.axora_create_delegated_access(
    uuid,uuid,uuid,uuid,uuid,text[],jsonb,timestamptz,timestamptz,text
  ),
  public.axora_revoke_delegated_access(uuid,uuid,uuid,text),
  public.axora_role_scope_contract_is_valid(
    text,boolean,text,text,uuid,uuid,uuid,uuid
  ),
  public.axora_role_scope_resource_is_active(text,uuid,uuid,uuid,uuid),
  public.axora_role_assignment_target_is_ready(
    uuid,uuid,text,uuid,uuid,uuid,uuid
  ),
  public.axora_validate_role_assignment_write(),
  public.axora_reject_role_assignment_delete(),
  public.axora_active_platform_owner_count(uuid,uuid),
  public.axora_active_company_admin_count(uuid,uuid,uuid),
  public.axora_protect_critical_role_assignment(),
  public.axora_protect_critical_account_state(),
  public.axora_apply_preferred_role_assignment(uuid,uuid),
  public.axora_refresh_preferred_role_assignment(uuid),
  public.axora_assign_user_role_scope(
    uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,text
  ),
  public.axora_revoke_user_role_scope(uuid,uuid,uuid,uuid,text)
FROM axora_app;

GRANT EXECUTE ON FUNCTION
  public.axora_workflow_notification_preference(uuid,uuid,uuid,text),
  public.axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text),
  public.axora_claim_workflow_email(integer,integer),
  public.axora_complete_workflow_email(uuid,uuid,text,text,text,integer,integer),
  public.axora_received_quantity(uuid),
  public.axora_email_recipient_is_suppressed(text),
  public.axora_support_system_summary(),
  public.axora_record_support_audit(text,uuid,boolean,integer,text),
  public.axora_effective_access_snapshot(uuid,uuid,timestamptz),
  public.axora_set_user_permission_override(
    uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,
    timestamptz,timestamptz,text
  ),
  public.axora_remove_user_permission_override(uuid,uuid,uuid,text),
  public.axora_set_approval_limit(
    uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,numeric,
    boolean,timestamptz,timestamptz,text
  ),
  public.axora_remove_approval_limit(uuid,uuid,uuid,text),
  public.axora_create_delegated_access(
    uuid,uuid,uuid,uuid,uuid,text[],jsonb,timestamptz,timestamptz,text
  ),
  public.axora_revoke_delegated_access(uuid,uuid,uuid,text),
  public.axora_assign_user_role_scope(
    uuid,uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,text
  ),
  public.axora_revoke_user_role_scope(uuid,uuid,uuid,uuid,text)
TO axora_app;

-- These capabilities are conditional because the real grant script is also
-- applied to verified partial schemas during hybrid import and reset checks.
DO $$
BEGIN
  IF to_regprocedure(
    'public.axora_access_administration_snapshot(uuid,uuid,uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_access_administration_snapshot(uuid,uuid,uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_access_administration_snapshot(uuid,uuid,uuid,uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_auth_department_scope(uuid,uuid)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_auth_department_scope(uuid,uuid) FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_auth_department_scope(uuid,uuid) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_auth_department_scope(uuid,uuid) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_organization_directory_snapshot(uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_live_authorization_snapshot(uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_resolve_organization_resource_scope(text,uuid) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_organization_resource_access(uuid,uuid,text,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_organization_directory_snapshot(uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_organization_resource_access(uuid,uuid,text,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_organization_directory_snapshot(uuid,uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_request_access_rows(uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_validate_request_department_scope() FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_request_scope_type(uuid) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_request_permission_is_effective(jsonb,uuid,text,uuid,uuid,uuid,uuid) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_request_access_rows(uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_request_resource_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_request_resource_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_request_creation_scope(uuid,uuid,uuid,uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_request_access_rows(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_request_resource_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_request_resource_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_request_creation_scope(uuid,uuid,uuid,uuid,uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_request_escalation_rows(uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_request_escalation_rows(uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_request_escalation_rows(uuid,uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_attachment_access_rows(uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.attachments FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_resolve_attachment_parent(text,uuid) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_validate_attachment_parent() FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_attachment_permission_is_effective(jsonb,uuid,text,text,text,uuid,uuid,uuid,uuid,text) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_attachment_access_rows(uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_attachment_download(uuid,uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_create_attachment(uuid,uuid,text,uuid,text,text,bytea,text,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_attachment_access_rows(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_attachment_download(uuid,uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_create_attachment(uuid,uuid,text,uuid,text,text,bytea,text,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_operation_request_access_rows(uuid,uuid,text,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_operation_request_access_rows(uuid,uuid,text,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_request_line_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_quotation_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_invoice_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_user_directory_rows(uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_user_target_access(uuid,uuid,text,uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_operation_request_access_rows(uuid,uuid,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_request_line_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_quotation_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_invoice_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_user_directory_rows(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_user_target_access(uuid,uuid,text,uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_company_lifecycle_workspace(uuid,uuid,timestamptz)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.company_status_history,public.company_assignments,public.company_onboarding_items,public.company_duplicate_candidates,public.company_publication_history FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_default_inserted_company_lifecycle() FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_seed_legacy_company_lifecycle() FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_normalize_company_identity(text) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_normalize_company_phone(text) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_email_domain(text) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_status_rank(text) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_snapshot_role_permission(jsonb,text) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_actor_is_owner(jsonb) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_assignment_is_active(uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_actor_can_view(jsonb,uuid,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_actor_has_permission(jsonb,uuid,uuid,text,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_actor_can_create(jsonb,text) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_activation_blockers(uuid) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_apply_company_status(uuid,text,uuid,text,timestamptz,jsonb) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_notification_recipient_ids(uuid,boolean,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_lifecycle_record(uuid,jsonb,uuid,timestamptz) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_company_mutation_payload(uuid,jsonb,uuid,timestamptz,text,boolean,uuid[]) FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_role_assignment_target_is_ready(uuid,uuid,text,uuid,uuid,uuid,uuid) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_company_lifecycle_workspace(uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_create_company_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_mark_company_brand_ready(uuid,uuid,uuid,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_assign_company_manager(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_transition_company_lifecycle(uuid,uuid,uuid,text,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_resolve_company_duplicate(uuid,uuid,uuid,text,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_sync_company_administrator(uuid,uuid,uuid,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_activate_company(uuid,uuid,uuid,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_suspend_company(uuid,uuid,uuid,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_set_company_publication(uuid,uuid,uuid,boolean,text,timestamptz) TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_public_company_listing_rows() TO axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_lock_company_admin_invitation_scope(uuid,uuid,uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_protect_request_submission_identity()'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_protect_request_submission_identity() FROM axora_app';
  END IF;
END
$$;

-- P0-05 company lead capability grants. Contact and lead rows remain available
-- only through authorization-filtering security-definer functions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app')
    AND to_regprocedure('public.axora_record_public_company_lead(jsonb,timestamp with time zone)') IS NOT NULL
  THEN
    REVOKE ALL ON TABLE
      public.company_leads,public.company_lead_status_history,
      public.company_lead_assignments,public.company_lead_duplicate_candidates,
      public.company_lead_notes,public.company_lead_tasks,
      public.company_lead_events,public.company_lead_access_events
    FROM axora_app;
    REVOKE ALL ON SEQUENCE public.company_lead_code_seq FROM axora_app;
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_record_public_company_lead(jsonb,timestamptz),public.axora_company_lead_workspace(uuid,uuid,jsonb,timestamptz),public.axora_export_company_lead(uuid,uuid,uuid,timestamptz),public.axora_assign_company_lead(uuid,uuid,uuid,uuid,text,timestamptz),public.axora_transition_company_lead(uuid,uuid,uuid,text,text,timestamptz),public.axora_resolve_company_lead_duplicate(uuid,uuid,uuid,uuid,text,text,timestamptz),public.axora_add_company_lead_note(uuid,uuid,uuid,text,text,timestamptz),public.axora_add_company_lead_task(uuid,uuid,uuid,text,timestamptz,uuid,timestamptz),public.axora_complete_company_lead_task(uuid,uuid,uuid,uuid,text,timestamptz),public.axora_convert_company_lead(uuid,uuid,uuid,text,timestamptz),public.axora_anonymize_company_lead(uuid,uuid,uuid,text,timestamptz),public.axora_claim_overdue_company_lead_events(uuid,uuid,timestamptz) TO axora_app';
  END IF;
END $$;

-- Company deletion is split between user-facing owner capabilities and a
-- dedicated external-cleanup worker. The broad legacy baseline grants above
-- must never collapse that boundary when deployment/reset reapplies grants.
DO $$
BEGIN
  IF to_regprocedure(
    'public.axora_delete_or_archive_company_v2(uuid,uuid,uuid,uuid,text,text,timestamp with time zone)'
  ) IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE
      public.company_deletion_ownership_rules,
      public.company_deletion_ownership_dag,
      public.company_deletion_execution_authorizations,
      public.company_deletion_commands,
      public.company_deletion_cleanup_tasks,
      public.company_deletion_tombstones
    FROM axora_app;
    REVOKE ALL ON FUNCTION
      public.axora_company_deletion_impact(uuid,uuid,uuid,timestamptz),
      public.axora_delete_or_archive_company(uuid,uuid,uuid,text,text,timestamptz),
      public.axora_company_deletion_trigger_is_authorized(),
      public.axora_reconcile_company_deletion_cleanup_tasks(timestamptz),
      public.axora_claim_company_deletion_cleanup_task(text,integer,timestamptz),
      public.axora_complete_company_deletion_cleanup_task(uuid,uuid,text,jsonb,timestamptz),
      public.axora_fail_company_deletion_cleanup_task(uuid,uuid,text,text,boolean,timestamptz)
    FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_company_deletion_impact_v2(uuid,uuid,uuid,timestamptz),
      public.axora_delete_or_archive_company_v2(uuid,uuid,uuid,uuid,text,text,timestamptz),
      public.axora_company_deletion_command_status(uuid,uuid,uuid,timestamptz)
    TO axora_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_cleanup_worker') THEN
    REVOKE ALL ON TABLE
      public.company_deletion_ownership_rules,
      public.company_deletion_ownership_dag,
      public.company_deletion_execution_authorizations,
      public.company_deletion_commands,
      public.company_deletion_cleanup_tasks,
      public.company_deletion_tombstones
    FROM axora_cleanup_worker;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM axora_cleanup_worker;
    GRANT USAGE ON SCHEMA public TO axora_cleanup_worker;
    GRANT EXECUTE ON FUNCTION
      public.axora_reconcile_company_deletion_cleanup_tasks(timestamptz),
      public.axora_claim_company_deletion_cleanup_task(text,integer,timestamptz),
      public.axora_complete_company_deletion_cleanup_task(uuid,uuid,text,jsonb,timestamptz),
      public.axora_fail_company_deletion_cleanup_task(uuid,uuid,text,text,boolean,timestamptz)
    TO axora_cleanup_worker;
  END IF;
END $$;

-- Visitor identity changed forward-only from a public snapshot, through the
-- network-era V2 capability, to the cookie-only V3 capability. Deployment and
-- reset reapply this file at supported intermediate migration points, so grant
-- exactly the newest capability that exists instead of referencing a function
-- that has not been created yet (or one that a later migration removed).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    RETURN;
  END IF;

  IF to_regprocedure('public.axora_public_visitor_snapshot(text,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_public_visitor_snapshot(text,text,text) FROM axora_app';
  END IF;
  IF to_regprocedure('public.axora_public_visitor_snapshot_v2(text,text,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_public_visitor_snapshot_v2(text,text,text,text) FROM axora_app';
  END IF;
  IF to_regprocedure('public.axora_public_visitor_snapshot_v3(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_public_visitor_snapshot_v3(text) FROM axora_app';
  END IF;
  IF to_regprocedure('public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamp with time zone,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text) FROM axora_app';
  END IF;
  IF to_regprocedure('public.axora_claim_public_visitor_v3(text,text,text,timestamp with time zone,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_claim_public_visitor_v3(text,text,text,timestamptz,text) FROM axora_app';
  END IF;
  IF to_regprocedure('public.axora_claim_public_visitor_fallback(text,text,text,text,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_claim_public_visitor_fallback(text,text,text,text,text,text) FROM axora_app';
  END IF;
  IF to_regprocedure('public.axora_prune_public_visitor_rate_buckets()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_prune_public_visitor_rate_buckets() FROM axora_app';
  END IF;

  IF to_regprocedure('public.axora_public_visitor_snapshot_v3(text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_public_visitor_snapshot_v3(text),public.axora_claim_public_visitor_v3(text,text,text,timestamptz,text),public.axora_prune_public_visitor_rate_buckets() TO axora_app';
  ELSIF to_regprocedure('public.axora_public_visitor_snapshot_v2(text,text,text,text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_public_visitor_snapshot_v2(text,text,text,text),public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text) TO axora_app';
    IF to_regprocedure('public.axora_prune_public_visitor_rate_buckets()') IS NOT NULL THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_prune_public_visitor_rate_buckets() TO axora_app';
    ELSIF to_regprocedure('public.axora_claim_public_visitor_fallback(text,text,text,text,text,text)') IS NOT NULL THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_claim_public_visitor_fallback(text,text,text,text,text,text) TO axora_app';
    END IF;
  ELSIF to_regprocedure('public.axora_public_visitor_snapshot(text,text,text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_public_visitor_snapshot(text,text,text),public.axora_claim_public_visitor(text,text,text,text,text,text,text,timestamptz,text) TO axora_app';
  END IF;
END $$;

-- Account invitation replacement reads an authorized, locked target snapshot
-- through one capability. The runtime never receives direct department or
-- invitation-table access merely to resend a setup link.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app')
    AND to_regprocedure(
      'public.axora_account_setup_resend_target(uuid,uuid,uuid,timestamp with time zone)'
    ) IS NOT NULL
  THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_account_setup_resend_target(uuid,uuid,uuid,timestamptz) TO axora_app';
  END IF;
END $$;

-- P1-11/P1-12 generated documents. Raw snapshots, private storage metadata,
-- supplier dispatch evidence and append-only events remain capability-only.
DO $$
DECLARE function_identity text;
BEGIN
  IF to_regclass('public.document_generation_jobs') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.document_templates,public.document_generation_jobs,public.generated_documents,public.supplier_purchase_order_workflows,public.document_generation_events,public.supplier_purchase_order_events,public.document_enqueue_failures FROM axora_app';
    FOR function_identity IN
      SELECT procedure.oid::regprocedure::text
      FROM pg_catalog.pg_proc procedure
      WHERE procedure.pronamespace='public'::regnamespace
        AND procedure.proname IN (
          'axora_document_json_has_forbidden_key',
          'axora_assert_document_snapshot_safe',
          'axora_build_approved_request_document_snapshot',
          'axora_build_final_delivery_document_snapshot',
          'axora_build_supplier_po_document_snapshot',
          'axora_queue_document_generation_job',
          'axora_enqueue_approval_documents',
          'axora_maybe_enqueue_final_document',
          'axora_enqueue_final_document_from_actual',
          'axora_enqueue_final_document_from_delivery',
          'axora_cancel_request_document_jobs',
          'axora_document_request_permission',
          'axora_document_supplier_permission',
          'axora_generated_document_access_allowed',
          'axora_generated_document_download',
          'axora_generated_document_workspace',
          'axora_claim_document_generation_job',
          'axora_document_notification_recipient_ids',
          'axora_document_internal_recipient_ids',
          'axora_complete_document_generation_job',
          'axora_fail_document_generation_job',
          'axora_request_document_regeneration',
          'axora_manage_supplier_purchase_order',
          'axora_protect_document_job_snapshot',
          'axora_protect_generated_document',
          'axora_document_audit_change'
        )
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM axora_app',function_identity);
    END LOOP;
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_generated_document_download(uuid,uuid,uuid,timestamptz),public.axora_generated_document_workspace(uuid,uuid,timestamptz),public.axora_claim_document_generation_job(uuid,integer,timestamptz),public.axora_complete_document_generation_job(uuid,uuid,text,text,text,integer,bigint,timestamptz),public.axora_fail_document_generation_job(uuid,uuid,text,timestamptz),public.axora_request_document_regeneration(uuid,uuid,uuid,integer,text,text,uuid,timestamptz),public.axora_manage_supplier_purchase_order(uuid,uuid,uuid,integer,text,uuid,text,uuid,timestamptz) TO axora_app';
  END IF;
END $$;

-- P0-09 approval email fanout remains private to its audited trigger.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app')
    AND to_regprocedure(
      'public.axora_enqueue_approval_workflow_email(uuid,uuid,uuid,text,text,text,text,text)'
    ) IS NOT NULL
  THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_enqueue_approval_workflow_email(uuid,uuid,uuid,text,text,text,text,text) FROM axora_app';
  END IF;
END $$;

-- P0-09 provider-neutral email capabilities. Historical provider wrappers may
-- still exist in a forward-migrated database, but current runtime capability is
-- Resend-only. The legacy wrappers are explicitly revoked after the broad
-- function grant at the top of this script.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app')
    AND to_regclass('public.email_delivery_attempts') IS NOT NULL
  THEN
    EXECUTE 'REVOKE ALL ON TABLE public.email_delivery_attempts,public.email_delivery_usage_daily FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_email_retry_delay(integer),public.axora_email_template_key(text),public.axora_email_provider_agent(text),public.axora_email_priority(text),public.axora_set_transactional_email_metadata(),public.axora_protect_transactional_email_metadata(),public.axora_set_workflow_email_metadata(),public.axora_protect_workflow_email_metadata(),public.axora_record_email_provider_event(text,uuid,text,text,text,text,boolean,timestamptz,integer),public.axora_request_email_copy(text,text,text),public.axora_request_approval_recipient_ids(uuid,text,timestamptz),public.axora_emit_request_notification(uuid,uuid,text,uuid[],uuid,uuid,timestamptz),public.axora_dispatch_request_approval_notification(),public.axora_resume_paused_email_jobs(text) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_claim_workflow_email_v2(integer,integer),public.axora_complete_workflow_email_v2(uuid,uuid,text,text,text,integer,text,text,integer) TO axora_app';
    IF to_regprocedure(
      'public.axora_record_resend_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)'
    ) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.axora_record_resend_email_event(uuid,text,text,text,text,boolean,timestamptz,integer) FROM PUBLIC';
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_record_resend_email_event(uuid,text,text,text,text,boolean,timestamptz,integer) TO axora_app';
    END IF;
    IF to_regprocedure(
      'public.axora_record_zeptomail_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)'
    ) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.axora_record_zeptomail_email_event(uuid,text,text,text,text,boolean,timestamptz,integer) FROM PUBLIC';
      EXECUTE 'REVOKE ALL ON FUNCTION public.axora_record_zeptomail_email_event(uuid,text,text,text,text,boolean,timestamptz,integer) FROM axora_app';
    END IF;
    IF to_regprocedure(
      'public.axora_record_cloudflare_email_event(uuid,text,text,text,text,boolean,timestamptz,integer)'
    ) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.axora_record_cloudflare_email_event(uuid,text,text,text,text,boolean,timestamptz,integer) FROM PUBLIC';
      EXECUTE 'REVOKE ALL ON FUNCTION public.axora_record_cloudflare_email_event(uuid,text,text,text,text,boolean,timestamptz,integer) FROM axora_app';
    END IF;
  END IF;
END $$;

-- P0-06/P1-01/P1-02 capabilities are conditional so this script remains
-- usable while a hybrid environment is advancing through the migration chain.
DO $$
BEGIN
  IF to_regprocedure(
    'public.axora_account_setup_inviter_can_activate(uuid,timestamp with time zone)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_account_setup_inviter_can_activate(uuid,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_account_setup_inviter_can_activate(uuid,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_company_onboarding_workspace(uuid,uuid,uuid,timestamp with time zone)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.industry_taxonomy,public.company_verification_history,public.company_onboarding_reminders FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_default_company_onboarding_fields(),public.axora_default_onboarding_item_detail(),public.axora_seed_company_onboarding_completion(),public.axora_company_onboarding_content_blockers(uuid,timestamptz),public.axora_company_onboarding_recipients(uuid,uuid,timestamptz),public.axora_company_onboarding_mutation(uuid,uuid,text,timestamptz) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_company_onboarding_workspace(uuid,uuid,uuid,timestamptz),public.axora_save_company_onboarding(uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text[],text,timestamptz),public.axora_update_company_onboarding_item(uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz,text,timestamptz,text,timestamptz),public.axora_verify_company_onboarding(uuid,uuid,uuid,integer,text,timestamptz) TO axora_app';
  END IF;

  IF to_regprocedure(
    'public.axora_organization_structure_workspace(uuid,uuid,timestamp with time zone)'
  ) IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.business_units,public.cost_centres,public.delivery_locations,public.organization_structure_history FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_validate_department_hierarchy(),public.axora_validate_business_unit_hierarchy(),public.axora_validate_organization_tenant_links(),public.axora_reject_organization_delete(),public.axora_protect_invitation_department_scope(),public.axora_organization_permission_at(jsonb,text,uuid,uuid,uuid) FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_organization_structure_workspace(uuid,uuid,timestamptz),public.axora_save_organization_node(uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,uuid,jsonb,text,timestamptz),public.axora_set_organization_node_active(uuid,uuid,text,uuid,boolean,text,timestamptz) TO axora_app';
  END IF;
END $$;

-- P0-07/P0-08 transactional budget and request-approval capabilities.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app')
    AND to_regclass('public.budget_accounts') IS NOT NULL
  THEN
    EXECUTE 'REVOKE ALL ON TABLE public.company_ceiling_history,public.budget_accounts,public.budget_periods,public.budget_ledger_entries,public.budget_reservations,public.budget_reservation_events FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_validate_budget_account_scope(),public.axora_budget_scope_type(text,uuid),public.axora_budget_account_permission(jsonb,text,text,uuid,uuid,uuid),public.axora_post_budget_entry_internal(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,uuid,integer,uuid,uuid,text,uuid,uuid,uuid,text,text,text,uuid,text,timestamptz),public.axora_reject_budget_evidence_change(),public.axora_seed_budget_account_for_node() FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_budget_workspace(uuid,uuid,timestamptz),public.axora_adjust_budget_allocation(uuid,uuid,uuid,text,numeric,boolean,text,text,timestamptz),public.axora_set_budget_allocation(uuid,uuid,uuid,numeric,text,text,timestamptz),public.axora_transfer_budget_allocation(uuid,uuid,uuid,uuid,numeric,boolean,text,text,timestamptz),public.axora_set_company_ceiling(uuid,uuid,uuid,numeric,text,text,text,timestamptz),public.axora_refresh_budget_period(uuid,uuid,uuid,text,text,timestamptz),public.axora_request_budget_choices(uuid,uuid,timestamptz) TO axora_app';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app')
    AND to_regclass('public.request_approval_decisions') IS NOT NULL
  THEN
    EXECUTE 'REVOKE ALL ON TABLE public.request_approval_policies,public.request_approval_snapshots,public.request_approval_decisions,public.request_approval_escalations,public.request_approval_outbox FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_request_total_internal(uuid),public.axora_request_snapshot_payload_internal(uuid,integer,numeric,text),public.axora_approval_limit_for_request(jsonb,text,uuid,uuid,uuid,text,boolean),public.axora_seed_company_approval_policy(),public.axora_resolve_request_budget_defaults(),public.axora_require_versioned_approval_decision(),public.axora_protect_request_approval_evidence() FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_initialize_request_approval(uuid,uuid,uuid,text,timestamptz),public.axora_request_approval_workspace(uuid,uuid,timestamptz),public.axora_decide_request_approval(uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz),public.axora_finalize_request_budget(uuid,uuid,uuid,numeric,text,text,timestamptz),public.axora_request_approval_timeline(uuid,uuid,uuid,timestamptz) TO axora_app';
  END IF;
END $$;

-- Paid checkout and final-invoice capabilities. Payment evidence, invoice
-- payload assembly and queue triggers remain private to SECURITY DEFINER
-- boundaries; the runtime receives only the three required entry points.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app')
    AND to_regclass('public.payment_accountability_events') IS NOT NULL
  THEN
    EXECUTE 'REVOKE ALL ON TABLE public.payment_accountability_events FROM axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_invoice_email_payload(uuid),public.axora_invoice_email_ready(uuid),public.axora_invoice_email_recipient_suppressed(uuid),public.axora_queue_final_invoice_email(),public.axora_protect_invoice_email_identity(),public.validate_new_invoice_workflow(),public.prevent_invoice_overpayment() FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_complete_payment(uuid,uuid,uuid,text,text,timestamptz),public.axora_final_invoice_summary(uuid,uuid,uuid,timestamptz),public.axora_complete_final_invoice_document_job(uuid,uuid,text,text,text,integer,bigint,timestamptz) TO axora_app';
  END IF;
END $$;

-- P0-10 immutable accountability closure. The application can use only the
-- scope-enforcing read/access capabilities; audit evidence and chain heads are
-- never directly readable or mutable by the runtime role.
DO $$
BEGIN
  IF to_regclass('public.audit_integrity_heads') IS NOT NULL
     AND to_regprocedure('public.axora_audit_rows(uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer)') IS NOT NULL THEN
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
END
$$;

-- P1-03/P1-04 supplier quantity and commercial pricing evidence. Customer-safe
-- catalog rows and the platform-authorized history capability are the only
-- runtime entry points; confidential cost/rule evidence stays private.
DO $$
DECLARE readable_product_columns text;
BEGIN
  IF to_regclass('public.commercial_pricing_rules') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.commercial_pricing_rules,public.product_supplier_quantity_rule_history,public.product_commercial_price_history,public.request_line_supplier_rule_snapshots FROM axora_app';
    EXECUTE 'REVOKE SELECT ON TABLE public.products,public.product_suppliers FROM axora_app';
    SELECT string_agg(quote_ident(attribute.attname),',' ORDER BY attribute.attnum)
    INTO readable_product_columns
    FROM pg_catalog.pg_attribute attribute
    WHERE attribute.attrelid='public.products'::regclass
      AND attribute.attnum>0 AND NOT attribute.attisdropped
      AND attribute.attname<>'default_buy_price';
    EXECUTE format('GRANT SELECT (%s) ON TABLE public.products TO axora_app',readable_product_columns);
    EXECUTE 'GRANT SELECT (id,product_id,supplier_id,preferred,active) ON TABLE public.product_suppliers TO axora_app';
    EXECUTE 'GRANT SELECT ON TABLE public.v_customer_catalog_products TO axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_quantity_is_valid(numeric,numeric,numeric,numeric),public.axora_round_commercial_price(numeric,numeric,integer),public.axora_current_product_offer_internal(uuid,timestamptz),public.axora_append_product_price_history(uuid,text),public.axora_capture_product_price_history(),public.axora_prepare_product_supplier_quantity_rule(),public.axora_capture_product_supplier_quantity_rule(),public.axora_reject_commercial_evidence_mutation(),public.axora_prepare_request_line_commercial_snapshot(),public.axora_validate_request_commercial_snapshots(uuid),public.axora_validate_request_commercial_snapshots_trigger(),public.axora_capture_request_line_supplier_rule(uuid,uuid,text,timestamptz),public.axora_capture_selected_supplier_rule(),public.axora_validate_purchase_order_rules() FROM axora_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_catalog_offer(uuid,timestamptz),public.axora_product_commercial_history(uuid,uuid,uuid,timestamptz),public.axora_product_administration_catalog(uuid,uuid,timestamptz) TO axora_app';
  END IF;
END $$;

-- Permanent account removal remains owner-only inside the narrow capability.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app')
    AND to_regprocedure(
      'public.axora_remove_user_account(uuid,uuid,uuid,text,timestamp with time zone)'
    ) IS NOT NULL
  THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.axora_remove_user_account(uuid,uuid,uuid,text,timestamptz) TO axora_app';
    EXECUTE 'REVOKE ALL ON FUNCTION public.axora_prevent_removed_user_reactivation() FROM axora_app';
  END IF;
END $$;
