BEGIN;

-- P1-02: operational organization hierarchy. Existing branch and department
-- identifiers remain stable, while all reorganizations are soft and evidenced.
ALTER TABLE public.branches
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN deactivated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN deactivation_reason text;

UPDATE public.branches branch
SET timezone=company.timezone
FROM public.companies company
WHERE company.id=branch.company_id;

ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_timezone_check,
  DROP CONSTRAINT IF EXISTS branches_deactivation_evidence_check;
ALTER TABLE public.branches
  ADD CONSTRAINT branches_timezone_check CHECK (
    timezone='UTC' OR timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
  ),
  ADD CONSTRAINT branches_deactivation_evidence_check CHECK (
    active OR (deactivated_at IS NOT NULL
      AND char_length(btrim(COALESCE(deactivation_reason,''))) BETWEEN 3 AND 1000)
  );

ALTER TABLE public.departments
  ADD COLUMN parent_department_id uuid,
  ADD COLUMN description text,
  ADD COLUMN manager_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  ADD COLUMN deactivated_at timestamptz,
  ADD COLUMN deactivated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN deactivation_reason text,
  ADD CONSTRAINT departments_parent_company_fk
    FOREIGN KEY(parent_department_id,company_id)
    REFERENCES public.departments(id,company_id) ON DELETE RESTRICT;

UPDATE public.departments department
SET timezone=COALESCE(branch.timezone,company.timezone)
FROM public.companies company
LEFT JOIN public.branches branch ON branch.company_id=company.id
WHERE company.id=department.company_id
  AND (department.branch_id IS NULL OR branch.id=department.branch_id);

ALTER TABLE public.departments
  DROP CONSTRAINT IF EXISTS departments_description_check,
  DROP CONSTRAINT IF EXISTS departments_timezone_check,
  DROP CONSTRAINT IF EXISTS departments_parent_self_check,
  DROP CONSTRAINT IF EXISTS departments_deactivation_evidence_check;
ALTER TABLE public.departments
  ADD CONSTRAINT departments_description_check CHECK (
    char_length(btrim(COALESCE(description,'')))<=1000
  ),
  ADD CONSTRAINT departments_timezone_check CHECK (
    timezone='UTC' OR timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
  ),
  ADD CONSTRAINT departments_parent_self_check CHECK (
    parent_department_id IS NULL OR parent_department_id<>id
  ),
  ADD CONSTRAINT departments_deactivation_evidence_check CHECK (
    active OR (deactivated_at IS NOT NULL
      AND char_length(btrim(COALESCE(deactivation_reason,''))) BETWEEN 3 AND 1000)
  );

CREATE TABLE public.business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  parent_business_unit_id uuid,
  unit_code text NOT NULL CHECK (unit_code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  description text CHECK (char_length(btrim(COALESCE(description,'')))<=1000),
  manager_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deactivation_reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,company_id),
  UNIQUE(company_id,unit_code),
  FOREIGN KEY(parent_business_unit_id,company_id)
    REFERENCES public.business_units(id,company_id) ON DELETE RESTRICT,
  CHECK (parent_business_unit_id IS NULL OR parent_business_unit_id<>id),
  CHECK (active OR (deactivated_at IS NOT NULL
    AND char_length(btrim(COALESCE(deactivation_reason,''))) BETWEEN 3 AND 1000))
);
CREATE UNIQUE INDEX business_units_company_name_lower_uq
  ON public.business_units(company_id,lower(name));

CREATE TABLE public.cost_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  business_unit_id uuid,
  branch_id uuid,
  department_id uuid,
  cost_centre_code text NOT NULL CHECK (
    cost_centre_code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  description text CHECK (char_length(btrim(COALESCE(description,'')))<=1000),
  currency text NOT NULL DEFAULT 'MYR' CHECK (currency ~ '^[A-Z]{3}$'),
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deactivation_reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,company_id),
  UNIQUE(company_id,cost_centre_code),
  FOREIGN KEY(business_unit_id,company_id)
    REFERENCES public.business_units(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES public.departments(id,company_id) ON DELETE RESTRICT,
  CHECK (active OR (deactivated_at IS NOT NULL
    AND char_length(btrim(COALESCE(deactivation_reason,''))) BETWEEN 3 AND 1000))
);
CREATE UNIQUE INDEX cost_centres_company_name_lower_uq
  ON public.cost_centres(company_id,lower(name));

CREATE TABLE public.delivery_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  department_id uuid,
  location_code text NOT NULL CHECK (location_code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 3 AND 5000),
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 300),
  state_region text CHECK (char_length(btrim(COALESCE(state_region,'')))<=300),
  postal_code text CHECK (char_length(btrim(COALESCE(postal_code,'')))<=40),
  country_code text NOT NULL DEFAULT 'MY' CHECK (country_code ~ '^[A-Z]{2}$'),
  timezone text NOT NULL DEFAULT 'Asia/Kuala_Lumpur' CHECK (
    timezone='UTC' OR timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+$'
  ),
  contact_name text CHECK (char_length(btrim(COALESCE(contact_name,'')))<=300),
  contact_phone text CHECK (char_length(btrim(COALESCE(contact_phone,'')))<=120),
  contact_email text CHECK (char_length(btrim(COALESCE(contact_email,'')))<=320),
  delivery_instructions text CHECK (
    char_length(btrim(COALESCE(delivery_instructions,'')))<=5000
  ),
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deactivation_reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,company_id),
  UNIQUE(company_id,location_code),
  FOREIGN KEY(branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES public.departments(id,company_id) ON DELETE RESTRICT,
  CHECK (active OR (deactivated_at IS NOT NULL
    AND char_length(btrim(COALESCE(deactivation_reason,''))) BETWEEN 3 AND 1000))
);
CREATE UNIQUE INDEX delivery_locations_primary_branch_uq
  ON public.delivery_locations(branch_id) WHERE active AND is_primary;
CREATE UNIQUE INDEX delivery_locations_company_name_lower_uq
  ON public.delivery_locations(company_id,lower(name));

CREATE TABLE public.organization_structure_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  node_type text NOT NULL CHECK (
    node_type IN ('BRANCH','DEPARTMENT','BUSINESS_UNIT','COST_CENTRE','DELIVERY_LOCATION')
  ),
  node_id uuid NOT NULL,
  change_type text NOT NULL CHECK (
    change_type IN ('CREATED','UPDATED','MOVED','DEACTIVATED','REACTIVATED')
  ),
  previous_snapshot jsonb CHECK (
    previous_snapshot IS NULL OR (jsonb_typeof(previous_snapshot)='object'
      AND public.workflow_metadata_is_safe(previous_snapshot))
  ),
  new_snapshot jsonb CHECK (
    new_snapshot IS NULL OR (jsonb_typeof(new_snapshot)='object'
      AND public.workflow_metadata_is_safe(new_snapshot))
  ),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_structure_history_node_idx
  ON public.organization_structure_history(company_id,node_type,node_id,changed_at DESC,id DESC);
DROP TRIGGER IF EXISTS organization_structure_history_append_only
  ON public.organization_structure_history;
CREATE TRIGGER organization_structure_history_append_only
BEFORE UPDATE OR DELETE ON public.organization_structure_history
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION public.axora_validate_department_hierarchy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parent_branch uuid; cycle_found boolean;
BEGIN
  NEW.department_code:=upper(btrim(NEW.department_code));
  IF TG_OP='UPDATE' AND NEW.department_code IS DISTINCT FROM OLD.department_code THEN
    RAISE EXCEPTION 'Organization codes are immutable';
  END IF;
  IF NEW.parent_department_id IS NOT NULL THEN
    SELECT branch_id INTO parent_branch FROM public.departments
    WHERE id=NEW.parent_department_id AND company_id=NEW.company_id FOR KEY SHARE;
    IF NOT FOUND OR parent_branch IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION 'The department hierarchy is unavailable';
    END IF;
    WITH RECURSIVE ancestors(id,parent_id) AS (
      SELECT department.id,department.parent_department_id
      FROM public.departments department WHERE department.id=NEW.parent_department_id
      UNION ALL
      SELECT department.id,department.parent_department_id
      FROM public.departments department JOIN ancestors ON department.id=ancestors.parent_id
    ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.id) INTO cycle_found;
    IF cycle_found THEN RAISE EXCEPTION 'The department hierarchy is unavailable'; END IF;
  END IF;
  IF NEW.manager_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_memberships membership
    JOIN public.users account ON account.id=membership.user_id AND account.active
    WHERE membership.user_id=NEW.manager_user_id
      AND membership.company_id=NEW.company_id
      AND membership.status='ACTIVE'
  ) THEN RAISE EXCEPTION 'The department manager is unavailable'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_department_hierarchy ON public.departments;
CREATE TRIGGER validate_department_hierarchy
BEFORE INSERT OR UPDATE ON public.departments
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_department_hierarchy();

CREATE OR REPLACE FUNCTION public.axora_validate_business_unit_hierarchy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cycle_found boolean;
BEGIN
  NEW.unit_code:=upper(btrim(NEW.unit_code));
  IF TG_OP='UPDATE' AND NEW.unit_code IS DISTINCT FROM OLD.unit_code THEN
    RAISE EXCEPTION 'Organization codes are immutable';
  END IF;
  IF NEW.parent_business_unit_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.business_units unit
      WHERE unit.id=NEW.parent_business_unit_id AND unit.company_id=NEW.company_id)
    THEN RAISE EXCEPTION 'The business unit hierarchy is unavailable'; END IF;
    WITH RECURSIVE ancestors(id,parent_id) AS (
      SELECT unit.id,unit.parent_business_unit_id FROM public.business_units unit
      WHERE unit.id=NEW.parent_business_unit_id
      UNION ALL
      SELECT unit.id,unit.parent_business_unit_id
      FROM public.business_units unit JOIN ancestors ON unit.id=ancestors.parent_id
    ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NEW.id) INTO cycle_found;
    IF cycle_found THEN RAISE EXCEPTION 'The business unit hierarchy is unavailable'; END IF;
  END IF;
  IF NEW.manager_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_memberships membership
    JOIN public.users account ON account.id=membership.user_id AND account.active
    WHERE membership.user_id=NEW.manager_user_id
      AND membership.company_id=NEW.company_id AND membership.status='ACTIVE'
  ) THEN RAISE EXCEPTION 'The business unit manager is unavailable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_business_unit_hierarchy
BEFORE INSERT OR UPDATE ON public.business_units
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_business_unit_hierarchy();

CREATE OR REPLACE FUNCTION public.axora_validate_organization_tenant_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE department_branch uuid;
BEGIN
  IF TG_TABLE_NAME='cost_centres' THEN
    NEW.cost_centre_code:=upper(btrim(NEW.cost_centre_code));
    IF TG_OP='UPDATE' AND NEW.cost_centre_code IS DISTINCT FROM OLD.cost_centre_code THEN
      RAISE EXCEPTION 'Organization codes are immutable';
    END IF;
  ELSE
    NEW.location_code:=upper(btrim(NEW.location_code));
    IF TG_OP='UPDATE' AND NEW.location_code IS DISTINCT FROM OLD.location_code THEN
      RAISE EXCEPTION 'Organization codes are immutable';
    END IF;
  END IF;
  IF NEW.department_id IS NOT NULL THEN
    SELECT branch_id INTO department_branch FROM public.departments
    WHERE id=NEW.department_id AND company_id=NEW.company_id FOR KEY SHARE;
    IF NOT FOUND OR department_branch IS DISTINCT FROM NEW.branch_id THEN
      RAISE EXCEPTION 'The organization relationship is unavailable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_cost_centre_links
BEFORE INSERT OR UPDATE ON public.cost_centres
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_organization_tenant_links();
CREATE TRIGGER validate_delivery_location_links
BEFORE INSERT OR UPDATE ON public.delivery_locations
FOR EACH ROW EXECUTE FUNCTION public.axora_validate_organization_tenant_links();

CREATE OR REPLACE FUNCTION public.axora_reject_organization_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Organization records are deactivated, not deleted'; END $$;
CREATE TRIGGER reject_department_delete BEFORE DELETE ON public.departments
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_organization_delete();
CREATE TRIGGER reject_business_unit_delete BEFORE DELETE ON public.business_units
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_organization_delete();
CREATE TRIGGER reject_cost_centre_delete BEFORE DELETE ON public.cost_centres
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_organization_delete();
CREATE TRIGGER reject_delivery_location_delete BEFORE DELETE ON public.delivery_locations
FOR EACH ROW EXECUTE FUNCTION public.axora_reject_organization_delete();

CREATE TRIGGER set_updated_at_business_units BEFORE UPDATE ON public.business_units
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at_cost_centres BEFORE UPDATE ON public.cost_centres
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_updated_at_delivery_locations BEFORE UPDATE ON public.delivery_locations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_business_units AFTER INSERT OR UPDATE OR DELETE ON public.business_units
FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER audit_cost_centres AFTER INSERT OR UPDATE OR DELETE ON public.cost_centres
FOR EACH ROW EXECUTE FUNCTION public.audit_change();
CREATE TRIGGER audit_delivery_locations AFTER INSERT OR UPDATE OR DELETE ON public.delivery_locations
FOR EACH ROW EXECUTE FUNCTION public.audit_change();

-- Department scope is carried by the same immutable invitation identity as
-- role, company, branch and supplier scope.
ALTER TABLE public.account_setup_invitations
  ADD COLUMN intended_department_id uuid;

UPDATE public.account_setup_invitations invitation
SET intended_department_id=assignment.department_id
FROM public.role_assignments assignment
WHERE assignment.user_id=invitation.user_id
  AND assignment.role_id=invitation.intended_role_id
  AND assignment.scope_type='DEPARTMENT'
  AND assignment.company_id IS NOT DISTINCT FROM invitation.company_id
  AND assignment.branch_id IS NOT DISTINCT FROM invitation.intended_branch_id
  AND invitation.intended_scope_type='DEPARTMENT'
  AND invitation.intended_department_id IS NULL;

ALTER TABLE public.account_setup_invitations
  ADD CONSTRAINT account_setup_invitation_department_company_fk
    FOREIGN KEY(intended_department_id,company_id)
    REFERENCES public.departments(id,company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT account_setup_invitation_department_scope_check CHECK (
    (intended_scope_type='DEPARTMENT' AND intended_department_id IS NOT NULL)
    OR (intended_scope_type<>'DEPARTMENT' AND intended_department_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.axora_protect_invitation_department_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.intended_department_id IS DISTINCT FROM OLD.intended_department_id THEN
    RAISE EXCEPTION 'Account setup invitation scope is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_invitation_department_scope
BEFORE UPDATE ON public.account_setup_invitations
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_invitation_department_scope();

-- Revalidate the exact live inviter assignment for every account kind and
-- scope. A valid historical invitation cannot outlive the inviter's authority.
CREATE OR REPLACE FUNCTION public.axora_account_setup_inviter_can_activate(
  p_invitation_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_setup_invitations invitation
    JOIN public.users creator ON creator.id=invitation.created_by
      AND creator.active AND creator.account_status='ACTIVE'
      AND creator.account_setup_completed_at IS NOT NULL
    JOIN public.roles intended_role ON intended_role.id=invitation.intended_role_id
    WHERE invitation.id=p_invitation_id AND (
      EXISTS (
        SELECT 1 FROM public.role_assignments creator_assignment
        WHERE creator_assignment.user_id=creator.id
          AND creator_assignment.active AND creator_assignment.revoked_at IS NULL
          AND public.axora_snapshot_has_permission(
            public.axora_live_authorization_snapshot(
              creator.id,creator_assignment.id,p_at
            ),'user.invite',invitation.intended_scope_type,
            invitation.company_id,invitation.intended_branch_id,
            invitation.intended_department_id,invitation.intended_supplier_id
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

CREATE OR REPLACE FUNCTION public.axora_organization_permission_at(
  p_snapshot jsonb,p_permission text,p_company_id uuid,p_branch_id uuid,
  p_department_id uuid
)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.axora_snapshot_has_permission(
    p_snapshot,p_permission,
    CASE WHEN p_department_id IS NOT NULL THEN 'DEPARTMENT'
      WHEN p_branch_id IS NOT NULL THEN 'BRANCH' ELSE 'COMPANY' END,
    p_company_id,p_branch_id,p_department_id,NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_organization_structure_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_snapshot jsonb; directory jsonb;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF actor_snapshot IS NULL THEN RETURN NULL; END IF;
  directory:=public.axora_organization_directory_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF directory IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'canManageBranches',COALESCE(actor_snapshot->'rolePermissions','[]'::jsonb)
      ? 'organization.branch.manage',
    'canManageDepartments',COALESCE(actor_snapshot->'rolePermissions','[]'::jsonb)
      ? 'organization.department.manage',
    'canManageCostCentres',COALESCE(actor_snapshot->'rolePermissions','[]'::jsonb)
      ? 'organization.cost_center.manage',
    'canManageDeliveryLocations',COALESCE(actor_snapshot->'rolePermissions','[]'::jsonb)
      ? 'organization.delivery_location.manage',
    'companies',directory->'companies','branches',COALESCE((
      SELECT jsonb_agg(branch_record || jsonb_build_object('timezone',branch.timezone)
        ORDER BY branch_record->>'companyName',branch_record->>'name',branch.id)
      FROM jsonb_array_elements(directory->'branches') branch_record
      JOIN public.branches branch ON branch.id=(branch_record->>'id')::uuid
    ),'[]'::jsonb),
    'departments',COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',department.id,'companyId',department.company_id,
        'branchId',department.branch_id,'parentDepartmentId',department.parent_department_id,
        'code',department.department_code,'name',department.name,
        'description',department.description,'managerUserId',department.manager_user_id,
        'timezone',department.timezone,'active',department.active
      )) ORDER BY department.name,department.id)
      FROM public.departments department
      WHERE public.axora_organization_permission_at(
        actor_snapshot,'organization.branch.view',department.company_id,
        department.branch_id,department.id
      )
    ),'[]'::jsonb),
    'businessUnits',COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',unit.id,'companyId',unit.company_id,
        'parentBusinessUnitId',unit.parent_business_unit_id,
        'code',unit.unit_code,'name',unit.name,'description',unit.description,
        'managerUserId',unit.manager_user_id,'active',unit.active
      )) ORDER BY unit.name,unit.id)
      FROM public.business_units unit
      WHERE public.axora_organization_permission_at(
        actor_snapshot,'organization.branch.view',unit.company_id,NULL,NULL
      )
    ),'[]'::jsonb),
    'costCentres',COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',centre.id,'companyId',centre.company_id,
        'businessUnitId',centre.business_unit_id,'branchId',centre.branch_id,
        'departmentId',centre.department_id,'code',centre.cost_centre_code,
        'name',centre.name,'description',centre.description,
        'currency',centre.currency,'active',centre.active
      )) ORDER BY centre.name,centre.id)
      FROM public.cost_centres centre
      WHERE public.axora_organization_permission_at(
        actor_snapshot,'organization.branch.view',centre.company_id,
        centre.branch_id,centre.department_id
      )
    ),'[]'::jsonb),
    'deliveryLocations',COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id',location.id,'companyId',location.company_id,'branchId',location.branch_id,
        'departmentId',location.department_id,'code',location.location_code,
        'name',location.name,'address',location.address,'city',location.city,
        'stateRegion',location.state_region,'postalCode',location.postal_code,
        'countryCode',location.country_code,'timezone',location.timezone,
        'contactName',location.contact_name,'contactPhone',location.contact_phone,
        'contactEmail',location.contact_email,
        'deliveryInstructions',location.delivery_instructions,
        'isPrimary',location.is_primary,'active',location.active
      )) ORDER BY location.name,location.id)
      FROM public.delivery_locations location
      WHERE public.axora_organization_permission_at(
        actor_snapshot,'organization.branch.view',location.company_id,
        location.branch_id,location.department_id
      )
    ),'[]'::jsonb),
    'history',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',history.id,'companyId',history.company_id,'nodeType',history.node_type,
        'nodeId',history.node_id,'changeType',history.change_type,
        'reason',history.reason,'changedAt',history.changed_at,
        'changedByName',actor.display_name
      ) ORDER BY history.changed_at DESC,history.id DESC)
      FROM (SELECT evidence.* FROM public.organization_structure_history evidence
        WHERE public.axora_organization_permission_at(
          actor_snapshot,'organization.branch.view',evidence.company_id,NULL,NULL
        ) ORDER BY evidence.changed_at DESC,evidence.id DESC LIMIT 50) history
      LEFT JOIN public.users actor ON actor.id=history.changed_by
    ),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_save_organization_node(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_node_type text,
  p_node_id uuid,p_company_id uuid,p_code text,p_name text,p_branch_id uuid,
  p_department_id uuid,p_parent_id uuid,p_business_unit_id uuid,p_details jsonb,
  p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_snapshot jsonb; required_permission text; authorized boolean;
  existing_snapshot jsonb; result_id uuid; new_snapshot jsonb; change_kind text;
  effective_branch uuid:=p_branch_id; effective_department uuid:=p_department_id;
BEGIN
  IF p_node_type NOT IN ('BRANCH','DEPARTMENT','BUSINESS_UNIT','COST_CENTRE','DELIVERY_LOCATION')
    OR char_length(btrim(COALESCE(p_code,''))) NOT BETWEEN 2 AND 40
    OR char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 2 AND 200
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR jsonb_typeof(COALESCE(p_details,'{}'::jsonb))<>'object'
    OR NOT public.workflow_metadata_is_safe(COALESCE(p_details,'{}'::jsonb))
  THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies company
    WHERE company.id=p_company_id AND company.active FOR KEY SHARE)
  THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT branch_id INTO effective_branch FROM public.departments
    WHERE id=p_department_id AND company_id=p_company_id AND active FOR KEY SHARE;
    IF NOT FOUND OR (p_branch_id IS NOT NULL AND effective_branch IS DISTINCT FROM p_branch_id)
    THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
  END IF;
  IF p_node_type='DEPARTMENT' AND p_parent_id IS NOT NULL THEN
    effective_department:=p_parent_id;
  END IF;
  required_permission:=CASE p_node_type
    WHEN 'BRANCH' THEN 'organization.branch.manage'
    WHEN 'DEPARTMENT' THEN 'organization.department.manage'
    WHEN 'BUSINESS_UNIT' THEN 'organization.cost_center.manage'
    WHEN 'COST_CENTRE' THEN 'organization.cost_center.manage'
    ELSE 'organization.delivery_location.manage' END;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  authorized:=actor_snapshot IS NOT NULL AND public.axora_organization_permission_at(
    actor_snapshot,required_permission,p_company_id,effective_branch,effective_department
  );
  IF NOT authorized THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;

  IF p_node_type='BRANCH' THEN
    IF p_node_id IS NULL THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
    SELECT to_jsonb(branch) INTO existing_snapshot FROM public.branches branch
    WHERE branch.id=p_node_id AND branch.company_id=p_company_id FOR UPDATE;
    IF existing_snapshot IS NULL OR existing_snapshot->>'branch_code'<>upper(btrim(p_code))
    THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
    UPDATE public.branches SET name=btrim(p_name),
      timezone=COALESCE(NULLIF(p_details->>'timezone',''),timezone),updated_at=p_at
    WHERE id=p_node_id RETURNING id,to_jsonb(branches.*) INTO result_id,new_snapshot;
  ELSIF p_node_type='DEPARTMENT' THEN
    IF p_node_id IS NULL THEN
      INSERT INTO public.departments(
        company_id,branch_id,parent_department_id,department_code,name,
        description,manager_user_id,timezone,created_by,created_at,updated_at
      ) VALUES (
        p_company_id,p_branch_id,p_parent_id,upper(btrim(p_code)),btrim(p_name),
        NULLIF(btrim(p_details->>'description'),''),
        NULLIF(p_details->>'managerUserId','')::uuid,
        COALESCE(NULLIF(p_details->>'timezone',''),(SELECT timezone FROM public.companies WHERE id=p_company_id)),
        p_actor_user_id,p_at,p_at
      ) RETURNING id,to_jsonb(departments.*) INTO result_id,new_snapshot;
    ELSE
      SELECT to_jsonb(department) INTO existing_snapshot FROM public.departments department
      WHERE department.id=p_node_id AND department.company_id=p_company_id FOR UPDATE;
      IF existing_snapshot IS NULL OR existing_snapshot->>'department_code'<>upper(btrim(p_code))
      THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
      UPDATE public.departments SET branch_id=p_branch_id,parent_department_id=p_parent_id,
        name=btrim(p_name),description=NULLIF(btrim(p_details->>'description'),''),
        manager_user_id=NULLIF(p_details->>'managerUserId','')::uuid,
        timezone=COALESCE(NULLIF(p_details->>'timezone',''),timezone),updated_at=p_at
      WHERE id=p_node_id RETURNING id,to_jsonb(departments.*) INTO result_id,new_snapshot;
    END IF;
  ELSIF p_node_type='BUSINESS_UNIT' THEN
    IF p_node_id IS NULL THEN
      INSERT INTO public.business_units(
        company_id,parent_business_unit_id,unit_code,name,description,
        manager_user_id,created_by,created_at,updated_at
      ) VALUES (
        p_company_id,p_parent_id,upper(btrim(p_code)),btrim(p_name),
        NULLIF(btrim(p_details->>'description'),''),
        NULLIF(p_details->>'managerUserId','')::uuid,p_actor_user_id,p_at,p_at
      ) RETURNING id,to_jsonb(business_units.*) INTO result_id,new_snapshot;
    ELSE
      SELECT to_jsonb(unit) INTO existing_snapshot FROM public.business_units unit
      WHERE unit.id=p_node_id AND unit.company_id=p_company_id FOR UPDATE;
      IF existing_snapshot IS NULL OR existing_snapshot->>'unit_code'<>upper(btrim(p_code))
      THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
      UPDATE public.business_units SET parent_business_unit_id=p_parent_id,
        name=btrim(p_name),description=NULLIF(btrim(p_details->>'description'),''),
        manager_user_id=NULLIF(p_details->>'managerUserId','')::uuid,updated_at=p_at
      WHERE id=p_node_id RETURNING id,to_jsonb(business_units.*) INTO result_id,new_snapshot;
    END IF;
  ELSIF p_node_type='COST_CENTRE' THEN
    IF p_node_id IS NULL THEN
      INSERT INTO public.cost_centres(
        company_id,business_unit_id,branch_id,department_id,cost_centre_code,
        name,description,currency,created_by,created_at,updated_at
      ) VALUES (
        p_company_id,p_business_unit_id,effective_branch,p_department_id,
        upper(btrim(p_code)),btrim(p_name),NULLIF(btrim(p_details->>'description'),''),
        COALESCE(NULLIF(upper(p_details->>'currency'),''),'MYR'),p_actor_user_id,p_at,p_at
      ) RETURNING id,to_jsonb(cost_centres.*) INTO result_id,new_snapshot;
    ELSE
      SELECT to_jsonb(centre) INTO existing_snapshot FROM public.cost_centres centre
      WHERE centre.id=p_node_id AND centre.company_id=p_company_id FOR UPDATE;
      IF existing_snapshot IS NULL OR existing_snapshot->>'cost_centre_code'<>upper(btrim(p_code))
      THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
      UPDATE public.cost_centres SET business_unit_id=p_business_unit_id,
        branch_id=effective_branch,department_id=p_department_id,name=btrim(p_name),
        description=NULLIF(btrim(p_details->>'description'),''),
        currency=COALESCE(NULLIF(upper(p_details->>'currency'),''),currency),updated_at=p_at
      WHERE id=p_node_id RETURNING id,to_jsonb(cost_centres.*) INTO result_id,new_snapshot;
    END IF;
  ELSE
    IF effective_branch IS NULL THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
    IF p_node_id IS NULL THEN
      INSERT INTO public.delivery_locations(
        company_id,branch_id,department_id,location_code,name,address,city,
        state_region,postal_code,country_code,timezone,contact_name,contact_phone,
        contact_email,delivery_instructions,is_primary,created_by,created_at,updated_at
      ) VALUES (
        p_company_id,effective_branch,p_department_id,upper(btrim(p_code)),btrim(p_name),
        btrim(p_details->>'address'),btrim(p_details->>'city'),
        NULLIF(btrim(p_details->>'stateRegion'),''),NULLIF(btrim(p_details->>'postalCode'),''),
        COALESCE(NULLIF(upper(p_details->>'countryCode'),''),'MY'),
        COALESCE(NULLIF(p_details->>'timezone',''),(SELECT timezone FROM public.branches WHERE id=effective_branch)),
        NULLIF(btrim(p_details->>'contactName'),''),NULLIF(btrim(p_details->>'contactPhone'),''),
        NULLIF(lower(btrim(p_details->>'contactEmail')),''),
        NULLIF(btrim(p_details->>'deliveryInstructions'),''),
        COALESCE((p_details->>'isPrimary')::boolean,false),p_actor_user_id,p_at,p_at
      ) RETURNING id,to_jsonb(delivery_locations.*) INTO result_id,new_snapshot;
    ELSE
      SELECT to_jsonb(location) INTO existing_snapshot FROM public.delivery_locations location
      WHERE location.id=p_node_id AND location.company_id=p_company_id FOR UPDATE;
      IF existing_snapshot IS NULL OR existing_snapshot->>'location_code'<>upper(btrim(p_code))
      THEN RAISE EXCEPTION 'The organization change is unavailable'; END IF;
      UPDATE public.delivery_locations SET branch_id=effective_branch,
        department_id=p_department_id,name=btrim(p_name),address=btrim(p_details->>'address'),
        city=btrim(p_details->>'city'),state_region=NULLIF(btrim(p_details->>'stateRegion'),''),
        postal_code=NULLIF(btrim(p_details->>'postalCode'),''),
        country_code=COALESCE(NULLIF(upper(p_details->>'countryCode'),''),country_code),
        timezone=COALESCE(NULLIF(p_details->>'timezone',''),timezone),
        contact_name=NULLIF(btrim(p_details->>'contactName'),''),
        contact_phone=NULLIF(btrim(p_details->>'contactPhone'),''),
        contact_email=NULLIF(lower(btrim(p_details->>'contactEmail')),''),
        delivery_instructions=NULLIF(btrim(p_details->>'deliveryInstructions'),''),
        is_primary=COALESCE((p_details->>'isPrimary')::boolean,false),updated_at=p_at
      WHERE id=p_node_id RETURNING id,to_jsonb(delivery_locations.*) INTO result_id,new_snapshot;
    END IF;
  END IF;

  change_kind:=CASE WHEN p_node_id IS NULL THEN 'CREATED'
    WHEN (existing_snapshot->>'branch_id') IS DISTINCT FROM (new_snapshot->>'branch_id')
      OR (existing_snapshot->>'parent_department_id') IS DISTINCT FROM (new_snapshot->>'parent_department_id')
      OR (existing_snapshot->>'parent_business_unit_id') IS DISTINCT FROM (new_snapshot->>'parent_business_unit_id')
      OR (existing_snapshot->>'department_id') IS DISTINCT FROM (new_snapshot->>'department_id')
      THEN 'MOVED' ELSE 'UPDATED' END;
  INSERT INTO public.organization_structure_history(
    company_id,node_type,node_id,change_type,previous_snapshot,new_snapshot,
    reason,changed_by,changed_at
  ) VALUES (
    p_company_id,p_node_type,result_id,change_kind,existing_snapshot,new_snapshot,
    btrim(p_reason),p_actor_user_id,p_at
  );
  RETURN jsonb_build_object(
    'nodeType',p_node_type,'nodeId',result_id,'companyId',p_company_id,
    'eventKey',CASE WHEN change_kind='CREATED' THEN 'organization.node.created'
      WHEN change_kind='MOVED' THEN 'organization.node.moved' ELSE 'organization.node.updated' END
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_organization_node_active(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_node_type text,
  p_node_id uuid,p_active boolean,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_snapshot jsonb; company_id uuid; branch_id uuid; department_id uuid;
  permission_code text; prior jsonb; current jsonb; current_active boolean;
BEGIN
  IF p_node_type NOT IN ('BRANCH','DEPARTMENT','BUSINESS_UNIT','COST_CENTRE','DELIVERY_LOCATION')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'The organization status change is unavailable'; END IF;
  IF p_node_type='BRANCH' THEN
    SELECT branch.company_id,branch.id,branch.active,to_jsonb(branch)
      INTO company_id,branch_id,current_active,prior
    FROM public.branches branch WHERE branch.id=p_node_id FOR UPDATE;
    permission_code:='organization.branch.manage';
  ELSIF p_node_type='DEPARTMENT' THEN
    SELECT department.company_id,department.branch_id,department.id,
      department.active,to_jsonb(department)
      INTO company_id,branch_id,department_id,current_active,prior
    FROM public.departments department WHERE department.id=p_node_id FOR UPDATE;
    permission_code:='organization.department.manage';
  ELSIF p_node_type='BUSINESS_UNIT' THEN
    SELECT unit.company_id,unit.active,to_jsonb(unit)
      INTO company_id,current_active,prior
    FROM public.business_units unit WHERE unit.id=p_node_id FOR UPDATE;
    permission_code:='organization.cost_center.manage';
  ELSIF p_node_type='COST_CENTRE' THEN
    SELECT centre.company_id,centre.branch_id,centre.department_id,
      centre.active,to_jsonb(centre)
      INTO company_id,branch_id,department_id,current_active,prior
    FROM public.cost_centres centre WHERE centre.id=p_node_id FOR UPDATE;
    permission_code:='organization.cost_center.manage';
  ELSE
    SELECT location.company_id,location.branch_id,location.department_id,
      location.active,to_jsonb(location)
      INTO company_id,branch_id,department_id,current_active,prior
    FROM public.delivery_locations location WHERE location.id=p_node_id FOR UPDATE;
    permission_code:='organization.delivery_location.manage';
  END IF;
  actor_snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF company_id IS NULL OR actor_snapshot IS NULL OR NOT public.axora_organization_permission_at(
    actor_snapshot,permission_code,company_id,branch_id,department_id
  ) THEN RAISE EXCEPTION 'The organization status change is unavailable'; END IF;
  IF current_active=p_active THEN RAISE EXCEPTION 'The organization status change is unavailable'; END IF;

  IF NOT p_active AND (
    (p_node_type='BRANCH' AND (
      EXISTS (SELECT 1 FROM public.departments child WHERE child.branch_id=p_node_id AND child.active)
      OR EXISTS (SELECT 1 FROM public.delivery_locations child WHERE child.branch_id=p_node_id AND child.active)
      OR EXISTS (SELECT 1 FROM public.role_assignments assignment
        WHERE assignment.branch_id=p_node_id AND assignment.active AND assignment.revoked_at IS NULL)
    ))
    OR (p_node_type='DEPARTMENT' AND (
      EXISTS (SELECT 1 FROM public.departments child
        WHERE child.parent_department_id=p_node_id AND child.active)
      OR EXISTS (SELECT 1 FROM public.cost_centres child WHERE child.department_id=p_node_id AND child.active)
      OR EXISTS (SELECT 1 FROM public.delivery_locations child WHERE child.department_id=p_node_id AND child.active)
      OR EXISTS (SELECT 1 FROM public.role_assignments assignment
        WHERE assignment.department_id=p_node_id AND assignment.active AND assignment.revoked_at IS NULL)
    ))
    OR (p_node_type='BUSINESS_UNIT' AND (
      EXISTS (SELECT 1 FROM public.business_units child
        WHERE child.parent_business_unit_id=p_node_id AND child.active)
      OR EXISTS (SELECT 1 FROM public.cost_centres child
        WHERE child.business_unit_id=p_node_id AND child.active)
    ))
  ) THEN RAISE EXCEPTION 'The organization status change is unavailable'; END IF;

  IF p_node_type='BRANCH' THEN
    UPDATE public.branches SET active=p_active,
      deactivated_at=CASE WHEN p_active THEN NULL ELSE p_at END,
      deactivated_by=CASE WHEN p_active THEN NULL ELSE p_actor_user_id END,
      deactivation_reason=CASE WHEN p_active THEN NULL ELSE btrim(p_reason) END,
      updated_at=p_at WHERE id=p_node_id RETURNING to_jsonb(branches.*) INTO current;
  ELSIF p_node_type='DEPARTMENT' THEN
    UPDATE public.departments SET active=p_active,
      deactivated_at=CASE WHEN p_active THEN NULL ELSE p_at END,
      deactivated_by=CASE WHEN p_active THEN NULL ELSE p_actor_user_id END,
      deactivation_reason=CASE WHEN p_active THEN NULL ELSE btrim(p_reason) END,
      updated_at=p_at WHERE id=p_node_id RETURNING to_jsonb(departments.*) INTO current;
  ELSIF p_node_type='BUSINESS_UNIT' THEN
    UPDATE public.business_units SET active=p_active,
      deactivated_at=CASE WHEN p_active THEN NULL ELSE p_at END,
      deactivated_by=CASE WHEN p_active THEN NULL ELSE p_actor_user_id END,
      deactivation_reason=CASE WHEN p_active THEN NULL ELSE btrim(p_reason) END,
      updated_at=p_at WHERE id=p_node_id RETURNING to_jsonb(business_units.*) INTO current;
  ELSIF p_node_type='COST_CENTRE' THEN
    UPDATE public.cost_centres SET active=p_active,
      deactivated_at=CASE WHEN p_active THEN NULL ELSE p_at END,
      deactivated_by=CASE WHEN p_active THEN NULL ELSE p_actor_user_id END,
      deactivation_reason=CASE WHEN p_active THEN NULL ELSE btrim(p_reason) END,
      updated_at=p_at WHERE id=p_node_id RETURNING to_jsonb(cost_centres.*) INTO current;
  ELSE
    UPDATE public.delivery_locations SET active=p_active,
      deactivated_at=CASE WHEN p_active THEN NULL ELSE p_at END,
      deactivated_by=CASE WHEN p_active THEN NULL ELSE p_actor_user_id END,
      deactivation_reason=CASE WHEN p_active THEN NULL ELSE btrim(p_reason) END,
      updated_at=p_at WHERE id=p_node_id RETURNING to_jsonb(delivery_locations.*) INTO current;
  END IF;
  INSERT INTO public.organization_structure_history(
    company_id,node_type,node_id,change_type,previous_snapshot,new_snapshot,
    reason,changed_by,changed_at
  ) VALUES (
    company_id,p_node_type,p_node_id,
    CASE WHEN p_active THEN 'REACTIVATED' ELSE 'DEACTIVATED' END,
    prior,current,btrim(p_reason),p_actor_user_id,p_at
  );
  RETURN jsonb_build_object(
    'nodeType',p_node_type,'nodeId',p_node_id,'companyId',company_id,
    'eventKey',CASE WHEN p_active THEN 'organization.node.reactivated'
      ELSE 'organization.node.deactivated' END
  );
END $$;

REVOKE ALL ON TABLE public.business_units,public.cost_centres,
  public.delivery_locations,public.organization_structure_history FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_validate_department_hierarchy(),
  public.axora_validate_business_unit_hierarchy(),
  public.axora_validate_organization_tenant_links(),
  public.axora_reject_organization_delete(),
  public.axora_protect_invitation_department_scope(),
  public.axora_organization_permission_at(jsonb,text,uuid,uuid,uuid),
  public.axora_organization_structure_workspace(uuid,uuid,timestamptz),
  public.axora_save_organization_node(
    uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,uuid,jsonb,text,timestamptz
  ),
  public.axora_set_organization_node_active(uuid,uuid,text,uuid,boolean,text,timestamptz)
FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.business_units,public.cost_centres,
      public.delivery_locations,public.organization_structure_history FROM axora_app;
    GRANT EXECUTE ON FUNCTION
      public.axora_account_setup_inviter_can_activate(uuid,timestamptz),
      public.axora_organization_structure_workspace(uuid,uuid,timestamptz),
      public.axora_save_organization_node(
        uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,uuid,jsonb,text,timestamptz
      ),
      public.axora_set_organization_node_active(uuid,uuid,text,uuid,boolean,text,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
