-- Preserve the existing user-account deletion cleanup capability when the
-- deployment controller reapplies the canonical least-privilege grant policy.
-- The worker still receives no direct access to cleanup storage and cannot
-- invoke the reconciliation helper independently of its lease capability.
DO $cleanup_worker_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') THEN
    REVOKE ALL ON TABLE
      public.user_deletion_commands,
      public.user_deletion_cleanup_tasks,
      public.user_deletion_execution_authorizations
    FROM axora_app;

    REVOKE ALL ON FUNCTION
      public.axora_user_deletion_trigger_is_authorized(),
      public.axora_user_privacy_scrub_json(jsonb),
      public.axora_rebuild_audit_integrity_after_privacy_purge(),
      public.axora_refresh_user_deletion_command(uuid,timestamptz),
      public.axora_reconcile_user_deletion_cleanup_tasks(timestamptz),
      public.axora_claim_user_deletion_cleanup_task(text,integer,timestamptz),
      public.axora_complete_user_deletion_cleanup_task(uuid,uuid,text,jsonb,timestamptz),
      public.axora_fail_user_deletion_cleanup_task(
        uuid,uuid,text,text,boolean,timestamptz
      )
    FROM axora_app;

    GRANT EXECUTE ON FUNCTION
      public.axora_remove_user_account(uuid,uuid,uuid,text,timestamptz)
    TO axora_app;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'axora_cleanup_worker'
  ) THEN
    REVOKE ALL ON TABLE
      public.user_deletion_commands,
      public.user_deletion_cleanup_tasks,
      public.user_deletion_execution_authorizations
    FROM axora_cleanup_worker;

    REVOKE ALL ON FUNCTION
      public.axora_reconcile_user_deletion_cleanup_tasks(timestamptz)
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
$cleanup_worker_grants$;
