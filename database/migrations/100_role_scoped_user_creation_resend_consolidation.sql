BEGIN;

SELECT pg_advisory_xact_lock(100217731);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Client Account Managers are Axora platform employees. Customer companies are
-- assigned through company_assignments; they are not tenant-scoped identities.
-- HR Management remains PLATFORM/PLATFORM and Delivery Guy remains
-- DELIVERY/DELIVERY. Historical role assignments are not rewritten.
CREATE OR REPLACE FUNCTION public.axora_role_scope_contract_is_valid(
  p_account_kind text,
  p_is_owner boolean,
  p_role_key text,
  p_scope_type text,
  p_company_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_supplier_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_role_key='PLATFORM_OWNER' THEN
      p_account_kind='PLATFORM' AND p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN p_role_key IN (
      'PLATFORM_OPERATIONS','TECHNICAL_SUPPORT',
      'HUMAN_RESOURCES_MANAGEMENT','CLIENT_ACCOUNT_MANAGER'
    ) THEN
      p_account_kind='PLATFORM' AND NOT p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN p_role_key IN ('COMPANY_ADMIN','COMPANY_APPROVER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='COMPANY' AND p_company_id IS NOT NULL
      AND p_branch_id IS NULL AND p_department_id IS NULL
      AND p_supplier_id IS NULL
    WHEN p_role_key IN ('BRANCH_ADMIN','BRANCH_APPROVER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='BRANCH' AND p_company_id IS NOT NULL
      AND p_branch_id IS NOT NULL AND p_department_id IS NULL
      AND p_supplier_id IS NULL
    WHEN p_role_key='DEPARTMENT_ADMIN' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type='DEPARTMENT' AND p_company_id IS NOT NULL
      AND p_branch_id IS NOT NULL AND p_department_id IS NOT NULL
      AND p_supplier_id IS NULL
    WHEN p_role_key='REQUESTER' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL
      AND (
        (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_branch_id IS NOT NULL
          AND p_department_id IS NOT NULL)
      )
      AND p_supplier_id IS NULL
    WHEN p_role_key IN ('FINANCE_REVIEWER','AUDITOR','RECEIVING_USER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL
      AND (
        (p_scope_type='COMPANY' AND p_branch_id IS NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_branch_id IS NOT NULL
          AND p_department_id IS NOT NULL)
      )
      AND p_supplier_id IS NULL
    WHEN p_role_key='SUPPLIER_USER' THEN
      p_account_kind='SUPPLIER' AND NOT p_is_owner
      AND p_scope_type='SUPPLIER' AND p_supplier_id IS NOT NULL
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL
    WHEN p_role_key IN (
      'DELIVERY_GUY','DELIVERY_TEAM_SUPERVISOR',
      'DELIVERY_AGENT','DELIVERY_DRIVER'
    ) THEN
      p_account_kind='DELIVERY' AND NOT p_is_owner
      AND p_scope_type='DELIVERY'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    WHEN p_role_key='ADMIN' THEN
      (
        p_account_kind='PLATFORM' AND p_is_owner
        AND p_scope_type='PLATFORM'
        AND p_company_id IS NULL AND p_branch_id IS NULL
        AND p_department_id IS NULL AND p_supplier_id IS NULL
      ) OR (
        p_account_kind='COMPANY' AND NOT p_is_owner
        AND p_scope_type='COMPANY' AND p_company_id IS NOT NULL
        AND p_branch_id IS NULL AND p_department_id IS NULL
        AND p_supplier_id IS NULL
      )
    WHEN p_role_key='APPROVER' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
      AND (
        (p_scope_type='COMPANY' AND p_branch_id IS NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_branch_id IS NOT NULL
          AND p_department_id IS NOT NULL)
      )
    WHEN p_role_key IN ('FINANCE','VIEWER') THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='OPERATIONS' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='IT_SUPPORT' THEN
      p_account_kind='PLATFORM' AND NOT p_is_owner
      AND p_scope_type='PLATFORM'
      AND p_company_id IS NULL AND p_branch_id IS NULL
      AND p_department_id IS NULL AND p_supplier_id IS NULL
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.axora_role_scope_contract_is_valid(
  text,boolean,text,text,uuid,uuid,uuid,uuid
) FROM PUBLIC;

-- Provider history is immutable audit evidence, so old provider rows and
-- historical migrations remain untouched. Retire only executable capabilities:
-- the application role can record current Resend lifecycle events, but it can
-- no longer invoke provider-specific wrappers for retired integrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
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
    IF to_regprocedure(
      'public.axora_record_email_provider_event(text,uuid,text,text,text,text,boolean,timestamptz,integer)'
    ) IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.axora_record_email_provider_event(text,uuid,text,text,text,text,boolean,timestamptz,integer) FROM axora_app';
    END IF;
  END IF;
END $$;

-- Current webhook-health writes are Resend-only. Existing historical rows for
-- retired providers remain queryable for audit continuity.
CREATE OR REPLACE FUNCTION public.axora_record_email_webhook_failure(
  p_provider_name text,p_error_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  provider_value text:=lower(COALESCE(p_provider_name,''));
  error_value text:=lower(COALESCE(p_error_code,''));
  period_value timestamptz:=date_trunc('hour',now());
BEGIN
  IF provider_value<>'resend'
    OR error_value !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'Email webhook health event is invalid';
  END IF;
  INSERT INTO public.email_webhook_health_hourly(
    provider_name,period_start,rejected_count,processing_failure_count,
    last_error_code,last_event_at
  ) VALUES (
    provider_value,period_value,
    CASE WHEN error_value='invalid_payload' THEN 1 ELSE 0 END,
    CASE WHEN error_value='invalid_payload' THEN 0 ELSE 1 END,
    error_value,now()
  ) ON CONFLICT(provider_name,period_start) DO UPDATE SET
    rejected_count=email_webhook_health_hourly.rejected_count+EXCLUDED.rejected_count,
    processing_failure_count=email_webhook_health_hourly.processing_failure_count
      +EXCLUDED.processing_failure_count,
    last_error_code=EXCLUDED.last_error_code,
    last_event_at=GREATEST(email_webhook_health_hourly.last_event_at,EXCLUDED.last_event_at);
END $$;

REVOKE ALL ON FUNCTION public.axora_record_email_webhook_failure(text,text) FROM PUBLIC;

COMMIT;
