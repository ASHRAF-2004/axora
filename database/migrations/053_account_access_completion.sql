BEGIN;

-- P0-06: bind account activation to explicit policy acknowledgements while
-- preserving already-consumed historical invitations as legacy evidence.
ALTER TABLE public.account_setup_invitations
  ADD COLUMN terms_policy_version text,
  ADD COLUMN terms_accepted_at timestamptz,
  ADD COLUMN privacy_policy_version text,
  ADD COLUMN privacy_accepted_at timestamptz;

UPDATE public.account_setup_invitations
SET terms_policy_version='legacy-account-setup',
    terms_accepted_at=consumed_at,
    privacy_policy_version='legacy-account-setup',
    privacy_accepted_at=consumed_at
WHERE consumed_at IS NOT NULL;

ALTER TABLE public.account_setup_invitations
  ADD CONSTRAINT account_setup_invitations_policy_evidence_check CHECK (
    (consumed_at IS NULL AND terms_policy_version IS NULL
      AND terms_accepted_at IS NULL AND privacy_policy_version IS NULL
      AND privacy_accepted_at IS NULL)
    OR (consumed_at IS NOT NULL
      AND char_length(btrim(terms_policy_version)) BETWEEN 1 AND 80
      AND terms_policy_version ~ '^[A-Za-z0-9._-]+$'
      AND terms_accepted_at IS NOT NULL AND terms_accepted_at<=consumed_at
      AND char_length(btrim(privacy_policy_version)) BETWEEN 1 AND 80
      AND privacy_policy_version ~ '^[A-Za-z0-9._-]+$'
      AND privacy_accepted_at IS NOT NULL AND privacy_accepted_at<=consumed_at)
  );

-- A token remains valid only while its recorded issuer retains the authority
-- that permitted the invitation. This closes stale inviter and scope changes
-- without exposing the reason to the public activation page.
CREATE OR REPLACE FUNCTION public.axora_account_setup_inviter_can_activate(
  p_invitation_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_setup_invitations invitation
    JOIN public.users creator ON creator.id=invitation.created_by
    JOIN public.roles intended_role ON intended_role.id=invitation.intended_role_id
    WHERE invitation.id=p_invitation_id
      AND creator.active AND creator.account_status='ACTIVE'
      AND creator.account_setup_completed_at IS NOT NULL
      AND (
        (creator.is_owner AND creator.account_kind='PLATFORM' AND EXISTS (
          SELECT 1 FROM public.role_assignments assignment
          JOIN public.roles role ON role.id=assignment.role_id
          WHERE assignment.user_id=creator.id AND assignment.active
            AND assignment.revoked_at IS NULL
            AND assignment.scope_type='PLATFORM'
            AND role.role_key='PLATFORM_OWNER'
        ))
        OR (
          intended_role.role_key='COMPANY_ADMIN'
          AND invitation.company_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.company_assignments company_assignment
            WHERE company_assignment.company_id=invitation.company_id
              AND company_assignment.manager_user_id=creator.id
              AND company_assignment.status='ACTIVE'
              AND company_assignment.assigned_at<=p_at
              AND (company_assignment.assignment_type='PRIMARY'
                OR (company_assignment.coverage_starts_at<=p_at
                  AND company_assignment.coverage_ends_at>p_at))
          )
          AND EXISTS (
            SELECT 1 FROM public.role_assignments assignment
            JOIN public.roles role ON role.id=assignment.role_id
            WHERE assignment.user_id=creator.id AND assignment.active
              AND assignment.revoked_at IS NULL
              AND role.role_key='CLIENT_ACCOUNT_MANAGER'
          )
        )
        OR (
          invitation.company_id IS NOT NULL
          AND invitation.intended_scope_type='COMPANY'
          AND intended_role.role_key IN (
            'COMPANY_APPROVER','FINANCE_REVIEWER','AUDITOR','RECEIVING_USER'
          )
          AND EXISTS (
            SELECT 1 FROM public.role_assignments assignment
            JOIN public.roles role ON role.id=assignment.role_id
            WHERE assignment.user_id=creator.id AND assignment.active
              AND assignment.revoked_at IS NULL
              AND assignment.scope_type='COMPANY'
              AND assignment.company_id=invitation.company_id
              AND role.role_key='COMPANY_ADMIN'
          )
        )
        OR (
          invitation.company_id IS NOT NULL
          AND invitation.intended_branch_id IS NOT NULL
          AND invitation.intended_scope_type='BRANCH'
          AND intended_role.role_key IN (
            'BRANCH_APPROVER','REQUESTER','RECEIVING_USER'
          )
          AND EXISTS (
            SELECT 1 FROM public.role_assignments assignment
            JOIN public.roles role ON role.id=assignment.role_id
            WHERE assignment.user_id=creator.id AND assignment.active
              AND assignment.revoked_at IS NULL
              AND assignment.scope_type='BRANCH'
              AND assignment.company_id=invitation.company_id
              AND assignment.branch_id=invitation.intended_branch_id
              AND role.role_key='BRANCH_ADMIN'
          )
        )
        OR (
          invitation.intended_scope_type='DELIVERY'
          AND intended_role.role_key='DELIVERY_DRIVER'
          AND EXISTS (
            SELECT 1 FROM public.role_assignments assignment
            JOIN public.roles role ON role.id=assignment.role_id
            WHERE assignment.user_id=creator.id AND assignment.active
              AND assignment.revoked_at IS NULL
              AND role.role_key='DELIVERY_TEAM_SUPERVISOR'
          )
        )
      )
  )
$$;

-- Queue a tokenless confirmation after a successful password reset. Relax the
-- reset-token source uniqueness to one row per message kind, never per retry.
ALTER TABLE public.transactional_email_outbox
  DROP CONSTRAINT transactional_email_outbox_message_kind_v2_check,
  DROP CONSTRAINT transactional_email_outbox_source_v2_check,
  DROP CONSTRAINT transactional_email_outbox_payload_v2_check,
  DROP CONSTRAINT transactional_email_outbox_password_reset_token_id_key,
  ADD CONSTRAINT transactional_email_outbox_message_kind_v3_check CHECK (
    message_kind IN ('CONTACT_NOTIFICATION','CONTACT_ACKNOWLEDGEMENT',
      'PASSWORD_RESET','PASSWORD_CHANGED','EMAIL_VERIFICATION')
  ),
  ADD CONSTRAINT transactional_email_outbox_source_v3_check CHECK (
    (message_kind IN ('CONTACT_NOTIFICATION','CONTACT_ACKNOWLEDGEMENT')
      AND contact_submission_id IS NOT NULL
      AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NULL)
    OR (message_kind IN ('PASSWORD_RESET','PASSWORD_CHANGED')
      AND contact_submission_id IS NULL
      AND password_reset_token_id IS NOT NULL
      AND email_verification_token_id IS NULL)
    OR (message_kind='EMAIL_VERIFICATION' AND contact_submission_id IS NULL
      AND password_reset_token_id IS NULL
      AND email_verification_token_id IS NOT NULL)
  ),
  ADD CONSTRAINT transactional_email_outbox_payload_v3_check CHECK (
    (message_kind IN (
        'CONTACT_NOTIFICATION','CONTACT_ACKNOWLEDGEMENT','PASSWORD_CHANGED'
      ) AND token_ciphertext IS NULL AND token_nonce IS NULL
        AND token_authentication_tag IS NULL)
    OR (message_kind IN ('PASSWORD_RESET','EMAIL_VERIFICATION') AND (
      (delivery_status IN ('PENDING','SENDING')
        AND token_ciphertext IS NOT NULL AND token_nonce IS NOT NULL
        AND token_authentication_tag IS NOT NULL)
      OR (delivery_status NOT IN ('PENDING','SENDING')
        AND token_ciphertext IS NULL AND token_nonce IS NULL
        AND token_authentication_tag IS NULL)
    ))
  );
CREATE UNIQUE INDEX transactional_email_outbox_reset_kind_uq
  ON public.transactional_email_outbox(password_reset_token_id,message_kind)
  WHERE password_reset_token_id IS NOT NULL;

REVOKE ALL ON FUNCTION
  public.axora_account_setup_inviter_can_activate(uuid,timestamptz)
FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION
      public.axora_account_setup_inviter_can_activate(uuid,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
