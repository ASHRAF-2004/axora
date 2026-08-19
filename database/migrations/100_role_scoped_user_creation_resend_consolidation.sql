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
      AND p_department_id IS NOT NULL AND p_supplier_id IS NULL
    WHEN p_role_key='REQUESTER' THEN
      p_account_kind='COMPANY' AND NOT p_is_owner
      AND p_scope_type IN ('BRANCH','DEPARTMENT')
      AND p_company_id IS NOT NULL
      AND (
        (p_scope_type='BRANCH' AND p_branch_id IS NOT NULL
          AND p_department_id IS NULL)
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
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
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
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
        OR (p_scope_type='DEPARTMENT' AND p_department_id IS NOT NULL)
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

COMMIT;
