BEGIN;

CREATE OR REPLACE FUNCTION public.axora_user_directory_rows(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE(
  user_id uuid,
  email text,
  display_name text,
  role_key text,
  active boolean,
  is_owner boolean,
  account_kind text,
  account_status text,
  scope_type text,
  company_id uuid,
  company_name text,
  branch_id uuid,
  branch_name text,
  department_id uuid,
  department_name text,
  supplier_id uuid,
  supplier_name text,
  job_title text,
  account_setup_completed_at timestamptz,
  account_setup_delivery_status text,
  account_setup_expires_at timestamptz,
  account_setup_sent_at timestamptz,
  account_setup_delivery_attempted_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    account.id,
    account.email,
    account.display_name,
    role.role_key,
    account.active,
    account.is_owner,
    account.account_kind,
    account.account_status,
    assignment.scope_type,
    assignment.company_id,
    company.name,
    assignment.branch_id,
    branch.name,
    assignment.department_id,
    department.name,
    assignment.supplier_id,
    supplier.name,
    profile.job_title,
    account.account_setup_completed_at,
    invitation.delivery_status,
    invitation.expires_at,
    invitation.sent_at,
    invitation.delivery_attempted_at,
    account.last_login_at,
    account.created_at
  FROM public.users account
  CROSS JOIN LATERAL (
    SELECT candidate.*
    FROM public.role_assignments candidate
    WHERE candidate.user_id=account.id
      AND candidate.active
      AND candidate.revoked_at IS NULL
      AND (
        public.axora_snapshot_has_permission(
          actor_snapshot,'user.view',candidate.scope_type,
          candidate.company_id,candidate.branch_id,
          candidate.department_id,candidate.supplier_id
        )
        OR (
          -- An Owner must see the first pending administrator to recover a
          -- failed invitation before Company activation. This is read only;
          -- operational permissions and resend eligibility are unchanged.
          public.axora_company_actor_is_owner(actor_snapshot)
          AND account.account_kind='COMPANY'
          AND account.account_status='INVITED'
          AND account.account_setup_completed_at IS NULL
          AND account.active
          AND candidate.scope_type='COMPANY'
          AND candidate.company_id=account.company_id
          AND candidate.branch_id IS NULL
          AND candidate.department_id IS NULL
          AND candidate.supplier_id IS NULL
          AND public.axora_snapshot_has_permission_base(
            actor_snapshot,'company_user.view','COMPANY',
            candidate.company_id,NULL,NULL,NULL
          )
          AND EXISTS (
            SELECT 1 FROM public.roles pending_role
            WHERE pending_role.id=candidate.role_id
              AND pending_role.role_key='COMPANY_ADMIN'
          )
          AND EXISTS (
            SELECT 1 FROM public.companies pending_company
            WHERE pending_company.id=candidate.company_id
              AND public.axora_company_is_retained(pending_company.id)
              AND pending_company.lifecycle_status IN (
                'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
                'COMPANY_ADMINISTRATOR_INVITED'
              )
          )
          AND EXISTS (
            SELECT 1 FROM public.account_credentials credential
            WHERE credential.user_id=account.id
              AND credential.password_hash IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM public.company_memberships membership
            WHERE membership.user_id=account.id
              AND membership.company_id=candidate.company_id
              AND membership.status='INVITED'
          )
        )
      )
    ORDER BY candidate.assigned_at DESC,candidate.id DESC
    LIMIT 1
  ) assignment
  JOIN public.roles role ON role.id=assignment.role_id
  LEFT JOIN public.companies company ON company.id=assignment.company_id
  LEFT JOIN public.branches branch
    ON branch.id=assignment.branch_id
   AND branch.company_id=assignment.company_id
  LEFT JOIN public.departments department
    ON department.id=assignment.department_id
   AND department.company_id=assignment.company_id
  LEFT JOIN public.suppliers supplier ON supplier.id=assignment.supplier_id
  LEFT JOIN public.user_profiles profile ON profile.user_id=account.id
  LEFT JOIN LATERAL (
    SELECT setup.delivery_status,setup.expires_at,setup.sent_at,
           setup.delivery_attempted_at
    FROM public.account_setup_invitations setup
    WHERE setup.user_id=account.id
    ORDER BY setup.created_at DESC,setup.id DESC
    LIMIT 1
  ) invitation ON true
  ORDER BY account.display_name,account.id;
END $$;

COMMIT;
