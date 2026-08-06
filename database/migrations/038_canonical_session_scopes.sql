BEGIN;

-- P0-01 canonical-session slice. Extend normalized role assignments so the
-- authenticated identity can represent department-scoped company users while
-- retaining company-scoped platform account managers and delivery identities.
-- Existing assignments remain valid and no identity or session row is reset.

ALTER TABLE public.role_assignments
  ADD COLUMN IF NOT EXISTS department_id uuid;

ALTER TABLE public.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_scope_type_check;
ALTER TABLE public.role_assignments
  ADD CONSTRAINT role_assignments_scope_type_check
  CHECK (scope_type IN (
    'PLATFORM','COMPANY','BRANCH','DEPARTMENT','SUPPLIER','DELIVERY'
  ));

-- Migration 016 created the original unnamed structural check as
-- role_assignments_check. Drop it before installing the explicit expanded
-- shape constraint. The active/revoked invariant is role_assignments_check1
-- and deliberately remains unchanged.
ALTER TABLE public.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_check;
ALTER TABLE public.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_scope_shape_check;
ALTER TABLE public.role_assignments
  ADD CONSTRAINT role_assignments_scope_shape_check CHECK (
    (scope_type='PLATFORM'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='COMPANY'
      AND company_id IS NOT NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='BRANCH'
      AND company_id IS NOT NULL AND branch_id IS NOT NULL
      AND department_id IS NULL AND supplier_id IS NULL)
    OR
    (scope_type='DEPARTMENT'
      AND company_id IS NOT NULL AND department_id IS NOT NULL
      AND supplier_id IS NULL)
    OR
    (scope_type='SUPPLIER'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NOT NULL)
    OR
    (scope_type='DELIVERY'
      AND company_id IS NULL AND branch_id IS NULL
      AND department_id IS NULL AND supplier_id IS NULL)
  );

ALTER TABLE public.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_department_company_fkey;
ALTER TABLE public.role_assignments
  ADD CONSTRAINT role_assignments_department_company_fkey
  FOREIGN KEY(department_id,company_id)
  REFERENCES public.departments(id,company_id)
  ON DELETE RESTRICT;

DROP INDEX IF EXISTS public.role_assignments_active_scope_uq;
CREATE UNIQUE INDEX role_assignments_active_scope_uq
  ON public.role_assignments(
    user_id,role_id,scope_type,
    COALESCE(company_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(supplier_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE active;

CREATE OR REPLACE FUNCTION public.axora_sync_role_assignment_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
BEGIN
  UPDATE public.user_scopes scope
  SET
    active=false,
    ends_at=COALESCE(NEW.revoked_at,now())
  WHERE scope.source='ROLE_ASSIGNMENT'
    AND scope.source_reference=NEW.id
    AND scope.active
    AND (
      NOT NEW.active
      OR scope.user_id<>NEW.user_id
      OR scope.scope_type<>NEW.scope_type
      OR scope.company_id IS DISTINCT FROM NEW.company_id
      OR scope.branch_id IS DISTINCT FROM NEW.branch_id
      OR scope.department_id IS DISTINCT FROM NEW.department_id
      OR scope.supplier_id IS DISTINCT FROM NEW.supplier_id
    );

  IF NEW.active THEN
    INSERT INTO public.user_scopes(
      user_id,scope_type,company_id,branch_id,department_id,supplier_id,
      source,source_reference,starts_at,ends_at,active,assigned_by
    ) VALUES (
      NEW.user_id,NEW.scope_type,NEW.company_id,NEW.branch_id,
      NEW.department_id,NEW.supplier_id,
      'ROLE_ASSIGNMENT',NEW.id,NEW.assigned_at,NULL,true,NEW.assigned_by
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.axora_sync_role_assignment_scope()
FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_role_assignment_scope
  ON public.role_assignments;
CREATE TRIGGER sync_role_assignment_scope
AFTER INSERT OR UPDATE OF
  user_id,scope_type,company_id,branch_id,department_id,supplier_id,
  active,assigned_at,revoked_at,assigned_by
ON public.role_assignments
FOR EACH ROW
EXECUTE FUNCTION public.axora_sync_role_assignment_scope();

-- Reconcile role-backed scopes in case an assignment was written while an
-- earlier application revision was active. Existing matching active rows are
-- preserved by the unique index; stale mismatches are closed first.
UPDATE public.user_scopes scope
SET active=false,
    ends_at=COALESCE(assignment.revoked_at,now())
FROM public.role_assignments assignment
WHERE scope.source='ROLE_ASSIGNMENT'
  AND scope.source_reference=assignment.id
  AND scope.active
  AND (
    NOT assignment.active
    OR scope.user_id<>assignment.user_id
    OR scope.scope_type<>assignment.scope_type
    OR scope.company_id IS DISTINCT FROM assignment.company_id
    OR scope.branch_id IS DISTINCT FROM assignment.branch_id
    OR scope.department_id IS DISTINCT FROM assignment.department_id
    OR scope.supplier_id IS DISTINCT FROM assignment.supplier_id
  );

INSERT INTO public.user_scopes(
  user_id,scope_type,company_id,branch_id,department_id,supplier_id,
  source,source_reference,starts_at,ends_at,active,assigned_by
)
SELECT
  assignment.user_id,assignment.scope_type,assignment.company_id,
  assignment.branch_id,assignment.department_id,assignment.supplier_id,
  'ROLE_ASSIGNMENT',assignment.id,assignment.assigned_at,
  assignment.revoked_at,assignment.active,assignment.assigned_by
FROM public.role_assignments assignment
ON CONFLICT DO NOTHING;

COMMIT;
