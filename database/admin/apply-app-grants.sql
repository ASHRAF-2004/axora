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
  public.axora_public_visitor_snapshot(text,text,text),
  public.axora_claim_public_visitor(
    text,text,text,text,text,text,text,timestamptz,text
  ),
  public.axora_effective_access_snapshot(uuid,uuid,timestamptz),
  public.axora_access_administration_snapshot(
    uuid,uuid,uuid,uuid,timestamptz
  ),
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
  public.axora_record_cloudflare_email_event(
    uuid,text,text,text,text,boolean,timestamptz,integer
  ),
  public.axora_support_system_summary(),
  public.axora_record_support_audit(text,uuid,boolean,integer,text),
  public.axora_public_visitor_snapshot(text,text,text),
  public.axora_claim_public_visitor(
    text,text,text,text,text,text,text,timestamptz,text
  ),
  public.axora_effective_access_snapshot(uuid,uuid,timestamptz),
  public.axora_access_administration_snapshot(
    uuid,uuid,uuid,uuid,timestamptz
  ),
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