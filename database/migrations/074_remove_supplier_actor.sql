BEGIN;

-- Supplier organizations remain private procurement master data. Only the
-- obsolete interactive supplier actor and its portal capabilities are retired.
UPDATE public.permissions
SET active=false,updated_at=now()
WHERE permission_code IN ('supplier.portal.view','supplier.rfq.respond');

DELETE FROM public.role_permissions role_permission
USING public.permissions permission
WHERE role_permission.permission_id=permission.id
  AND permission.permission_code IN ('supplier.portal.view','supplier.rfq.respond');

-- Invalidate any historical supplier actor session before revoking its active
-- assignment. The role and rows remain available as immutable audit evidence.
UPDATE public.users account
SET auth_version=account.auth_version+1,updated_at=now()
WHERE EXISTS (
  SELECT 1
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE assignment.user_id=account.id
    AND role.role_key='SUPPLIER_USER'
    AND assignment.active
    AND assignment.revoked_at IS NULL
);

UPDATE public.role_assignments assignment
SET active=false,revoked_at=COALESCE(assignment.revoked_at,now())
FROM public.roles role
WHERE role.id=assignment.role_id
  AND role.role_key='SUPPLIER_USER'
  AND assignment.active;

UPDATE public.account_setup_invitations invitation
SET revoked_at=COALESCE(invitation.revoked_at,now()),
    revoked_reason=COALESCE(invitation.revoked_reason,'Supplier actor removed')
FROM public.roles role
WHERE role.id=invitation.intended_role_id
  AND role.role_key='SUPPLIER_USER'
  AND invitation.consumed_at IS NULL
  AND invitation.revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.axora_reject_supplier_actor_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  selected_role_id uuid;
BEGIN
  selected_role_id:=CASE
    WHEN TG_TABLE_NAME='account_setup_invitations'
      THEN NULLIF(to_jsonb(NEW)->>'intended_role_id','')::uuid
    ELSE NULLIF(to_jsonb(NEW)->>'role_id','')::uuid
  END;
  IF EXISTS (
    SELECT 1 FROM public.roles role
    WHERE role.id=selected_role_id AND role.role_key='SUPPLIER_USER'
  ) THEN
    RAISE EXCEPTION 'Supplier actor assignments are no longer supported'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS reject_supplier_actor_user_role ON public.users;
CREATE TRIGGER reject_supplier_actor_user_role
BEFORE INSERT OR UPDATE OF role_id ON public.users
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_supplier_actor_role();

DROP TRIGGER IF EXISTS reject_supplier_actor_role_assignment
  ON public.role_assignments;
CREATE TRIGGER reject_supplier_actor_role_assignment
BEFORE INSERT OR UPDATE OF role_id,active ON public.role_assignments
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_supplier_actor_role();

DROP TRIGGER IF EXISTS reject_supplier_actor_invitation
  ON public.account_setup_invitations;
CREATE TRIGGER reject_supplier_actor_invitation
BEFORE INSERT OR UPDATE OF intended_role_id ON public.account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_supplier_actor_role();

REVOKE ALL ON FUNCTION public.axora_reject_supplier_actor_role() FROM PUBLIC;

COMMIT;
