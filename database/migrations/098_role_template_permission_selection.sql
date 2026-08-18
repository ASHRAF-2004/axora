BEGIN;

SELECT pg_advisory_xact_lock(95217734);

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- Account invitations submit the complete effective permission selection, not
-- only explicit overrides. A selected permission that already belongs to the
-- target role template does not grant new authority, so the inviter must not
-- be required to exercise that operational permission personally. This keeps
-- the grant-subset rule for every true explicit GRANT difference.
DO $migration$
DECLARE
  definition text;
  revised text;
  old_guard text := $old$  FOREACH permission_code IN ARRAY selected_codes LOOP
    IF NOT public.axora_snapshot_has_permission(
      actor_snapshot,permission_code,target_assignment.scope_type,
      target_assignment.company_id,target_assignment.branch_id,
      target_assignment.department_id,target_assignment.supplier_id
    ) THEN RAISE EXCEPTION 'The actor cannot grant permission %',permission_code; END IF;
  END LOOP;$old$;
  new_guard text := $new$  SELECT COALESCE(
    array_agg(permission.permission_code ORDER BY permission.permission_code),
    ARRAY[]::text[]
  )
  INTO role_default_codes
  FROM public.role_permissions role_permission
  JOIN public.permissions permission
    ON permission.id=role_permission.permission_id
   AND permission.active
  WHERE role_permission.role_id=target_assignment.role_id;

  FOREACH permission_code IN ARRAY selected_codes LOOP
    IF NOT (permission_code=ANY(role_default_codes))
      AND NOT public.axora_snapshot_has_permission(
        actor_snapshot,permission_code,target_assignment.scope_type,
        target_assignment.company_id,target_assignment.branch_id,
        target_assignment.department_id,target_assignment.supplier_id
      ) THEN
      RAISE EXCEPTION 'The actor cannot grant permission %',permission_code;
    END IF;
  END LOOP;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_replace_user_permission_set(uuid,uuid,uuid,uuid,text[],text,timestamptz)'::regprocedure
  ) INTO definition;

  IF definition IS NULL THEN
    RAISE EXCEPTION
      'axora_replace_user_permission_set is unavailable';
  END IF;

  revised:=replace(
    definition,
    '  selected_codes text[];',
    '  selected_codes text[];' || E'\n  role_default_codes text[];'
  );
  IF revised=definition THEN
    RAISE EXCEPTION
      'Permission-set declaration source is unavailable';
  END IF;
  definition:=revised;

  revised:=replace(definition,old_guard,new_guard);
  IF revised=definition THEN
    RAISE EXCEPTION
      'Permission-set grant guard source is unavailable';
  END IF;

  EXECUTE revised;
END
$migration$;

REVOKE ALL ON FUNCTION public.axora_replace_user_permission_set(
  uuid,uuid,uuid,uuid,text[],text,timestamptz
) FROM PUBLIC;

DO $verification$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_replace_user_permission_set(uuid,uuid,uuid,uuid,text[],text,timestamptz)'::regprocedure
  ) INTO definition;

  IF definition IS NULL
    OR position('role_default_codes' IN definition)=0
    OR position('permission_code=ANY(role_default_codes)' IN definition)=0 THEN
    RAISE EXCEPTION
      'Role-template permission selection repair was not installed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='axora_app'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.axora_replace_user_permission_set(
      uuid,uuid,uuid,uuid,text[],text,timestamptz
    ) TO axora_app;

    IF NOT has_function_privilege(
      'axora_app',
      'public.axora_replace_user_permission_set(uuid,uuid,uuid,uuid,text[],text,timestamptz)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION
        'axora_app is missing the permission-set command capability';
    END IF;
  END IF;
END
$verification$;

COMMENT ON FUNCTION public.axora_replace_user_permission_set(
  uuid,uuid,uuid,uuid,text[],text,timestamptz
) IS
  'Replaces explicit permission differences from a target role template; role-template selections do not require the inviter to possess the operational permission, while true explicit grants remain grant-subset constrained.';

COMMIT;
