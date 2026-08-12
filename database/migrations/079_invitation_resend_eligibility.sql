BEGIN;

-- A revoked or consumed setup invitation is historical evidence, not a
-- prerequisite for issuing a fresh invitation. The target account remains
-- locked and authorized by axora_lock_user_target_access; only the optional
-- current invitation snapshot changes here.
CREATE OR REPLACE FUNCTION public.axora_account_setup_resend_target(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  target_access jsonb;
  result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_target_user_id IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  target_access := public.axora_lock_user_target_access(
    p_actor_user_id,
    p_actor_role_assignment_id,
    'user.invite',
    p_target_user_id,
    p_at
  );
  IF target_access IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_strip_nulls(jsonb_build_object(
    'userId',account.id,
    'recipientName',account.display_name,
    'recipientEmail',account.email,
    'role',role.role_key,
    'roleId',role.id,
    'accountKind',account.account_kind,
    'scopeType',assignment.scope_type,
    'companyId',assignment.company_id,
    'companyName',COALESCE(company.name,supplier.name,
      CASE WHEN account.account_kind='DELIVERY'
        THEN 'Axora delivery network' ELSE 'Axora' END),
    'branchId',assignment.branch_id,
    'branchName',branch.name,
    'departmentId',assignment.department_id,
    'departmentName',department.name,
    'supplierId',assignment.supplier_id,
    'active',account.active,
    'setupCompleted',account.account_setup_completed_at IS NOT NULL,
    'organizationActive',CASE
      WHEN assignment.scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
        THEN COALESCE(company.active,false) AND COALESCE(branch.active,true)
          AND COALESCE(department.active,true)
      WHEN assignment.scope_type='SUPPLIER' THEN COALESCE(supplier.active,false)
      ELSE true END,
    'membershipReady',CASE
      WHEN assignment.scope_type IN ('COMPANY','BRANCH','DEPARTMENT')
        THEN company_membership.status='INVITED'
          AND (assignment.scope_type NOT IN ('BRANCH','DEPARTMENT')
            OR assignment.branch_id IS NULL OR branch_assignment.status='ACTIVE')
          AND (assignment.scope_type<>'DEPARTMENT'
            OR department_assignment.status='ACTIVE')
      WHEN assignment.scope_type='SUPPLIER'
        THEN supplier_membership.status='INVITED'
      WHEN assignment.scope_type='DELIVERY' THEN COALESCE(driver.active,false)
      ELSE true END,
    'preferredLocale',profile.preferred_locale,
    'currentInvitationPresent',invitation.id IS NOT NULL,
    'latestInvitationId',invitation.id,
    'latestDeliveryStatus',invitation.delivery_status,
    'latestInvitationCreatedAt',invitation.created_at,
    'latestInvitationExpiresAt',invitation.expires_at,
    'latestInvitationSentAt',invitation.sent_at,
    'latestProviderMessagePresent',invitation.provider_message_id IS NOT NULL
  ))
  INTO result
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.id=(target_access->>'roleAssignmentId')::uuid
   AND assignment.user_id=account.id
   AND assignment.active=true AND assignment.revoked_at IS NULL
  JOIN public.roles role ON role.id=assignment.role_id
  JOIN public.account_credentials credential
    ON credential.user_id=account.id AND credential.password_hash IS NULL
  JOIN public.user_profiles profile ON profile.user_id=account.id
  LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM public.account_setup_invitations candidate
    WHERE candidate.user_id=account.id
      AND candidate.consumed_at IS NULL
      AND candidate.revoked_at IS NULL
    ORDER BY candidate.created_at DESC,candidate.id DESC
    LIMIT 1
  ) invitation ON true
  LEFT JOIN public.companies company ON company.id=assignment.company_id
  LEFT JOIN public.company_memberships company_membership
    ON company_membership.user_id=account.id
   AND company_membership.company_id=assignment.company_id
  LEFT JOIN public.branches branch ON branch.id=assignment.branch_id
   AND branch.company_id=assignment.company_id
  LEFT JOIN public.departments department ON department.id=assignment.department_id
   AND department.company_id=assignment.company_id
  LEFT JOIN public.branch_assignments branch_assignment
    ON branch_assignment.user_id=account.id
   AND branch_assignment.company_id=assignment.company_id
   AND branch_assignment.branch_id=assignment.branch_id
  LEFT JOIN public.department_assignments department_assignment
    ON department_assignment.user_id=account.id
   AND department_assignment.company_id=assignment.company_id
   AND department_assignment.department_id=assignment.department_id
  LEFT JOIN public.suppliers supplier ON supplier.id=assignment.supplier_id
  LEFT JOIN public.supplier_memberships supplier_membership
    ON supplier_membership.user_id=account.id
   AND supplier_membership.supplier_id=assignment.supplier_id
  LEFT JOIN public.delivery_agent_profiles driver ON driver.user_id=account.id
  WHERE account.id=p_target_user_id
    AND account.account_status='INVITED'
    AND account.account_setup_completed_at IS NULL
    AND account.active=true
    AND account.company_id IS NOT DISTINCT FROM assignment.company_id
    AND account.branch_id IS NOT DISTINCT FROM assignment.branch_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.email_recipient_suppressions suppression
      WHERE suppression.recipient_fingerprint=
        public.axora_email_recipient_fingerprint(account.email)
    );

  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION public.axora_account_setup_resend_target(
  uuid,uuid,uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_account_setup_resend_target(
      uuid,uuid,uuid,timestamptz
    ) TO axora_app;
  END IF;
END
$$;

COMMIT;
