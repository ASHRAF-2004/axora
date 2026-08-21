BEGIN;

-- Prompt 8: canonical scoped carts and inherited category purchasing policy.
-- These structures are additive so the migration-104 image remains safe during
-- the rollback window. Existing requests, prices, approvals and evidence are
-- not rewritten.

INSERT INTO public.permissions(
  permission_code,permission_group,label,description,high_risk
) VALUES (
  'procurement.category_policy.manage','Procurement',
  'Manage category purchasing policy',
  'Narrow the catalogue categories that may be purchased in an authorized company, branch, or department scope.',
  true
) ON CONFLICT(permission_code) DO UPDATE SET
  permission_group=EXCLUDED.permission_group,label=EXCLUDED.label,
  description=EXCLUDED.description,high_risk=EXCLUDED.high_risk,
  active=true,updated_at=now();

INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission
  ON permission.permission_code='procurement.category_policy.manage'
WHERE role.role_key='COMPANY_ADMIN'
ON CONFLICT DO NOTHING;

CREATE TABLE public.procurement_category_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_type text NOT NULL CHECK (scope_type IN ('COMPANY','BRANCH','DEPARTMENT')),
  branch_id uuid,
  department_id uuid,
  version integer NOT NULL CHECK (version>0),
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_by_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  FOREIGN KEY(branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES public.departments(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (scope_type='COMPANY' AND branch_id IS NULL AND department_id IS NULL)
    OR (scope_type='BRANCH' AND branch_id IS NOT NULL AND department_id IS NULL)
    OR (scope_type='DEPARTMENT' AND branch_id IS NOT NULL AND department_id IS NOT NULL)
  ),
  CHECK ((active AND retired_at IS NULL) OR (NOT active AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX procurement_category_policies_active_scope_uq
  ON public.procurement_category_policies(
    company_id,scope_type,
    COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE active;
CREATE INDEX procurement_category_policies_history_idx
  ON public.procurement_category_policies(company_id,created_at DESC,id);

CREATE TABLE public.procurement_category_policy_categories (
  policy_id uuid NOT NULL REFERENCES public.procurement_category_policies(id)
    ON DELETE RESTRICT,
  category text NOT NULL CHECK (char_length(btrim(category)) BETWEEN 1 AND 160),
  PRIMARY KEY(policy_id,category)
);

CREATE TABLE public.procurement_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  department_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUBMITTED','ABANDONED')),
  cart_version integer NOT NULL DEFAULT 1 CHECK (cart_version>0),
  submitted_request_id uuid REFERENCES public.requests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  FOREIGN KEY(branch_id,company_id)
    REFERENCES public.branches(id,company_id) ON DELETE RESTRICT,
  FOREIGN KEY(department_id,company_id)
    REFERENCES public.departments(id,company_id) ON DELETE RESTRICT,
  CHECK (
    (status='SUBMITTED' AND submitted_request_id IS NOT NULL AND submitted_at IS NOT NULL)
    OR (status<>'SUBMITTED' AND submitted_request_id IS NULL AND submitted_at IS NULL)
  )
);
CREATE UNIQUE INDEX procurement_carts_one_active_scope_uq
  ON public.procurement_carts(
    user_id,company_id,branch_id,
    COALESCE(department_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE status='ACTIVE';
CREATE INDEX procurement_carts_user_idx
  ON public.procurement_carts(user_id,status,updated_at DESC,id);

CREATE TABLE public.procurement_cart_items (
  cart_id uuid NOT NULL REFERENCES public.procurement_carts(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity>=1),
  specification text NOT NULL DEFAULT '' CHECK (
    char_length(specification)<=1000 AND specification !~ '[[:cntrl:]]'
  ),
  displayed_unit_price numeric(18,4) NOT NULL CHECK (displayed_unit_price>=0),
  displayed_price_rule_version integer NOT NULL CHECK (displayed_price_rule_version>=0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  added_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(cart_id,product_id)
);

CREATE TABLE public.procurement_cart_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.procurement_carts(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED','ITEM_ADDED','ITEM_UPDATED','ITEM_REMOVED','PRICES_ACKNOWLEDGED','SUBMITTED'
  )),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_role_assignment_id uuid NOT NULL
    REFERENCES public.role_assignments(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL UNIQUE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata)='object' AND public.workflow_metadata_is_safe(metadata)
  ),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procurement_cart_events_cart_idx
  ON public.procurement_cart_events(cart_id,occurred_at,id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'procurement_category_policies','procurement_category_policy_categories',
    'procurement_carts','procurement_cart_items','procurement_cart_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
  END LOOP;
END $$;

CREATE TRIGGER procurement_cart_events_append_only
BEFORE UPDATE OR DELETE ON public.procurement_cart_events
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

INSERT INTO public.company_deletion_ownership_rules(
  table_name,unprotected_action,protected_action,rationale
) VALUES
  ('procurement_category_policies','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Versioned category purchasing rules are tenant policy and audit evidence.'),
  ('procurement_carts','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Canonical scoped carts are company-owned procurement records.'),
  ('procurement_cart_events','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED',
    'Cart command and submission events are immutable idempotency and audit evidence.')
ON CONFLICT(table_name) DO UPDATE SET
  unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,
  rationale=EXCLUDED.rationale;

INSERT INTO public.company_deletion_ownership_dag(delete_order,table_name,rationale)
SELECT (SELECT COALESCE(max(existing.delete_order),0)
        FROM public.company_deletion_ownership_dag existing)+ordered.ordinality,
  ordered.table_name,
  'Prompt 8 tenant procurement ownership; children precede their scoped parent records.'
FROM unnest(ARRAY[
  'procurement_cart_events','procurement_carts','procurement_category_policies'
]::text[]) WITH ORDINALITY AS ordered(table_name,ordinality)
ON CONFLICT(table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.axora_category_allowed_for_scope(
  p_company_id uuid,p_branch_id uuid,p_department_id uuid,p_category text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.procurement_category_policies policy
    WHERE policy.company_id=p_company_id AND policy.active
      AND (
        policy.scope_type='COMPANY'
        OR (policy.scope_type='BRANCH' AND policy.branch_id=p_branch_id)
        OR (policy.scope_type='DEPARTMENT'
          AND policy.branch_id=p_branch_id
          AND policy.department_id=p_department_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.procurement_category_policy_categories allowed
        WHERE allowed.policy_id=policy.id AND allowed.category=p_category
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_procurement_scope_authorized(
  p_snapshot jsonb,p_permission text,p_company_id uuid,p_branch_id uuid,
  p_department_id uuid
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_snapshot_has_permission(
    p_snapshot,p_permission,
    CASE WHEN p_department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
    p_company_id,p_branch_id,p_department_id,NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_catalog_purchasing_scope(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE;
  department_id_value uuid;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=p_branch_id AND branch.active;
  department_id_value:=CASE WHEN snapshot->>'scopeType'='DEPARTMENT'
    THEN NULLIF(snapshot->>'departmentId','')::uuid ELSE NULL END;
  IF snapshot IS NULL OR branch_row.id IS NULL
    OR (department_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.departments department
      WHERE department.id=department_id_value
        AND department.company_id=branch_row.company_id
        AND department.branch_id=branch_row.id AND department.active
    ))
    OR NOT public.axora_procurement_scope_authorized(
      snapshot,'product.view',branch_row.company_id,branch_row.id,
      department_id_value
    )
  THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'companyId',branch_row.company_id,'branchId',branch_row.id,
    'departmentId',department_id_value,
    'allowedCategories',COALESCE((SELECT jsonb_agg(category ORDER BY category)
      FROM (SELECT DISTINCT product.category
        FROM public.products product
        WHERE product.active AND NOT product.needs_review
          AND (product.company_id IS NULL OR product.company_id=branch_row.company_id)
          AND public.axora_category_allowed_for_scope(
            branch_row.company_id,branch_row.id,department_id_value,product.category
          )) allowed),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_category_policy_parent_allows(
  p_company_id uuid,p_branch_id uuid,p_department_id uuid,p_scope_type text,
  p_category text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.procurement_category_policies policy
    WHERE policy.company_id=p_company_id AND policy.active
      AND (
        policy.scope_type='COMPANY'
        OR (p_scope_type='DEPARTMENT' AND policy.scope_type='BRANCH'
          AND policy.branch_id=p_branch_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.procurement_category_policy_categories allowed
        WHERE allowed.policy_id=policy.id AND allowed.category=p_category
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_category_policy_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'capturedAt',p_at,
    'categories',COALESCE((SELECT jsonb_agg(category ORDER BY category)
      FROM (SELECT DISTINCT product.category
        FROM public.products product
        WHERE product.active AND NOT product.needs_review
          AND (product.company_id IS NULL
            OR public.axora_snapshot_scope_contains(
              snapshot,'COMPANY',product.company_id,NULL,NULL,NULL
            ))) available),'[]'::jsonb),
    'scopes',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'type',scope.scope_type,'companyId',scope.company_id,
      'companyName',scope.company_name,'branchId',scope.branch_id,
      'branchName',scope.branch_name,'departmentId',scope.department_id,
      'departmentName',scope.department_name,
      'version',policy.version,'enabled',COALESCE(policy.active,false),
      'allowedCategories',COALESCE((SELECT jsonb_agg(item.category ORDER BY item.category)
        FROM public.procurement_category_policy_categories item
        WHERE item.policy_id=policy.id),'[]'::jsonb)
    ) ORDER BY scope.company_name,scope.branch_name NULLS FIRST,
      scope.department_name NULLS FIRST)
    FROM (
      SELECT 'COMPANY'::text AS scope_type,company.id AS company_id,
        company.name AS company_name,NULL::uuid AS branch_id,
        NULL::text AS branch_name,NULL::uuid AS department_id,
        NULL::text AS department_name
      FROM public.companies company
      WHERE company.active AND public.axora_snapshot_has_permission(
        snapshot,'procurement.category_policy.manage','COMPANY',
        company.id,NULL,NULL,NULL
      )
      UNION ALL
      SELECT 'BRANCH',branch.company_id,company.name,branch.id,branch.name,NULL,NULL
      FROM public.branches branch
      JOIN public.companies company ON company.id=branch.company_id
      WHERE branch.active AND company.active
        AND public.axora_snapshot_has_permission(
          snapshot,'procurement.category_policy.manage','BRANCH',
          branch.company_id,branch.id,NULL,NULL
        )
      UNION ALL
      SELECT 'DEPARTMENT',department.company_id,company.name,
        department.branch_id,branch.name,department.id,department.name
      FROM public.departments department
      JOIN public.branches branch ON branch.id=department.branch_id
      JOIN public.companies company ON company.id=department.company_id
      WHERE department.active AND branch.active AND company.active
        AND public.axora_snapshot_has_permission(
          snapshot,'procurement.category_policy.manage','DEPARTMENT',
          department.company_id,department.branch_id,department.id,NULL
        )
    ) scope
    LEFT JOIN public.procurement_category_policies policy
      ON policy.company_id=scope.company_id AND policy.scope_type=scope.scope_type
      AND policy.branch_id IS NOT DISTINCT FROM scope.branch_id
      AND policy.department_id IS NOT DISTINCT FROM scope.department_id
      AND policy.active),'[]'::jsonb)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_set_category_policy(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_scope_type text,
  p_company_id uuid,p_branch_id uuid,p_department_id uuid,p_enabled boolean,
  p_allowed_categories text[],p_expected_version integer,p_reason text,
  p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; current_policy public.procurement_category_policies%ROWTYPE;
  replay_policy public.procurement_category_policies%ROWTYPE;
  policy_id_value uuid:=gen_random_uuid(); next_version integer;
  category_value text; clean_categories text[]; resource_type text;
BEGIN
  IF p_command_id IS NULL OR p_scope_type NOT IN ('COMPANY','BRANCH','DEPARTMENT')
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR p_expected_version<0
    OR (p_scope_type='COMPANY' AND (p_branch_id IS NOT NULL OR p_department_id IS NOT NULL))
    OR (p_scope_type='BRANCH' AND (p_branch_id IS NULL OR p_department_id IS NOT NULL))
    OR (p_scope_type='DEPARTMENT' AND (p_branch_id IS NULL OR p_department_id IS NULL))
  THEN RAISE EXCEPTION 'The category policy command is invalid'; END IF;
  SELECT ARRAY(SELECT DISTINCT btrim(value) FROM unnest(
    COALESCE(p_allowed_categories,ARRAY[]::text[])
  ) value WHERE char_length(btrim(value)) BETWEEN 1 AND 160 ORDER BY btrim(value))
  INTO clean_categories;
  IF cardinality(clean_categories)<>cardinality(COALESCE(p_allowed_categories,ARRAY[]::text[]))
    AND EXISTS (SELECT 1 FROM unnest(COALESCE(p_allowed_categories,ARRAY[]::text[])) value
      WHERE char_length(btrim(value)) NOT BETWEEN 1 AND 160)
  THEN RAISE EXCEPTION 'The category policy command is invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'procurement-category-policy:'||p_company_id::text,0
  ));
  SELECT * INTO replay_policy FROM public.procurement_category_policies policy
  WHERE policy.command_id=p_command_id;
  IF replay_policy.id IS NOT NULL THEN
    IF replay_policy.created_by<>p_actor_user_id
      OR replay_policy.created_by_role_assignment_id<>p_actor_role_assignment_id
      OR replay_policy.company_id<>p_company_id
      OR replay_policy.scope_type<>p_scope_type
      OR replay_policy.branch_id IS DISTINCT FROM p_branch_id
      OR replay_policy.department_id IS DISTINCT FROM p_department_id
      OR replay_policy.active<>p_enabled
      OR replay_policy.reason<>btrim(p_reason)
      OR ARRAY(SELECT item.category
        FROM public.procurement_category_policy_categories item
        WHERE item.policy_id=replay_policy.id ORDER BY item.category)
        IS DISTINCT FROM clean_categories
    THEN RAISE EXCEPTION 'The category policy command is unavailable'; END IF;
    RETURN jsonb_build_object('policyId',replay_policy.id,
      'version',replay_policy.version,'enabled',replay_policy.active);
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  resource_type:=p_scope_type;
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'procurement.category_policy.manage',resource_type,
    p_company_id,p_branch_id,p_department_id,NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.companies company WHERE company.id=p_company_id AND company.active
  ) OR (p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches branch WHERE branch.id=p_branch_id
      AND branch.company_id=p_company_id AND branch.active
  )) OR (p_department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments department WHERE department.id=p_department_id
      AND department.company_id=p_company_id AND department.branch_id=p_branch_id
      AND department.active
  )) THEN RAISE EXCEPTION 'The category policy is unavailable' USING ERRCODE='42501'; END IF;
  IF p_enabled THEN
    FOREACH category_value IN ARRAY clean_categories LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.category=category_value AND product.active AND NOT product.needs_review
          AND (product.company_id IS NULL OR product.company_id=p_company_id)
      ) OR NOT public.axora_category_policy_parent_allows(
        p_company_id,p_branch_id,p_department_id,p_scope_type,category_value
      ) THEN RAISE EXCEPTION 'A child category policy cannot broaden its parent policy'
        USING ERRCODE='P8210'; END IF;
    END LOOP;
  END IF;
  SELECT * INTO current_policy FROM public.procurement_category_policies policy
  WHERE policy.company_id=p_company_id AND policy.scope_type=p_scope_type
    AND policy.branch_id IS NOT DISTINCT FROM p_branch_id
    AND policy.department_id IS NOT DISTINCT FROM p_department_id
    AND policy.active FOR UPDATE;
  IF COALESCE(current_policy.version,0)<>p_expected_version THEN
    RAISE EXCEPTION 'The category policy changed before it was saved'
      USING ERRCODE='P8203';
  END IF;
  SELECT COALESCE(max(policy.version),0)+1 INTO next_version
  FROM public.procurement_category_policies policy
  WHERE policy.company_id=p_company_id AND policy.scope_type=p_scope_type
    AND policy.branch_id IS NOT DISTINCT FROM p_branch_id
    AND policy.department_id IS NOT DISTINCT FROM p_department_id;
  IF current_policy.id IS NOT NULL THEN
    UPDATE public.procurement_category_policies SET active=false,retired_at=p_at
    WHERE id=current_policy.id;
  END IF;
  INSERT INTO public.procurement_category_policies(
    id,company_id,scope_type,branch_id,department_id,version,active,reason,
    created_by,created_by_role_assignment_id,command_id,created_at,retired_at
  ) VALUES (
    policy_id_value,p_company_id,p_scope_type,p_branch_id,p_department_id,
    next_version,p_enabled,btrim(p_reason),p_actor_user_id,
    p_actor_role_assignment_id,p_command_id,p_at,
    CASE WHEN p_enabled THEN NULL ELSE p_at END
  );
  INSERT INTO public.procurement_category_policy_categories(policy_id,category)
  SELECT policy_id_value,value FROM unnest(clean_categories) value;
  RETURN jsonb_build_object('policyId',policy_id_value,
    'version',next_version,'enabled',p_enabled,
    'allowedCategories',to_jsonb(clean_categories));
END $$;

CREATE OR REPLACE FUNCTION public.axora_procurement_cart_snapshot_internal(
  p_cart_id uuid,p_at timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object(
    'id',cart.id,'companyId',cart.company_id,'branchId',cart.branch_id,
    'departmentId',cart.department_id,'version',cart.cart_version,
    'status',cart.status,
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'publicRef',product.public_reference,'name',product.name,
      'category',product.category,'subcategory',product.subcategory,
      'brand',product.brand,'size',product.product_size,
      'unit',product.unit_of_measure,'description',product.description,
      'unitPrice',offer.selling_price::text,
      'displayedUnitPrice',item.displayed_unit_price::text,
      'priceRuleVersion',offer.pricing_rule_version,
      'displayedPriceRuleVersion',item.displayed_price_rule_version,
      'currency',offer.price_currency,'deliverySlaDays',product.delivery_sla_days,
      'hasImage',(product.image_content IS NOT NULL),
      'imageAltText',product.image_alt_text,'quantity',item.quantity,
      'specification',item.specification,
      'available',(product.active AND NOT product.needs_review
        AND (product.company_id IS NULL OR product.company_id=cart.company_id)),
      'categoryAllowed',public.axora_category_allowed_for_scope(
        cart.company_id,cart.branch_id,cart.department_id,product.category
      ),
      'repriced',(item.displayed_unit_price<>offer.selling_price
        OR item.displayed_price_rule_version<>offer.pricing_rule_version),
      'lineTotal',round(item.quantity*offer.selling_price,2)::text
    ) ORDER BY item.added_at,item.product_id)
      FROM public.procurement_cart_items item
      JOIN public.products product ON product.id=item.product_id
      CROSS JOIN LATERAL public.axora_current_product_offer_internal(
        product.id,p_at
      ) offer
      WHERE item.cart_id=cart.id),'[]'::jsonb),
    'updatedAt',cart.updated_at
  )
  FROM public.procurement_carts cart WHERE cart.id=p_cart_id
$$;

CREATE OR REPLACE FUNCTION public.axora_procurement_cart_command(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_operation text,p_product_public_ref text,p_quantity integer,
  p_specification text,p_expected_version integer,p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE;
  cart_row public.procurement_carts%ROWTYPE; product_row public.products%ROWTYPE;
  offer record; department_id_value uuid; operation_value text;
  specification_value text:=btrim(COALESCE(p_specification,''));
  payload_hash_value text; existing_event public.procurement_cart_events%ROWTYPE;
  event_type_value text; changed_count integer;
BEGIN
  IF p_command_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'The cart command is invalid';
  END IF;
  operation_value:=upper(btrim(COALESCE(p_operation,'')));
  IF operation_value NOT IN ('READ','ADD','SET','REMOVE','ACKNOWLEDGE_PRICES')
    OR char_length(specification_value)>1000
    OR specification_value ~ '[[:cntrl:]]'
    OR (operation_value IN ('ADD','SET') AND COALESCE(p_quantity,0)<1)
  THEN RAISE EXCEPTION 'The cart command is invalid'; END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'actorUserId',p_actor_user_id,'roleAssignmentId',p_actor_role_assignment_id,
    'branchId',p_branch_id,'operation',operation_value,
    'productRef',NULLIF(btrim(COALESCE(p_product_public_ref,'')),''),
    'quantity',p_quantity,'specification',specification_value,
    'expectedVersion',p_expected_version
  )::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'procurement-cart-command:'||p_command_id::text,0
  ));
  SELECT * INTO existing_event FROM public.procurement_cart_events event
  WHERE event.command_id=p_command_id;
  IF existing_event.id IS NOT NULL THEN
    IF existing_event.actor_user_id<>p_actor_user_id
      OR existing_event.actor_role_assignment_id<>p_actor_role_assignment_id
      OR existing_event.payload_hash<>payload_hash_value
    THEN RAISE EXCEPTION 'The cart command is unavailable'; END IF;
    RETURN public.axora_procurement_cart_snapshot_internal(
      existing_event.cart_id,p_at
    );
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=p_branch_id AND branch.active FOR KEY SHARE;
  department_id_value:=CASE WHEN snapshot->>'scopeType'='DEPARTMENT'
    THEN NULLIF(snapshot->>'departmentId','')::uuid ELSE NULL END;
  IF snapshot IS NULL OR snapshot->>'accountKind'<>'COMPANY'
    OR branch_row.id IS NULL
    OR (department_id_value IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.departments department
      WHERE department.id=department_id_value
        AND department.company_id=branch_row.company_id
        AND department.branch_id=branch_row.id AND department.active
    ))
    OR NOT public.axora_procurement_scope_authorized(
      snapshot,'request.create',branch_row.company_id,branch_row.id,
      department_id_value
    )
  THEN RAISE EXCEPTION 'The cart is unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'procurement-category-policy:'||branch_row.company_id::text,0
  ));
  SELECT * INTO cart_row FROM public.procurement_carts cart
  WHERE cart.user_id=p_actor_user_id AND cart.company_id=branch_row.company_id
    AND cart.branch_id=branch_row.id
    AND cart.department_id IS NOT DISTINCT FROM department_id_value
    AND cart.status='ACTIVE' FOR UPDATE;
  IF cart_row.id IS NULL THEN
    INSERT INTO public.procurement_carts(
      user_id,company_id,branch_id,department_id,created_at,updated_at
    ) VALUES (
      p_actor_user_id,branch_row.company_id,branch_row.id,
      department_id_value,p_at,p_at
    ) RETURNING * INTO cart_row;
    IF operation_value='READ' THEN event_type_value:='CREATED'; END IF;
  END IF;
  IF p_expected_version IS NOT NULL
    AND p_expected_version<>cart_row.cart_version THEN
    RAISE EXCEPTION 'The cart changed before this command was recorded'
      USING ERRCODE='P8203';
  END IF;

  IF operation_value IN ('ADD','SET','REMOVE') THEN
    SELECT * INTO product_row FROM public.products product
    WHERE product.public_reference=btrim(COALESCE(p_product_public_ref,''))
    FOR KEY SHARE;
    IF product_row.id IS NULL OR NOT product_row.active OR product_row.needs_review
      OR (product_row.company_id IS NOT NULL
        AND product_row.company_id<>branch_row.company_id)
      OR NOT public.axora_category_allowed_for_scope(
        branch_row.company_id,branch_row.id,department_id_value,
        product_row.category
      )
    THEN RAISE EXCEPTION 'The product is unavailable for this purchasing scope'
      USING ERRCODE='P8204'; END IF;
  END IF;

  IF operation_value IN ('ADD','SET') THEN
    SELECT * INTO offer FROM public.axora_current_product_offer_internal(
      product_row.id,p_at
    );
    IF offer.pricing_rule_id IS NULL OR offer.price_currency<>'MYR' THEN
      RAISE EXCEPTION 'The current product price is unavailable';
    END IF;
    INSERT INTO public.procurement_cart_items(
      cart_id,product_id,quantity,specification,displayed_unit_price,
      displayed_price_rule_version,currency,added_at,updated_at
    ) VALUES (
      cart_row.id,product_row.id,p_quantity,specification_value,
      offer.selling_price,offer.pricing_rule_version,offer.price_currency,p_at,p_at
    ) ON CONFLICT(cart_id,product_id) DO UPDATE SET
      quantity=CASE WHEN operation_value='ADD'
        THEN public.procurement_cart_items.quantity+EXCLUDED.quantity
        ELSE EXCLUDED.quantity END,
      specification=CASE WHEN operation_value='ADD'
        THEN public.procurement_cart_items.specification
        ELSE EXCLUDED.specification END,
      displayed_unit_price=EXCLUDED.displayed_unit_price,
      displayed_price_rule_version=EXCLUDED.displayed_price_rule_version,
      currency=EXCLUDED.currency,updated_at=p_at;
    event_type_value:=CASE WHEN operation_value='ADD'
      THEN 'ITEM_ADDED' ELSE 'ITEM_UPDATED' END;
  ELSIF operation_value='REMOVE' THEN
    DELETE FROM public.procurement_cart_items item
    WHERE item.cart_id=cart_row.id AND item.product_id=product_row.id;
    event_type_value:='ITEM_REMOVED';
  ELSIF operation_value='ACKNOWLEDGE_PRICES' THEN
    UPDATE public.procurement_cart_items item SET
      displayed_unit_price=offer.selling_price,
      displayed_price_rule_version=offer.pricing_rule_version,
      currency=offer.price_currency,updated_at=p_at
    FROM public.products product
    CROSS JOIN LATERAL public.axora_current_product_offer_internal(
      product.id,p_at
    ) offer
    WHERE item.cart_id=cart_row.id AND product.id=item.product_id
      AND product.active AND NOT product.needs_review
      AND (product.company_id IS NULL OR product.company_id=branch_row.company_id)
      AND public.axora_category_allowed_for_scope(
        branch_row.company_id,branch_row.id,department_id_value,product.category
      );
    GET DIAGNOSTICS changed_count=ROW_COUNT;
    event_type_value:='PRICES_ACKNOWLEDGED';
  END IF;

  IF operation_value<>'READ' THEN
    UPDATE public.procurement_carts SET cart_version=cart_version+1,
      updated_at=p_at WHERE id=cart_row.id RETURNING * INTO cart_row;
  END IF;
  IF event_type_value IS NOT NULL THEN
    INSERT INTO public.procurement_cart_events(
      cart_id,company_id,event_type,actor_user_id,actor_role_assignment_id,
      command_id,payload_hash,metadata,occurred_at
    ) VALUES (
      cart_row.id,cart_row.company_id,event_type_value,p_actor_user_id,
      p_actor_role_assignment_id,p_command_id,payload_hash_value,
      jsonb_strip_nulls(jsonb_build_object(
        'productRef',NULLIF(btrim(COALESCE(p_product_public_ref,'')),''),
        'quantity',p_quantity,'changedCount',changed_count
      )),p_at
    );
  END IF;
  RETURN public.axora_procurement_cart_snapshot_internal(cart_row.id,p_at);
END $$;

CREATE OR REPLACE FUNCTION public.axora_lock_procurement_cart_for_submission(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_cart_id uuid,
  p_expected_version integer,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; cart_row public.procurement_carts%ROWTYPE;
  invalid_count integer; repriced_count integer; line_count integer;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO cart_row FROM public.procurement_carts cart
  WHERE cart.id=p_cart_id FOR UPDATE;
  IF snapshot IS NULL OR cart_row.id IS NULL OR cart_row.status<>'ACTIVE'
    OR cart_row.user_id<>p_actor_user_id
    OR cart_row.cart_version<>p_expected_version
    OR NOT public.axora_procurement_scope_authorized(
      snapshot,'request.create',cart_row.company_id,cart_row.branch_id,
      cart_row.department_id
    )
  THEN RAISE EXCEPTION 'The cart changed before submission'
    USING ERRCODE='P8203'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'procurement-category-policy:'||cart_row.company_id::text,0
  ));
  SELECT count(*)::int,
    count(*) FILTER (WHERE NOT product.active OR product.needs_review
      OR (product.company_id IS NOT NULL AND product.company_id<>cart_row.company_id)
      OR NOT public.axora_category_allowed_for_scope(
        cart_row.company_id,cart_row.branch_id,cart_row.department_id,
        product.category
      ))::int,
    count(*) FILTER (WHERE item.displayed_unit_price<>offer.selling_price
      OR item.displayed_price_rule_version<>offer.pricing_rule_version
      OR item.currency<>offer.price_currency)::int
  INTO line_count,invalid_count,repriced_count
  FROM public.procurement_cart_items item
  JOIN public.products product ON product.id=item.product_id
  CROSS JOIN LATERAL public.axora_current_product_offer_internal(
    product.id,p_at
  ) offer
  WHERE item.cart_id=cart_row.id;
  IF line_count=0 THEN RAISE EXCEPTION 'The cart is empty' USING ERRCODE='P8205'; END IF;
  IF invalid_count>0 THEN
    RAISE EXCEPTION 'A cart item is no longer available for this purchasing scope'
      USING ERRCODE='P8204';
  END IF;
  IF repriced_count>0 THEN
    RAISE EXCEPTION 'A cart item price changed and requires review'
      USING ERRCODE='P8202';
  END IF;
  RETURN jsonb_build_object(
    'cartId',cart_row.id,'version',cart_row.cart_version,
    'companyId',cart_row.company_id,'branchId',cart_row.branch_id,
    'departmentId',cart_row.department_id,
    'lines',(SELECT jsonb_agg(jsonb_build_object(
      'productId',item.product_id,'quantity',item.quantity,
      'specification',item.specification
    ) ORDER BY item.added_at,item.product_id)
      FROM public.procurement_cart_items item WHERE item.cart_id=cart_row.id)
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_consume_procurement_cart(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_cart_id uuid,
  p_expected_version integer,p_request_id uuid,p_command_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cart_row public.procurement_carts%ROWTYPE; request_row public.requests%ROWTYPE;
  payload_hash_value text;
BEGIN
  SELECT * INTO cart_row FROM public.procurement_carts cart
  WHERE cart.id=p_cart_id FOR UPDATE;
  SELECT * INTO request_row FROM public.requests request
  WHERE request.id=p_request_id FOR KEY SHARE;
  IF cart_row.id IS NULL OR request_row.id IS NULL
    OR cart_row.user_id<>p_actor_user_id OR request_row.created_by<>p_actor_user_id
    OR cart_row.status<>'ACTIVE' OR cart_row.cart_version<>p_expected_version
    OR cart_row.company_id<>request_row.company_id
    OR cart_row.branch_id<>request_row.branch_id
    OR cart_row.department_id IS DISTINCT FROM request_row.department_id
  THEN RAISE EXCEPTION 'The cart cannot be submitted' USING ERRCODE='P8203'; END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'cartId',p_cart_id,'version',p_expected_version,'requestId',p_request_id
  )::text,'UTF8')),'hex');
  UPDATE public.procurement_carts SET status='SUBMITTED',
    submitted_request_id=p_request_id,submitted_at=p_at,updated_at=p_at,
    cart_version=cart_version+1 WHERE id=cart_row.id;
  INSERT INTO public.procurement_cart_events(
    cart_id,company_id,event_type,actor_user_id,actor_role_assignment_id,
    command_id,payload_hash,metadata,occurred_at
  ) VALUES (
    cart_row.id,cart_row.company_id,'SUBMITTED',p_actor_user_id,
    p_actor_role_assignment_id,p_command_id,payload_hash_value,
    jsonb_build_object('requestId',p_request_id),p_at
  ) ON CONFLICT(command_id) DO NOTHING;
  RETURN jsonb_build_object('cartId',cart_row.id,'requestId',p_request_id,'status','SUBMITTED');
END $$;

CREATE OR REPLACE FUNCTION public.axora_cart_matches_request_snapshot(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_cart_id uuid,
  p_request_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; cart_row public.procurement_carts%ROWTYPE;
  request_row public.requests%ROWTYPE;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO cart_row FROM public.procurement_carts cart WHERE cart.id=p_cart_id;
  SELECT * INTO request_row FROM public.requests request WHERE request.id=p_request_id;
  IF snapshot IS NULL OR cart_row.id IS NULL OR request_row.id IS NULL
    OR cart_row.user_id<>p_actor_user_id OR request_row.created_by<>p_actor_user_id
    OR cart_row.company_id<>request_row.company_id
    OR cart_row.branch_id<>request_row.branch_id
    OR cart_row.department_id IS DISTINCT FROM request_row.department_id
    OR NOT public.axora_procurement_scope_authorized(
      snapshot,'request.create',request_row.company_id,request_row.branch_id,
      request_row.department_id
    )
  THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.procurement_cart_items item WHERE item.cart_id=cart_row.id
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.procurement_cart_items item
    LEFT JOIN public.request_lines line
      ON line.request_id=request_row.id AND line.product_id=item.product_id
    WHERE item.cart_id=cart_row.id AND (
      line.id IS NULL OR line.quantity<>item.quantity
      OR line.unit_sell_price<>item.displayed_unit_price
      OR line.commercial_pricing_rule_version<>item.displayed_price_rule_version
      OR line.commercial_currency_snapshot<>item.currency
    )
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.request_lines line
    LEFT JOIN public.procurement_cart_items item
      ON item.cart_id=cart_row.id AND item.product_id=line.product_id
    WHERE line.request_id=request_row.id AND item.product_id IS NULL
  );
END $$;

-- Keep the historical supplier-rule validator intact for private sourcing.
-- Only the active customer request-line trigger retires MOQ/increment rules.
CREATE OR REPLACE FUNCTION public.axora_customer_quantity_is_valid(
  p_quantity numeric,p_maximum numeric
)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_quantity IS NOT NULL AND p_quantity=trunc(p_quantity)
    AND p_quantity>=1 AND (p_maximum IS NULL OR p_quantity<=p_maximum)
$$;

DO $patch$
DECLARE definition text; patched text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_prepare_request_line_commercial_snapshot()'::regprocedure
  ) INTO definition;
  patched:=replace(definition,
    $$NOT public.axora_quantity_is_valid(
      NEW.quantity,OLD.submitted_minimum_quantity,OLD.submitted_maximum_quantity,
      OLD.submitted_order_increment
    )$$,
    $$NOT public.axora_customer_quantity_is_valid(
      NEW.quantity,OLD.submitted_maximum_quantity
    )$$);
  patched:=replace(patched,
    $$NOT public.axora_quantity_is_valid(
    NEW.quantity,offer.minimum_quantity,offer.maximum_quantity,offer.order_increment
  )$$,
    $$NOT public.axora_customer_quantity_is_valid(
    NEW.quantity,offer.maximum_quantity
  )$$);
  IF definition IS NULL OR patched=definition
    OR position('axora_customer_quantity_is_valid' IN patched)=0 THEN
    RAISE EXCEPTION 'Customer MOQ retirement was not installed';
  END IF;
  EXECUTE patched;
END $patch$;

-- Reserve the allocation when the request is submitted. The public signature
-- is unchanged for the previous image.
CREATE OR REPLACE FUNCTION public.axora_initialize_request_approval(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_request_id uuid,
  p_idempotency_key text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; request_row public.requests%ROWTYPE;
  account_row public.budget_accounts%ROWTYPE; period_row public.budget_periods%ROWTYPE;
  policy_row public.request_approval_policies%ROWTYPE; amount numeric(18,2);
  available_amount numeric(18,2); payload jsonb; correlation uuid:=gen_random_uuid();
  decision_id uuid:=gen_random_uuid(); reservation_id uuid:=gen_random_uuid();
  next_state text;
BEGIN
  IF char_length(COALESCE(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'The submission key is invalid';
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO request_row FROM public.requests WHERE id=p_request_id FOR UPDATE;
  IF snapshot IS NULL OR request_row.id IS NULL
    OR request_row.created_by<>p_actor_user_id OR request_row.approval_state<>'DRAFT'
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'request.create',
      CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request_row.company_id,request_row.branch_id,request_row.department_id,NULL
    ) THEN RAISE EXCEPTION 'The request is unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'procurement-category-policy:'||request_row.company_id::text,0
  ));
  IF EXISTS (
    SELECT 1 FROM public.request_lines line
    WHERE line.request_id=request_row.id
      AND NOT public.axora_category_allowed_for_scope(
        request_row.company_id,request_row.branch_id,request_row.department_id,
        line.category_snapshot
      )
  ) THEN RAISE EXCEPTION 'A request category is not permitted'
    USING ERRCODE='P8204'; END IF;
  SELECT * INTO account_row FROM public.budget_accounts account
  WHERE account.id=request_row.budget_account_id
    AND account.company_id=request_row.company_id AND account.active
    AND ((account.level_type='BRANCH' AND account.branch_id=request_row.branch_id)
      OR (account.level_type='DEPARTMENT' AND account.department_id=request_row.department_id)
      OR (account.level_type='COST_CENTRE' AND account.cost_centre_id=request_row.cost_centre_id))
  FOR KEY SHARE;
  SELECT * INTO period_row FROM public.budget_periods period
  WHERE period.id=request_row.budget_period_id
    AND period.budget_account_id=request_row.budget_account_id
    AND period.status='ACTIVE' AND period.starts_at<=p_at AND period.ends_at>p_at
  FOR UPDATE;
  IF account_row.id IS NULL OR period_row.id IS NULL
    OR account_row.currency<>request_row.currency THEN
    RAISE EXCEPTION 'No active budget is available for this purchasing scope'
      USING ERRCODE='P8206';
  END IF;
  SELECT * INTO policy_row FROM public.request_approval_policies policy
  WHERE policy.id=request_row.approval_policy_id
    AND policy.company_id=request_row.company_id
    AND policy.status='ACTIVE' AND policy.effective_at<=p_at FOR KEY SHARE;
  IF policy_row.id IS NULL THEN RAISE EXCEPTION 'The approval policy is unavailable'; END IF;
  amount:=public.axora_request_total_internal(request_row.id);
  SELECT COALESCE(balance.available,0)::numeric(18,2) INTO available_amount
  FROM public.v_budget_period_balances balance
  WHERE balance.budget_period_id=period_row.id;
  IF amount>COALESCE(available_amount,0) THEN
    RAISE EXCEPTION 'The budget is insufficient for this request'
      USING ERRCODE='P8207';
  END IF;
  payload:=public.axora_request_snapshot_payload_internal(
    request_row.id,policy_row.policy_version,amount,request_row.currency
  );
  next_state:=CASE WHEN request_row.department_id IS NULL
    THEN 'PENDING_COMPANY' ELSE 'PENDING_DEPARTMENT' END;
  INSERT INTO public.request_approval_snapshots(
    request_id,request_version,company_id,policy_id,policy_version,amount,currency,
    snapshot,snapshot_hash,created_by,created_at
  ) VALUES (
    request_row.id,request_row.request_version,request_row.company_id,policy_row.id,
    policy_row.policy_version,amount,request_row.currency,payload,
    encode(sha256(convert_to(payload::text,'UTF8')),'hex'),p_actor_user_id,p_at
  );
  INSERT INTO public.budget_reservations(
    id,company_id,budget_account_id,budget_period_id,request_id,request_version,
    currency,reserved_amount,remaining_reserved,status,correlation_id,created_by,
    created_at,updated_at
  ) VALUES (
    reservation_id,request_row.company_id,request_row.budget_account_id,
    request_row.budget_period_id,request_row.id,request_row.request_version,
    request_row.currency,amount,amount,'RESERVED',correlation,p_actor_user_id,p_at,p_at
  );
  INSERT INTO public.budget_reservation_events(
    reservation_id,company_id,event_type,amount,new_status,actor_user_id,reason,
    correlation_id,idempotency_key,occurred_at
  ) VALUES (
    reservation_id,request_row.company_id,'CREATED',amount,'RESERVED',p_actor_user_id,
    'Request submitted and budget reserved.',correlation,
    p_idempotency_key||'-reservation-event',p_at
  );
  IF amount>0 THEN
    PERFORM public.axora_post_budget_entry_internal(
      request_row.company_id,request_row.budget_account_id,request_row.budget_period_id,
      'RESERVATION',amount,0,-amount,amount,0,0,0,0,
      request_row.id,request_row.request_version,reservation_id,NULL,
      'REQUEST',request_row.id,p_actor_user_id,p_actor_role_assignment_id,NULL,
      'REQUEST_SUBMITTED','Request submitted and budget reserved.',correlation,
      'request-submit-'||request_row.id::text||'-v'||request_row.request_version::text,p_at
    );
  END IF;
  UPDATE public.requests SET approval_state=next_state,
    approval_submitted_at=p_at,approval_last_correlation_id=correlation
  WHERE id=request_row.id;
  payload:=jsonb_build_object(
    'decisionId',decision_id,'reservationId',reservation_id,
    'requestId',request_row.id,'requestVersion',request_row.request_version,
    'approvalRevision',request_row.approval_revision,'state',next_state,
    'amount',amount::text,'currency',request_row.currency
  );
  INSERT INTO public.request_approval_decisions(
    id,request_id,request_version,approval_revision_before,approval_revision_after,
    company_id,policy_id,actor_user_id,actor_role_assignment_id,action,
    state_before,state_after,amount,currency,self_approval,reason,correlation_id,
    idempotency_key,result,decided_at
  ) VALUES (
    decision_id,request_row.id,request_row.request_version,request_row.approval_revision,
    request_row.approval_revision,request_row.company_id,policy_row.id,p_actor_user_id,
    p_actor_role_assignment_id,'SUBMIT','DRAFT',next_state,amount,request_row.currency,
    false,'Request submitted for approval.',correlation,p_idempotency_key,payload,p_at
  );
  INSERT INTO public.request_approval_outbox(
    request_id,request_version,approval_revision,company_id,job_type,payload,
    idempotency_key,available_at
  ) VALUES
    (request_row.id,request_row.request_version,request_row.approval_revision,
      request_row.company_id,'APPROVAL_NOTIFICATION',payload,
      p_idempotency_key||'-notify',p_at),
    (request_row.id,request_row.request_version,request_row.approval_revision,
      request_row.company_id,'REQUEST_PDF',payload,
      p_idempotency_key||'-submitted-pdf',p_at);
  RETURN payload;
END $$;

-- Patch the established approval state machine to recognize a reservation
-- already created at submission while retaining compatibility for older
-- pending requests that still carry pending exposure.
DO $patch$
DECLARE definition text; patched text; old_block text; new_block text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_decide_request_approval(uuid,uuid,uuid,integer,text,text,uuid,text,text,timestamptz)'::regprocedure
  ) INTO definition;
  patched:=replace(definition,
    '  reservation_id uuid:=gen_random_uuid();',
    '  reservation_id uuid:=gen_random_uuid();'||E'\n  existing_reservation public.budget_reservations%ROWTYPE;');
  patched:=replace(patched,
    $$  amount:=approval_snapshot.amount;
  limit_amount:=public.axora_approval_limit_for_request($$,
    $$  amount:=approval_snapshot.amount;
  SELECT * INTO existing_reservation FROM public.budget_reservations reservation
  WHERE reservation.request_id=request_row.id
    AND reservation.request_version=request_row.request_version FOR UPDATE;
  IF existing_reservation.id IS NOT NULL THEN reservation_id:=existing_reservation.id; END IF;
  limit_amount:=public.axora_approval_limit_for_request($$);
  patched:=replace(patched,
    'IF next_state IS NULL AND company_exposure+amount>company_ceiling',
    'IF next_state IS NULL AND company_exposure+(CASE WHEN existing_reservation.id IS NULL THEN amount ELSE 0 END)>company_ceiling');
  patched:=replace(patched,
    'shortfall:=greatest(amount-COALESCE(balance_row.available,0),0);',
    $$shortfall:=CASE WHEN existing_reservation.id IS NOT NULL
    THEN greatest(amount-existing_reservation.remaining_reserved,0)
    ELSE greatest(amount-COALESCE(balance_row.available,0),0) END;$$);
  patched:=replace(patched,
    $$  SELECT COALESCE(balance.available,0)::numeric(18,2) INTO shortfall
  FROM public.v_budget_period_balances balance
  WHERE balance.budget_period_id=request_row.budget_period_id;
  IF shortfall<amount THEN RAISE EXCEPTION 'The budget changed before approval completed'; END IF;$$,
    $$  IF existing_reservation.id IS NOT NULL THEN
    IF existing_reservation.status NOT IN ('RESERVED','PARTIALLY_SPENT')
      OR existing_reservation.remaining_reserved<amount THEN
      RAISE EXCEPTION 'The budget changed before approval completed';
    END IF;
  ELSE
    SELECT COALESCE(balance.available,0)::numeric(18,2) INTO shortfall
    FROM public.v_budget_period_balances balance
    WHERE balance.budget_period_id=request_row.budget_period_id;
    IF shortfall<amount THEN RAISE EXCEPTION 'The budget changed before approval completed'; END IF;
  END IF;$$);
  old_block:=$$  INSERT INTO public.budget_reservations(
    id,company_id,budget_account_id,budget_period_id,request_id,request_version,
    currency,reserved_amount,remaining_reserved,status,approval_decision_id,
    correlation_id,created_by,created_at,updated_at
  ) VALUES (
    reservation_id,request_row.company_id,request_row.budget_account_id,
    request_row.budget_period_id,request_row.id,request_row.request_version,
    approval_snapshot.currency,amount,amount,'RESERVED',decision_id,correlation,
    p_actor_user_id,p_at,p_at
  );
  INSERT INTO public.budget_reservation_events(
    reservation_id,company_id,event_type,amount,new_status,actor_user_id,reason,
    correlation_id,idempotency_key,occurred_at
  ) VALUES (
    reservation_id,request_row.company_id,'CREATED',amount,'RESERVED',p_actor_user_id,
    clean_reason,correlation,p_idempotency_key||'-reservation-event',p_at
  );
  PERFORM public.axora_post_budget_entry_internal(
    request_row.company_id,request_row.budget_account_id,request_row.budget_period_id,
    'RESERVATION',amount,0,-amount,amount,0,0,0,0,request_row.id,
    request_row.request_version,reservation_id,NULL,'REQUEST',request_row.id,
    p_actor_user_id,p_actor_role_assignment_id,NULL,'REQUEST_APPROVED',clean_reason,
    correlation,p_idempotency_key||'-reservation',p_at
  );$$;
  new_block:=$$  IF existing_reservation.id IS NULL THEN
    INSERT INTO public.budget_reservations(
      id,company_id,budget_account_id,budget_period_id,request_id,request_version,
      currency,reserved_amount,remaining_reserved,status,approval_decision_id,
      correlation_id,created_by,created_at,updated_at
    ) VALUES (
      reservation_id,request_row.company_id,request_row.budget_account_id,
      request_row.budget_period_id,request_row.id,request_row.request_version,
      approval_snapshot.currency,amount,amount,'RESERVED',decision_id,correlation,
      p_actor_user_id,p_at,p_at
    );
    INSERT INTO public.budget_reservation_events(
      reservation_id,company_id,event_type,amount,new_status,actor_user_id,reason,
      correlation_id,idempotency_key,occurred_at
    ) VALUES (
      reservation_id,request_row.company_id,'CREATED',amount,'RESERVED',p_actor_user_id,
      clean_reason,correlation,p_idempotency_key||'-reservation-event',p_at
    );
    PERFORM public.axora_post_budget_entry_internal(
      request_row.company_id,request_row.budget_account_id,request_row.budget_period_id,
      'RESERVATION',amount,0,-amount,amount,0,0,0,0,request_row.id,
      request_row.request_version,reservation_id,NULL,'REQUEST',request_row.id,
      p_actor_user_id,p_actor_role_assignment_id,NULL,'REQUEST_APPROVED',clean_reason,
      correlation,p_idempotency_key||'-reservation',p_at
    );
  ELSE
    UPDATE public.budget_reservations SET approval_decision_id=decision_id,
      updated_at=p_at WHERE id=existing_reservation.id;
  END IF;$$;
  patched:=replace(patched,old_block,new_block);
  IF definition IS NULL OR patched=definition
    OR position('existing_reservation public.budget_reservations%ROWTYPE' IN patched)=0
    OR position(new_block IN patched)=0
  THEN RAISE EXCEPTION 'Submission reservation approval integration was not installed'; END IF;
  EXECUTE patched;
END $patch$;

-- Permit final self-approval only through the existing explicit
-- request.approve.self permission and its self-specific approval limit.
CREATE OR REPLACE FUNCTION public.axora_request_has_live_reservation(
  p_request_id uuid,p_request_version integer
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.budget_reservations reservation
    WHERE reservation.request_id=p_request_id
      AND reservation.request_version=p_request_version
      AND reservation.status IN ('RESERVED','PARTIALLY_SPENT'))
$$;

CREATE OR REPLACE FUNCTION public.axora_request_reserved_or_available(
  p_request_id uuid,p_request_version integer,p_budget_account_id uuid,
  p_budget_period_id uuid,p_period_available numeric
)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE((SELECT reservation.remaining_reserved
    FROM public.budget_reservations reservation
    WHERE reservation.request_id=p_request_id
      AND reservation.request_version=p_request_version
      AND reservation.budget_account_id=p_budget_account_id
      AND reservation.budget_period_id=p_budget_period_id
      AND reservation.status IN ('RESERVED','PARTIALLY_SPENT')
    LIMIT 1),p_period_available,0)
$$;

CREATE OR REPLACE FUNCTION public.axora_request_unreserved_amount(
  p_request_id uuid,p_request_version integer,p_amount numeric
)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE WHEN public.axora_request_has_live_reservation(
    p_request_id,p_request_version
  ) THEN 0 ELSE p_amount END
$$;

DO $patch$
DECLARE definition text; patched text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_approve_and_pay_internal(uuid,uuid,uuid,integer,text,uuid,timestamptz,boolean)'::regprocedure
  ) INTO definition;
  patched:=replace(definition,
    '  can_override_ceiling boolean; payload_hash_value text;',
    '  can_override_ceiling boolean; payload_hash_value text;'||E'\n  is_self boolean; permission_code text;');
  patched:=replace(patched,
    $$  SELECT public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,
    CASE WHEN p_legacy_checkout THEN 'request.submit' ELSE 'request.approve.other' END,
    p_request_id,p_at
  ) INTO snapshot;$$,
    $$  SELECT request.created_by=p_actor_user_id INTO is_self
  FROM public.requests request WHERE request.id=p_request_id;
  permission_code:=CASE WHEN is_self THEN 'request.approve.self'
    ELSE 'request.approve.other' END;
  SELECT public.axora_lock_request_resource_access(
    p_actor_user_id,p_actor_role_assignment_id,
    CASE WHEN p_legacy_checkout THEN 'request.submit' ELSE permission_code END,
    p_request_id,p_at
  ) INTO snapshot;$$);
  patched:=replace(patched,
    $$    approval_limit_value:=public.axora_approval_limit_for_request(
      snapshot,'request.approve.other',request_row.company_id,
      request_row.branch_id,request_row.department_id,
      approval_snapshot.currency,false
    );$$,
    $$    approval_limit_value:=public.axora_approval_limit_for_request(
      snapshot,permission_code,request_row.company_id,
      request_row.branch_id,request_row.department_id,
      approval_snapshot.currency,is_self
    );$$);
  patched:=replace(patched,
    $$  IF NOT p_legacy_checkout AND (request_row.created_by=p_actor_user_id
    OR approval_limit_value IS NULL OR approval_limit_value<approval_snapshot.amount) THEN$$,
    $$  IF NOT p_legacy_checkout AND (
    is_self IS DISTINCT FROM (request_row.created_by=p_actor_user_id)
    OR approval_limit_value IS NULL OR approval_limit_value<approval_snapshot.amount) THEN$$);
  patched:=replace(patched,
    $$  SELECT * INTO existing_invoice FROM public.invoices invoice$$,
    $$  PERFORM pg_advisory_xact_lock(hashtextextended(
    'procurement-category-policy:'||request_row.company_id::text,0
  ));
  IF NOT p_legacy_checkout AND EXISTS (
    SELECT 1 FROM public.request_lines line
    WHERE line.request_id=request_row.id
      AND NOT public.axora_category_allowed_for_scope(
        request_row.company_id,request_row.branch_id,request_row.department_id,
        line.category_snapshot
      )
  ) THEN
    result_value:=jsonb_build_object(
      'status','NOT_READY','commandId',p_command_id,'requestId',request_row.id,
      'requestState','CATEGORY_POLICY_REVIEW_REQUIRED'
    );
    INSERT INTO public.approve_and_pay_commands(
      command_id,payload_hash,request_id,company_id,actor_user_id,
      actor_role_assignment_id,result,created_at
    ) VALUES (
      p_command_id,payload_hash_value,request_row.id,request_row.company_id,
      p_actor_user_id,p_actor_role_assignment_id,result_value,p_at
    );
    RETURN result_value;
  END IF;
  SELECT * INTO existing_invoice FROM public.invoices invoice$$);
  patched:=replace(patched,
    $$      budget_available:=COALESCE(period_available,0);$$,
    $$      budget_available:=public.axora_request_reserved_or_available(
        request_row.id,request_row.request_version,request_row.budget_account_id,
        request_row.budget_period_id,period_available
      );$$);
  patched:=replace(patched,
    $$COALESCE(company_exposure_value,0)+approval_snapshot.amount
        >company_ceiling_value$$,
    $$COALESCE(company_exposure_value,0)+public.axora_request_unreserved_amount(
        request_row.id,request_row.request_version,approval_snapshot.amount
      ) >company_ceiling_value$$);
  IF definition IS NULL OR patched=definition
    OR position('permission_code text' IN patched)=0
    OR position('CATEGORY_POLICY_REVIEW_REQUIRED' IN patched)=0
    OR position('axora_request_reserved_or_available' IN patched)=0
    OR position('axora_request_unreserved_amount' IN patched)=0
  THEN RAISE EXCEPTION 'Permission-aware Approve & Pay was not installed'; END IF;
  EXECUTE patched;
END $patch$;

-- The existing document type remains stable for previous-image compatibility,
-- while its submitted-state copy accurately identifies a purchase request.
DO $patch$
DECLARE definition text; patched text;
BEGIN
  SELECT pg_get_functiondef(
    'public.axora_build_approved_request_document_snapshot(uuid,timestamptz)'::regprocedure
  ) INTO definition;
  patched:=replace(definition,
    $$'disclaimer', 'Approved estimate. Final quantities and charges may change through the controlled fulfilment workflow.'$$,
    $$'disclaimer',CASE WHEN context.approval_state IN ('APPROVED','AWAITING_FULFILMENT')
      THEN 'Approved estimate. Final quantities and charges may change through the controlled fulfilment workflow.'
      ELSE 'Submitted purchase request. Prices and quantities are the immutable customer-facing submission snapshot.' END$$);
  -- PostgreSQL normalizes the original function without whitespace after commas.
  IF patched=definition THEN
    patched:=replace(definition,
      $$'disclaimer','Approved estimate. Final quantities and charges may change through the controlled fulfilment workflow.'$$,
      $$'disclaimer',CASE WHEN context.approval_state IN ('APPROVED','AWAITING_FULFILMENT')
        THEN 'Approved estimate. Final quantities and charges may change through the controlled fulfilment workflow.'
        ELSE 'Submitted purchase request. Prices and quantities are the immutable customer-facing submission snapshot.' END$$);
  END IF;
  IF definition IS NULL OR patched=definition THEN
    RAISE EXCEPTION 'Submitted purchase request document copy was not installed';
  END IF;
  EXECUTE patched;
END $patch$;

CREATE OR REPLACE FUNCTION public.axora_request_can_approve_and_pay_internal(
  p_snapshot jsonb,p_actor_user_id uuid,p_request_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_row public.requests%ROWTYPE;
  approval_snapshot public.request_approval_snapshots%ROWTYPE;
  approval_limit_value numeric(18,2); available_value numeric(18,2);
  company_exposure_value numeric(18,2); company_ceiling_value numeric(18,2);
  wallet_balance_value numeric(18,2); permission_code text; is_self boolean;
  can_override_ceiling boolean;
BEGIN
  SELECT * INTO request_row FROM public.requests request
  WHERE request.id=p_request_id AND request.approval_state IN (
    'PENDING_DEPARTMENT','PENDING_COMPANY','PENDING_AXORA','APPROVED'
  );
  is_self:=request_row.created_by=p_actor_user_id;
  permission_code:=CASE WHEN is_self THEN 'request.approve.self'
    ELSE 'request.approve.other' END;
  IF p_snapshot IS NULL OR request_row.id IS NULL
    OR NOT public.axora_snapshot_has_permission(
      p_snapshot,permission_code,
      CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request_row.company_id,request_row.branch_id,request_row.department_id,NULL
    )
    OR NOT public.axora_snapshot_has_permission(
      p_snapshot,'finance.invoice.view',
      CASE WHEN request_row.department_id IS NULL THEN 'BRANCH' ELSE 'DEPARTMENT' END,
      request_row.company_id,request_row.branch_id,request_row.department_id,NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.request_lines line WHERE line.request_id=request_row.id
        AND NOT public.axora_category_allowed_for_scope(
          request_row.company_id,request_row.branch_id,request_row.department_id,
          line.category_snapshot
        )
    )
  THEN RETURN false; END IF;
  SELECT * INTO approval_snapshot FROM public.request_approval_snapshots item
  WHERE item.request_id=request_row.id
    AND item.request_version=request_row.request_version;
  IF approval_snapshot.id IS NULL THEN RETURN false; END IF;
  approval_limit_value:=public.axora_approval_limit_for_request(
    p_snapshot,permission_code,request_row.company_id,
    request_row.branch_id,request_row.department_id,
    approval_snapshot.currency,is_self
  );
  SELECT reservation.remaining_reserved INTO available_value
  FROM public.budget_reservations reservation
  WHERE reservation.request_id=request_row.id
    AND reservation.request_version=request_row.request_version
    AND reservation.status IN ('RESERVED','PARTIALLY_SPENT');
  SELECT company.contractual_ceiling INTO company_ceiling_value
  FROM public.companies company WHERE company.id=request_row.company_id AND company.active;
  SELECT COALESCE(sum(balance.reserved+balance.spent),0)::numeric(18,2)
  INTO company_exposure_value
  FROM public.v_budget_period_balances balance
  JOIN public.budget_periods period ON period.id=balance.budget_period_id
    AND period.status='ACTIVE'
  WHERE balance.company_id=request_row.company_id;
  SELECT COALESCE(balance.available_balance,0)::numeric(18,2)
  INTO wallet_balance_value FROM public.v_company_wallet_balances balance
  WHERE balance.company_id=request_row.company_id;
  can_override_ceiling:=public.axora_snapshot_has_permission(
    p_snapshot,'commercial.company_ceiling.override','COMPANY',
    request_row.company_id,NULL,NULL,NULL
  );
  RETURN approval_limit_value IS NOT NULL
    AND approval_limit_value>=approval_snapshot.amount
    AND COALESCE(available_value,0)>=approval_snapshot.amount
    AND COALESCE(wallet_balance_value,0)>=approval_snapshot.amount
    AND (COALESCE(company_exposure_value,0)<=company_ceiling_value
      OR can_override_ceiling);
END $$;

REVOKE ALL ON FUNCTION public.axora_category_allowed_for_scope(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_customer_quantity_is_valid(numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_request_has_live_reservation(uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_request_reserved_or_available(uuid,integer,uuid,uuid,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_request_unreserved_amount(uuid,integer,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_procurement_scope_authorized(jsonb,text,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_catalog_purchasing_scope(uuid,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_category_policy_parent_allows(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_category_policy_workspace(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_set_category_policy(uuid,uuid,text,uuid,uuid,uuid,boolean,text[],integer,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_procurement_cart_snapshot_internal(uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_procurement_cart_command(uuid,uuid,uuid,text,text,integer,text,integer,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_lock_procurement_cart_for_submission(uuid,uuid,uuid,integer,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_consume_procurement_cart(uuid,uuid,uuid,integer,uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_cart_matches_request_snapshot(uuid,uuid,uuid,uuid,timestamptz) FROM PUBLIC;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
  REVOKE ALL ON TABLE
    public.procurement_category_policies,
    public.procurement_category_policy_categories,
    public.procurement_carts,public.procurement_cart_items,
    public.procurement_cart_events
  FROM axora_app;
  GRANT EXECUTE ON FUNCTION
    public.axora_catalog_purchasing_scope(uuid,uuid,uuid,timestamptz),
    public.axora_category_policy_workspace(uuid,uuid,timestamptz),
    public.axora_set_category_policy(uuid,uuid,text,uuid,uuid,uuid,boolean,text[],integer,text,uuid,timestamptz),
    public.axora_procurement_cart_command(uuid,uuid,uuid,text,text,integer,text,integer,uuid,timestamptz),
    public.axora_lock_procurement_cart_for_submission(uuid,uuid,uuid,integer,timestamptz),
    public.axora_consume_procurement_cart(uuid,uuid,uuid,integer,uuid,uuid,timestamptz),
    public.axora_cart_matches_request_snapshot(uuid,uuid,uuid,uuid,timestamptz)
  TO axora_app;
END IF; END $$;

COMMIT;
