BEGIN;

SELECT pg_advisory_xact_lock(1114263085);

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Keep creator authorization authoritative for the lifetime of the link, but
-- do not invalidate an additional Company Administrator merely because the
-- retained Company has already reached ACTIVE.
CREATE OR REPLACE FUNCTION public.axora_account_setup_inviter_can_activate(
  p_invitation_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_setup_invitations invitation
    JOIN public.users creator ON creator.id=invitation.created_by
      AND creator.active AND creator.account_status='ACTIVE'
      AND creator.account_setup_completed_at IS NOT NULL
    JOIN public.roles intended_role ON intended_role.id=invitation.intended_role_id
    WHERE invitation.id=p_invitation_id AND (
      EXISTS (
        SELECT 1
        FROM public.role_assignments creator_assignment
        CROSS JOIN LATERAL (
          SELECT public.axora_live_authorization_snapshot(
            creator.id,creator_assignment.id,p_at
          ) AS value
        ) creator_snapshot
        WHERE creator_assignment.user_id=creator.id
          AND creator_assignment.active
          AND creator_assignment.revoked_at IS NULL
          AND creator_snapshot.value IS NOT NULL
          AND (
            (
              intended_role.role_key='COMPANY_ADMIN'
              AND invitation.company_id IS NOT NULL
              AND creator_snapshot.value->>'accountKind'='PLATFORM'
              AND (
                public.axora_company_actor_is_owner(creator_snapshot.value)
                OR creator_snapshot.value->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
              )
              AND EXISTS (
                SELECT 1 FROM public.companies company
                WHERE company.id=invitation.company_id
                  AND public.axora_company_is_retained(company.id)
                  AND company.lifecycle_status IN (
                    'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
                    'COMPANY_ADMINISTRATOR_INVITED',
                    'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
                  )
              )
              AND public.axora_company_snapshot_role_permission(
                creator_snapshot.value,'user.invite'
              )
            )
            OR public.axora_snapshot_has_permission(
              creator_snapshot.value,'user.invite',invitation.intended_scope_type,
              invitation.company_id,invitation.intended_branch_id,
              invitation.intended_department_id,invitation.intended_supplier_id
            )
          )
      )
      OR (
        intended_role.role_key='COMPANY_ADMIN'
        AND invitation.company_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.company_assignments company_assignment
          JOIN public.role_assignments creator_assignment
            ON creator_assignment.user_id=creator.id AND creator_assignment.active
            AND creator_assignment.revoked_at IS NULL
          JOIN public.roles creator_role ON creator_role.id=creator_assignment.role_id
            AND creator_role.role_key='CLIENT_ACCOUNT_MANAGER'
          WHERE company_assignment.company_id=invitation.company_id
            AND company_assignment.manager_user_id=creator.id
            AND company_assignment.status='ACTIVE'
            AND company_assignment.coverage_starts_at<=p_at
            AND (company_assignment.coverage_ends_at IS NULL
              OR company_assignment.coverage_ends_at>p_at)
        )
      )
    )
  )
$$;

-- One fail-closed contract serves public inspection and the locked consume
-- transaction. Only the first Company Administrator receives the retained
-- onboarding-state exception; every other scope keeps its authoritative
-- resource requirements. A token is redeemable only after delivery has been
-- durably recorded as SENT.
CREATE OR REPLACE FUNCTION public.axora_account_setup_invitation_is_eligible(
  p_invitation_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_setup_invitations invitation
    JOIN public.users account
      ON account.id=invitation.user_id
     AND account.company_id IS NOT DISTINCT FROM invitation.company_id
     AND account.branch_id IS NOT DISTINCT FROM invitation.intended_branch_id
    JOIN public.roles intended_role
      ON intended_role.id=invitation.intended_role_id
    JOIN public.role_assignments intended_assignment
      ON intended_assignment.user_id=account.id
     AND intended_assignment.role_id=invitation.intended_role_id
     AND intended_assignment.scope_type=invitation.intended_scope_type
     AND intended_assignment.company_id IS NOT DISTINCT FROM invitation.company_id
     AND intended_assignment.branch_id IS NOT DISTINCT FROM invitation.intended_branch_id
     AND intended_assignment.department_id IS NOT DISTINCT FROM invitation.intended_department_id
     AND intended_assignment.supplier_id IS NOT DISTINCT FROM invitation.intended_supplier_id
     AND intended_assignment.active
     AND intended_assignment.revoked_at IS NULL
    JOIN public.account_credentials credential
      ON credential.user_id=account.id
     AND credential.password_hash IS NULL
    LEFT JOIN public.companies company ON company.id=invitation.company_id
    LEFT JOIN public.company_memberships company_membership
      ON company_membership.user_id=account.id
     AND company_membership.company_id=invitation.company_id
    LEFT JOIN public.branches branch
      ON branch.id=invitation.intended_branch_id
     AND branch.company_id=invitation.company_id
    LEFT JOIN public.branch_assignments branch_assignment
      ON branch_assignment.user_id=account.id
     AND branch_assignment.company_id=invitation.company_id
     AND branch_assignment.branch_id=invitation.intended_branch_id
    LEFT JOIN LATERAL (
      SELECT public.axora_auth_department_scope(
        account.id,intended_assignment.id
      ) AS snapshot
    ) department_scope ON invitation.intended_scope_type='DEPARTMENT'
    LEFT JOIN public.delivery_agent_profiles driver
      ON driver.user_id=account.id
    WHERE invitation.id=p_invitation_id
      AND p_at IS NOT NULL
      AND invitation.delivery_status='SENT'
      AND invitation.sent_at IS NOT NULL
      AND invitation.consumed_at IS NULL
      AND invitation.revoked_at IS NULL
      AND invitation.expires_at>p_at
      AND account.account_setup_completed_at IS NULL
      AND account.password_hash=
        '$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By'
      AND account.account_status='INVITED'
      AND account.active
      AND public.axora_account_setup_inviter_can_activate(invitation.id,p_at)
      AND (
        (
          invitation.intended_scope_type='PLATFORM'
          AND invitation.company_id IS NULL
          AND invitation.intended_branch_id IS NULL
          AND invitation.intended_department_id IS NULL
          AND invitation.intended_supplier_id IS NULL
          AND account.account_kind='PLATFORM'
          AND intended_role.role_key IN (
            'PLATFORM_OWNER','HUMAN_RESOURCES_MANAGEMENT',
            'CLIENT_ACCOUNT_MANAGER','PLATFORM_OPERATIONS','TECHNICAL_SUPPORT'
          )
          AND account.is_owner=(intended_role.role_key='PLATFORM_OWNER')
        )
        OR (
          invitation.intended_scope_type='COMPANY'
          AND invitation.company_id IS NOT NULL
          AND invitation.intended_branch_id IS NULL
          AND invitation.intended_department_id IS NULL
          AND invitation.intended_supplier_id IS NULL
          AND account.account_kind='COMPANY'
          AND NOT account.is_owner
          AND public.axora_company_is_retained(company.id)
          AND company_membership.status='INVITED'
          AND (
            (
              intended_role.role_key='COMPANY_ADMIN'
              AND company.lifecycle_status IN (
                'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
                'COMPANY_ADMINISTRATOR_INVITED',
                'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
              )
              AND (
                company.lifecycle_status NOT IN (
                  'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW'
                )
                OR NOT EXISTS (
                  SELECT 1
                  FROM public.role_assignments competing_assignment
                  JOIN public.roles competing_role
                    ON competing_role.id=competing_assignment.role_id
                   AND competing_role.role_key='COMPANY_ADMIN'
                  JOIN public.users competing_account
                    ON competing_account.id=competing_assignment.user_id
                   AND competing_account.id<>account.id
                   AND competing_account.active
                   AND competing_account.account_status IN ('INVITED','ACTIVE')
                  WHERE competing_assignment.scope_type='COMPANY'
                    AND competing_assignment.company_id=company.id
                    AND competing_assignment.branch_id IS NULL
                    AND competing_assignment.department_id IS NULL
                    AND competing_assignment.supplier_id IS NULL
                    AND competing_assignment.active
                    AND competing_assignment.revoked_at IS NULL
                )
              )
            )
            OR (
              intended_role.role_key IN (
                'COMPANY_APPROVER','FINANCE_REVIEWER','AUDITOR','RECEIVING_USER'
              )
              AND company.lifecycle_status IN (
                'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
                'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
              )
            )
          )
        )
        OR (
          invitation.intended_scope_type='BRANCH'
          AND invitation.company_id IS NOT NULL
          AND invitation.intended_branch_id IS NOT NULL
          AND invitation.intended_department_id IS NULL
          AND invitation.intended_supplier_id IS NULL
          AND account.account_kind='COMPANY'
          AND NOT account.is_owner
          AND public.axora_company_is_retained(company.id)
          AND company.lifecycle_status IN (
            'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
            'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
          )
          AND branch.active
          AND company_membership.status='INVITED'
          AND branch_assignment.status='ACTIVE'
          AND intended_role.role_key IN (
            'BRANCH_ADMIN','BRANCH_APPROVER','REQUESTER',
            'FINANCE_REVIEWER','AUDITOR','RECEIVING_USER'
          )
        )
        OR (
          invitation.intended_scope_type='DEPARTMENT'
          AND invitation.company_id IS NOT NULL
          AND invitation.intended_department_id IS NOT NULL
          AND invitation.intended_supplier_id IS NULL
          AND account.account_kind='COMPANY'
          AND NOT account.is_owner
          AND public.axora_company_is_retained(company.id)
          AND company.lifecycle_status IN (
            'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED',
            'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
          )
          AND COALESCE(
            (department_scope.snapshot->>'branchActive')::boolean,true
          )
          AND (department_scope.snapshot->>'departmentActive')::boolean
          AND (department_scope.snapshot->>'branchId')::uuid
            IS NOT DISTINCT FROM invitation.intended_branch_id
          AND company_membership.status='INVITED'
          AND (
            invitation.intended_branch_id IS NULL
            OR branch_assignment.status='ACTIVE'
          )
          AND department_scope.snapshot->>'assignmentStatus'='ACTIVE'
          AND intended_role.role_key IN (
            'DEPARTMENT_ADMIN','REQUESTER','FINANCE_REVIEWER',
            'AUDITOR','RECEIVING_USER'
          )
        )
        OR (
          invitation.intended_scope_type='DELIVERY'
          AND invitation.company_id IS NULL
          AND invitation.intended_branch_id IS NULL
          AND invitation.intended_department_id IS NULL
          AND invitation.intended_supplier_id IS NULL
          AND account.account_kind='DELIVERY'
          AND NOT account.is_owner
          AND driver.active
          AND intended_role.role_key IN (
            'DELIVERY_TEAM_SUPERVISOR','DELIVERY_AGENT',
            'DELIVERY_DRIVER','DELIVERY_GUY'
          )
        )
      )
  )
$$;

-- The previous image keeps using this signature. Permit the existing invited
-- first administrator to be selected for resend while the retained Company is
-- still onboarding, without making an inactive Company generally manageable.
CREATE OR REPLACE FUNCTION public.axora_account_setup_resend_target(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  target_access jsonb;
  first_administrator_scope jsonb;
  first_administrator_assignment_id uuid;
  first_administrator_company_id uuid;
  result jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_target_user_id IS NULL OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  target_access:=public.axora_lock_user_target_access(
    p_actor_user_id,p_actor_role_assignment_id,'user.invite',
    p_target_user_id,p_at
  );

  IF target_access IS NULL THEN
    SELECT assignment.id,assignment.company_id
    INTO first_administrator_assignment_id,first_administrator_company_id
    FROM public.users account
    JOIN public.role_assignments assignment
      ON assignment.user_id=account.id
     AND assignment.scope_type='COMPANY'
     AND assignment.company_id=account.company_id
     AND assignment.branch_id IS NULL
     AND assignment.department_id IS NULL
     AND assignment.supplier_id IS NULL
     AND assignment.active
     AND assignment.revoked_at IS NULL
    JOIN public.roles role
      ON role.id=assignment.role_id
     AND role.role_key='COMPANY_ADMIN'
    JOIN public.company_memberships membership
      ON membership.user_id=account.id
     AND membership.company_id=assignment.company_id
     AND membership.status='INVITED'
    JOIN public.account_credentials credential
      ON credential.user_id=account.id
     AND credential.password_hash IS NULL
    JOIN public.companies company
      ON company.id=assignment.company_id
     AND public.axora_company_is_retained(company.id)
     AND company.lifecycle_status IN (
       'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
       'COMPANY_ADMINISTRATOR_INVITED'
     )
    WHERE account.id=p_target_user_id
      AND account.account_kind='COMPANY'
      AND account.account_status='INVITED'
      AND account.account_setup_completed_at IS NULL
      AND account.active
    FOR KEY SHARE OF account,assignment,membership,company;

    IF first_administrator_assignment_id IS NOT NULL THEN
      first_administrator_scope:=public.axora_lock_company_admin_invitation_scope(
        p_actor_user_id,p_actor_role_assignment_id,
        first_administrator_company_id,p_at
      );
      IF first_administrator_scope IS NOT NULL THEN
        target_access:=jsonb_build_object(
          'roleAssignmentId',first_administrator_assignment_id
        );
      END IF;
    END IF;
  END IF;
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
      WHEN role.role_key='COMPANY_ADMIN'
        AND assignment.scope_type='COMPANY'
        AND public.axora_company_is_retained(company.id)
        AND company.lifecycle_status IN (
          'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
          'COMPANY_ADMINISTRATOR_INVITED',
          'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
        ) THEN true
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
  )) INTO result
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.id=(target_access->>'roleAssignmentId')::uuid
   AND assignment.user_id=account.id
   AND assignment.active AND assignment.revoked_at IS NULL
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
    AND account.active
    AND account.company_id IS NOT DISTINCT FROM assignment.company_id
    AND account.branch_id IS NOT DISTINCT FROM assignment.branch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.email_recipient_suppressions suppression
      WHERE suppression.recipient_fingerprint=
        public.axora_email_recipient_fingerprint(account.email)
    );
  RETURN result;
END
$$;

-- Post-delivery synchronization is idempotent for later lifecycle states and
-- never regresses an activated or active Company when an additional
-- administrator is invited.
CREATE OR REPLACE FUNCTION public.axora_sync_company_administrator(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_company_id uuid,
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_snapshot jsonb;
  current_status text;
  administrator_id uuid;
  administrator_active boolean:=false;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT lifecycle_status INTO current_status
  FROM public.companies
  WHERE id=p_company_id
    AND public.axora_company_is_retained(id)
  FOR UPDATE;
  IF actor_snapshot IS NULL
    OR actor_snapshot->>'accountKind'<>'PLATFORM'
    OR current_status NOT IN (
      'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
      'COMPANY_ADMINISTRATOR_INVITED',
      'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
    )
    OR NOT (
      public.axora_company_actor_is_owner(actor_snapshot)
      OR actor_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
    )
    OR NOT public.axora_company_snapshot_role_permission(
      actor_snapshot,'user.create'
    )
    OR NOT public.axora_company_snapshot_role_permission(
      actor_snapshot,'user.invite'
    )
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'The Company Administrator lifecycle is unavailable';
  END IF;

  SELECT account.id,(
    account.account_setup_completed_at IS NOT NULL
    AND account.active
    AND account.account_status='ACTIVE'
    AND membership.status='ACTIVE'
    AND EXISTS (
      SELECT 1 FROM public.account_setup_invitations consumed_invitation
      WHERE consumed_invitation.user_id=account.id
        AND consumed_invitation.company_id=p_company_id
        AND consumed_invitation.intended_role_id=assignment.role_id
        AND consumed_invitation.intended_scope_type='COMPANY'
        AND consumed_invitation.consumed_at IS NOT NULL
        AND consumed_invitation.revoked_at IS NULL
    )
  ) INTO administrator_id,administrator_active
  FROM public.users account
  JOIN public.role_assignments assignment
    ON assignment.user_id=account.id
   AND assignment.scope_type='COMPANY'
   AND assignment.company_id=p_company_id
   AND assignment.branch_id IS NULL
   AND assignment.department_id IS NULL
   AND assignment.supplier_id IS NULL
   AND assignment.active
   AND assignment.revoked_at IS NULL
  JOIN public.roles role
    ON role.id=assignment.role_id
   AND role.role_key='COMPANY_ADMIN'
  JOIN public.company_memberships membership
    ON membership.user_id=account.id
   AND membership.company_id=p_company_id
   AND membership.status IN ('INVITED','ACTIVE')
  WHERE account.account_kind='COMPANY'
    AND EXISTS (
      SELECT 1 FROM public.account_setup_invitations invitation
      WHERE invitation.user_id=account.id
        AND invitation.company_id=p_company_id
        AND invitation.intended_role_id=assignment.role_id
        AND invitation.intended_scope_type='COMPANY'
        AND invitation.revoked_at IS NULL
        AND (invitation.delivery_status='SENT'
          OR invitation.consumed_at IS NOT NULL)
    )
  ORDER BY administrator_active DESC,
    account.account_setup_completed_at DESC NULLS LAST,
    account.created_at
  LIMIT 1;
  IF administrator_id IS NULL THEN
    RAISE EXCEPTION 'A delivered Company Administrator invitation is required';
  END IF;

  UPDATE public.company_onboarding_items
  SET status='PASSED',blocking_reason=NULL,
    completed_by=COALESCE(completed_by,p_actor_user_id),
    completed_at=COALESCE(completed_at,p_at)
  WHERE company_id=p_company_id
    AND item_code='ADMIN_INVITATION'
    AND status<>'PASSED';

  IF current_status IN ('ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW') THEN
    PERFORM public.axora_apply_company_status(
      p_company_id,'COMPANY_ADMINISTRATOR_INVITED',p_actor_user_id,
      btrim(p_reason),p_at,
      jsonb_build_object('administratorUserId',administrator_id)
    );
    current_status:='COMPANY_ADMINISTRATOR_INVITED';
  END IF;

  IF administrator_active THEN
    UPDATE public.company_onboarding_items
    SET status='PASSED',blocking_reason=NULL,
      completed_by=COALESCE(completed_by,administrator_id),
      completed_at=COALESCE(completed_at,p_at),
      exception_reason=NULL,exception_approved_by=NULL,
      exception_approved_at=NULL,exception_expires_at=NULL
    WHERE company_id=p_company_id
      AND item_code='ADMIN_ACTIVATION'
      AND status<>'PASSED';
    IF current_status='COMPANY_ADMINISTRATOR_INVITED' THEN
      PERFORM public.axora_apply_company_status(
        p_company_id,'COMPANY_ADMINISTRATOR_ACTIVATED',administrator_id,
        'Company Administrator completed secure account setup',p_at,
        jsonb_build_object('administratorUserId',administrator_id)
      );
      current_status:='COMPANY_ADMINISTRATOR_ACTIVATED';
    END IF;
  END IF;

  RETURN public.axora_company_mutation_payload(
    p_company_id,actor_snapshot,p_actor_user_id,p_at,
    CASE WHEN administrator_active THEN 'company.administrator_activated'
      ELSE 'company.administrator_invited' END,
    true,ARRAY[administrator_id]
  );
END
$$;

-- Account setup calls this inside the same transaction that stores Argon2id,
-- activates membership, and consumes the invitation. A failure therefore
-- rolls the entire activation back and leaves the single-use link retryable.
CREATE OR REPLACE FUNCTION public.axora_complete_company_administrator_setup(
  p_invitation_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  target_account_id uuid;
  target_company_id uuid;
  current_status text;
BEGIN
  SELECT invitation.user_id,invitation.company_id
  INTO target_account_id,target_company_id
  FROM public.account_setup_invitations invitation
  JOIN public.roles intended_role
    ON intended_role.id=invitation.intended_role_id
   AND intended_role.role_key='COMPANY_ADMIN'
  JOIN public.users account
    ON account.id=invitation.user_id
   AND account.company_id=invitation.company_id
   AND account.account_kind='COMPANY'
   AND account.account_status='ACTIVE'
   AND account.active
   AND account.account_setup_completed_at IS NOT NULL
  JOIN public.account_credentials credential
    ON credential.user_id=account.id
   AND credential.password_hash IS NOT NULL
   AND credential.password_algorithm='argon2id'
  JOIN public.company_memberships membership
    ON membership.user_id=account.id
   AND membership.company_id=invitation.company_id
   AND membership.status='ACTIVE'
  JOIN public.role_assignments assignment
    ON assignment.user_id=account.id
   AND assignment.role_id=invitation.intended_role_id
   AND assignment.scope_type='COMPANY'
   AND assignment.company_id=invitation.company_id
   AND assignment.branch_id IS NULL
   AND assignment.department_id IS NULL
   AND assignment.supplier_id IS NULL
   AND assignment.active
   AND assignment.revoked_at IS NULL
  WHERE invitation.id=p_invitation_id
    AND invitation.intended_scope_type='COMPANY'
    AND invitation.intended_branch_id IS NULL
    AND invitation.intended_department_id IS NULL
    AND invitation.intended_supplier_id IS NULL
    AND invitation.delivery_status='SENT'
    AND invitation.sent_at IS NOT NULL
    AND invitation.consumed_at IS NOT NULL
    AND invitation.revoked_at IS NULL
    AND public.axora_account_setup_inviter_can_activate(invitation.id,p_at);
  IF target_account_id IS NULL OR target_company_id IS NULL THEN
    RAISE EXCEPTION 'The Company Administrator setup lifecycle is unavailable';
  END IF;

  SELECT company.lifecycle_status INTO current_status
  FROM public.companies company
  WHERE company.id=target_company_id
    AND public.axora_company_is_retained(company.id)
    AND company.lifecycle_status IN (
      'ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW',
      'COMPANY_ADMINISTRATOR_INVITED',
      'COMPANY_ADMINISTRATOR_ACTIVATED','ACTIVE'
    )
  FOR UPDATE;
  IF current_status IS NULL THEN
    RAISE EXCEPTION 'The Company Administrator setup lifecycle is unavailable';
  END IF;

  UPDATE public.company_onboarding_items
  SET status='PASSED',blocking_reason=NULL,
    completed_by=COALESCE(completed_by,target_account_id),
    completed_at=COALESCE(completed_at,p_at)
  WHERE company_onboarding_items.company_id=target_company_id
    AND item_code='ADMIN_INVITATION'
    AND status<>'PASSED';
  IF current_status IN ('ONBOARDING','PORTAL_DRAFT','COMPANY_REVIEW') THEN
    PERFORM public.axora_apply_company_status(
      target_company_id,'COMPANY_ADMINISTRATOR_INVITED',target_account_id,
      'Delivered Company Administrator invitation reconciled during secure setup',
      p_at,jsonb_build_object('administratorUserId',target_account_id)
    );
    current_status:='COMPANY_ADMINISTRATOR_INVITED';
  END IF;

  UPDATE public.company_onboarding_items
  SET status='PASSED',blocking_reason=NULL,
    completed_by=COALESCE(completed_by,target_account_id),
    completed_at=COALESCE(completed_at,p_at),
    exception_reason=NULL,exception_approved_by=NULL,
    exception_approved_at=NULL,exception_expires_at=NULL
  WHERE company_onboarding_items.company_id=target_company_id
    AND item_code='ADMIN_ACTIVATION'
    AND status<>'PASSED';
  IF current_status='COMPANY_ADMINISTRATOR_INVITED' THEN
    PERFORM public.axora_apply_company_status(
      target_company_id,'COMPANY_ADMINISTRATOR_ACTIVATED',target_account_id,
      'Company Administrator completed secure account setup',p_at,
      jsonb_build_object('administratorUserId',target_account_id)
    );
  END IF;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.axora_account_setup_invitation_is_eligible(
  uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_complete_company_administrator_setup(
  uuid,timestamptz
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_account_setup_invitation_is_eligible(
      uuid,timestamptz
    ) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_complete_company_administrator_setup(
      uuid,timestamptz
    ) TO axora_app;
  END IF;
END
$$;

COMMIT;
