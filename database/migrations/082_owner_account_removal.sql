BEGIN;

CREATE OR REPLACE FUNCTION public.axora_remove_user_account(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_target_user_id uuid,
  p_reason text,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  clean_reason text:=btrim(COALESCE(p_reason,''));
  target public.users%ROWTYPE;
  target_snapshot jsonb;
  revoked_assignments integer:=0;
  revoked_invitations integer:=0;
  disabled_overrides integer:=0;
  cancelled_workflow_emails integer:=0;
  resulting_auth_version integer;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_target_user_id IS NULL OR p_actor_user_id=p_target_user_id
    OR p_at IS NULL OR char_length(clean_reason) NOT BETWEEN 3 AND 500
    OR clean_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'The user account cannot be removed';
  END IF;

  PERFORM 1 FROM public.users account
  WHERE account.id IN (p_actor_user_id,p_target_user_id)
  ORDER BY account.id FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users actor
    JOIN public.role_assignments assignment
      ON assignment.id=p_actor_role_assignment_id
     AND assignment.user_id=actor.id
     AND assignment.active AND assignment.revoked_at IS NULL
     AND assignment.scope_type='PLATFORM'
    JOIN public.roles role ON role.id=assignment.role_id
    WHERE actor.id=p_actor_user_id AND actor.active
      AND actor.account_status='ACTIVE' AND actor.is_owner
      AND role.role_key='PLATFORM_OWNER'
  ) THEN
    RAISE EXCEPTION 'The user account cannot be removed';
  END IF;

  target_snapshot:=public.axora_lock_user_target_access(
    p_actor_user_id,p_actor_role_assignment_id,
    'user.deactivate',p_target_user_id,p_at
  );
  SELECT * INTO target FROM public.users WHERE id=p_target_user_id FOR UPDATE;
  IF target_snapshot IS NULL OR target.id IS NULL OR target.is_owner
    OR target.account_status='DEACTIVATED' THEN
    RAISE EXCEPTION 'The user account cannot be removed';
  END IF;

  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  PERFORM set_config('axora.change_reason',clean_reason,true);

  UPDATE public.account_setup_invitations
  SET revoked_at=p_at,
      revoked_reason=left(clean_reason,240),
      delivery_status=CASE
        WHEN delivery_status IN ('PENDING','SENDING') THEN 'CANCELLED'
        ELSE delivery_status
      END
  WHERE user_id=p_target_user_id
    AND consumed_at IS NULL AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked_invitations=ROW_COUNT;

  UPDATE public.workflow_email_outbox
  SET delivery_status='CANCELLED',last_delivery_error='account_removed'
  WHERE recipient_user_id=p_target_user_id AND delivery_status='PENDING';
  GET DIAGNOSTICS cancelled_workflow_emails=ROW_COUNT;

  UPDATE public.role_assignments
  SET active=false,revoked_at=p_at,revoked_by=p_actor_user_id,
      revoke_reason=clean_reason
  WHERE user_id=p_target_user_id AND active AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked_assignments=ROW_COUNT;

  UPDATE public.user_permission_overrides
  SET active=false
  WHERE user_id=p_target_user_id AND active;
  GET DIAGNOSTICS disabled_overrides=ROW_COUNT;

  UPDATE public.users
  SET active=false,account_status='DEACTIVATED',
      auth_version=auth_version+1,updated_at=p_at
  WHERE id=p_target_user_id
  RETURNING auth_version INTO resulting_auth_version;

  RETURN jsonb_build_object(
    'removed',true,
    'userId',p_target_user_id,
    'authVersion',resulting_auth_version,
    'revokedAssignments',revoked_assignments,
    'revokedInvitations',revoked_invitations,
    'disabledOverrides',disabled_overrides,
    'cancelledWorkflowEmails',cancelled_workflow_emails
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_prevent_removed_user_reactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  IF OLD.account_status='DEACTIVATED'
    AND (NEW.account_status IS DISTINCT FROM 'DEACTIVATED' OR NEW.active) THEN
    RAISE EXCEPTION 'A removed user account cannot be reactivated';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prevent_removed_user_reactivation ON public.users;
CREATE TRIGGER prevent_removed_user_reactivation
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.axora_prevent_removed_user_reactivation();

REVOKE ALL ON FUNCTION public.axora_remove_user_account(
  uuid,uuid,uuid,text,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_prevent_removed_user_reactivation()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_remove_user_account(
      uuid,uuid,uuid,text,timestamptz
    ) TO axora_app;
    REVOKE ALL ON FUNCTION public.axora_prevent_removed_user_reactivation()
    FROM axora_app;
  END IF;
END $$;

COMMIT;
