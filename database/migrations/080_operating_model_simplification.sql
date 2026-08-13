BEGIN;

-- Historical sourcing, supplier, quotation, invoice and audit rows remain
-- immutable. These permissions are retired only for new effective access.
UPDATE public.permissions
SET active=false,updated_at=now()
WHERE permission_code IN (
  'supplier.manage','sourcing.manage','finance.match.review',
  'document.dispatch.supplier'
);

INSERT INTO public.roles(role_key,label,description) VALUES
  ('HUMAN_RESOURCES_MANAGEMENT','Human Resources Management',
   'Assigns company leads to eligible Agents and monitors onboarding'),
  ('DELIVERY_GUY','Delivery Guy',
   'Buys requested items and completes explicitly assigned deliveries')
ON CONFLICT(role_key) DO UPDATE SET
  label=EXCLUDED.label,description=EXCLUDED.description;

WITH defaults(role_key,permission_code) AS (VALUES
  ('HUMAN_RESOURCES_MANAGEMENT','dashboard.view'),
  ('HUMAN_RESOURCES_MANAGEMENT','platform.view'),
  ('HUMAN_RESOURCES_MANAGEMENT','company.view.all'),
  ('HUMAN_RESOURCES_MANAGEMENT','company.lead.view'),
  ('HUMAN_RESOURCES_MANAGEMENT','company.lead.assign'),
  ('HUMAN_RESOURCES_MANAGEMENT','company.lead.reassign'),
  ('CLIENT_ACCOUNT_MANAGER','company.lead.view'),
  ('CLIENT_ACCOUNT_MANAGER','company.lead.create'),
  ('CLIENT_ACCOUNT_MANAGER','company.lead.assign'),
  ('COMPANY_ADMIN','receiving.view'),
  ('COMPANY_ADMIN','receiving.confirm'),
  ('BRANCH_ADMIN','receiving.view'),
  ('BRANCH_ADMIN','receiving.confirm'),
  ('DELIVERY_GUY','dashboard.view'),
  ('DELIVERY_GUY','delivery.portal.view'),
  ('DELIVERY_GUY','delivery.assignment.update')
)
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM defaults
JOIN public.roles role ON role.role_key=defaults.role_key
JOIN public.permissions permission
  ON permission.permission_code=defaults.permission_code AND permission.active
ON CONFLICT DO NOTHING;

DELETE FROM public.role_permissions role_permission
USING public.roles role,public.permissions permission
WHERE role_permission.role_id=role.id
  AND role_permission.permission_id=permission.id
  AND (
    (role.role_key='PLATFORM_OWNER'
      AND permission.permission_code IN ('company.lead.assign','company.lead.reassign'))
    OR (role.role_key='CLIENT_ACCOUNT_MANAGER'
      AND permission.permission_code='company.lead.reassign')
  );

-- New requests bypass the retired quotation/supplier-selection states. Keep
-- outbound legacy transitions so historical requests can still be completed.
DELETE FROM public.request_status_transitions transition
USING public.lookup_values source,public.lookup_values target
WHERE transition.from_status_id=source.id
  AND transition.to_status_id=target.id
  AND (
    (source.label='Under Verification'
      AND target.label IN ('Waiting for Quotation','Waiting for Approval'))
    OR (source.label='Approved' AND target.label='Supplier Assigned')
  );
INSERT INTO public.request_status_transitions(
  from_status_id,to_status_id,reason_required
) VALUES
  (public.lookup_id('request_status','Under Verification'),
   public.lookup_id('request_status','Approved'),false),
  (public.lookup_id('request_status','Approved'),
   public.lookup_id('request_status','Preparing for Delivery'),false)
ON CONFLICT(from_status_id,to_status_id)
DO UPDATE SET reason_required=EXCLUDED.reason_required;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT catalog_constraint.conname INTO constraint_name
  FROM pg_constraint catalog_constraint
  WHERE catalog_constraint.conrelid='public.company_leads'::regclass
    AND catalog_constraint.contype='c'
    AND pg_get_constraintdef(catalog_constraint.oid) LIKE '%INFORMATION_PENDING%'
    AND pg_get_constraintdef(catalog_constraint.oid) LIKE '%QUALIFIED%'
    AND pg_get_constraintdef(catalog_constraint.oid) LIKE '%ARCHIVED%'
  ORDER BY catalog_constraint.oid
  LIMIT 1;
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'Company lead status constraint is unavailable';
  END IF;
  EXECUTE format('ALTER TABLE public.company_leads DROP CONSTRAINT %I',constraint_name);
END $$;
ALTER TABLE public.company_leads
  ADD CONSTRAINT company_leads_operating_status_check CHECK (status IN (
    'NEW','ASSIGNED','CONTACTED','INFORMATION_PENDING','QUALIFIED',
    'ONBOARDING','ACTIVE','CONVERTED','DUPLICATE','REJECTED','ARCHIVED'
  ));

CREATE OR REPLACE FUNCTION public.axora_company_lead_manager_is_valid(
  p_user_id uuid,p_at timestamptz
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users account
    JOIN public.role_assignments assignment
      ON assignment.user_id=account.id AND assignment.active
      AND assignment.revoked_at IS NULL
      AND assignment.assigned_at<=p_at
    JOIN public.roles role ON role.id=assignment.role_id
    WHERE account.id=p_user_id AND account.active
      AND account.account_status='ACTIVE'
      AND account.account_kind='PLATFORM'
      AND account.account_setup_completed_at IS NOT NULL
      AND role.role_key='CLIENT_ACCOUNT_MANAGER'
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_actor_can_view(
  p_snapshot jsonb,p_actor_user_id uuid,p_lead_id uuid,p_at timestamptz
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.axora_company_actor_is_owner(p_snapshot)
    OR (
      p_snapshot->>'roleKey'='HUMAN_RESOURCES_MANAGEMENT'
      AND public.axora_company_snapshot_role_permission(
        p_snapshot,'company.lead.view'
      )
    )
    OR (
      p_snapshot->>'roleKey'='CLIENT_ACCOUNT_MANAGER'
      AND public.axora_company_snapshot_role_permission(
        p_snapshot,'company.lead.view'
      )
      AND EXISTS (
        SELECT 1 FROM public.company_lead_assignments assignment
        WHERE assignment.lead_id=p_lead_id AND assignment.status='ACTIVE'
          AND assignment.manager_user_id=p_actor_user_id
          AND assignment.assigned_at<=p_at
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.axora_company_lead_recipient_ids(
  p_lead_id uuid,p_include_owners boolean DEFAULT true
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(jsonb_agg(recipient.id ORDER BY recipient.id),'[]'::jsonb)
  FROM (
    SELECT DISTINCT account.id
    FROM public.users account
    LEFT JOIN public.role_assignments assignment
      ON assignment.user_id=account.id AND assignment.active
      AND assignment.revoked_at IS NULL
    LEFT JOIN public.roles role ON role.id=assignment.role_id
    WHERE account.active AND account.account_status='ACTIVE'
      AND (
        (p_include_owners AND (
          account.is_owner OR role.role_key='HUMAN_RESOURCES_MANAGEMENT'
        ))
        OR (
          role.role_key='CLIENT_ACCOUNT_MANAGER'
          AND EXISTS (
            SELECT 1 FROM public.company_lead_assignments lead_assignment
            WHERE lead_assignment.lead_id=p_lead_id
              AND lead_assignment.status='ACTIVE'
              AND lead_assignment.manager_user_id=account.id
          )
        )
      )
  ) recipient
$$;

CREATE OR REPLACE FUNCTION public.axora_apply_company_lead_status(
  p_lead_id uuid,p_to_status text,p_actor_user_id uuid,p_reason text,
  p_at timestamptz,p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE from_status text; next_version integer;
BEGIN
  SELECT status,status_version+1 INTO from_status,next_version
  FROM public.company_leads WHERE id=p_lead_id FOR UPDATE;
  IF from_status IS NULL OR p_to_status NOT IN (
      'NEW','ASSIGNED','CONTACTED','INFORMATION_PENDING','QUALIFIED',
      'ONBOARDING','ACTIVE','CONVERTED','DUPLICATE','REJECTED','ARCHIVED'
    ) OR NOT (
      (from_status='NEW' AND p_to_status IN ('ASSIGNED','DUPLICATE','REJECTED'))
      OR (from_status='ASSIGNED' AND p_to_status IN ('CONTACTED','DUPLICATE','REJECTED'))
      OR (from_status='CONTACTED' AND p_to_status IN (
        'INFORMATION_PENDING','QUALIFIED','DUPLICATE','REJECTED'
      ))
      OR (from_status='INFORMATION_PENDING' AND p_to_status IN (
        'CONTACTED','QUALIFIED','DUPLICATE','REJECTED'
      ))
      OR (from_status='QUALIFIED' AND p_to_status IN (
        'INFORMATION_PENDING','ONBOARDING','DUPLICATE','REJECTED'
      ))
      OR (from_status='ONBOARDING' AND p_to_status='ACTIVE')
      OR (from_status IN ('ACTIVE','CONVERTED','DUPLICATE','REJECTED')
        AND p_to_status='ARCHIVED')
    ) THEN RAISE EXCEPTION 'Company lead transition is unavailable'; END IF;
  UPDATE public.company_leads
  SET status=p_to_status,status_version=next_version,updated_at=p_at,
    first_contacted_at=CASE WHEN p_to_status='CONTACTED'
      THEN COALESCE(first_contacted_at,p_at) ELSE first_contacted_at END,
    first_contacted_by=CASE WHEN p_to_status='CONTACTED'
      THEN COALESCE(first_contacted_by,p_actor_user_id)
      ELSE first_contacted_by END
  WHERE id=p_lead_id;
  INSERT INTO public.company_lead_status_history(
    lead_id,status_version,from_status,to_status,reason,changed_by,changed_at,metadata
  ) VALUES (p_lead_id,next_version,from_status,p_to_status,btrim(p_reason),
    p_actor_user_id,p_at,COALESCE(p_metadata,'{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.axora_assign_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_manager_user_id uuid,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb;
  current_assignment public.company_lead_assignments%ROWTYPE;
  lead_status text; event jsonb; event_key text;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT status INTO lead_status FROM public.company_leads
  WHERE id=p_lead_id FOR UPDATE;
  IF snapshot IS NULL
    OR snapshot->>'roleKey'<>'HUMAN_RESOURCES_MANAGEMENT'
    OR lead_status IS NULL
    OR lead_status IN ('ACTIVE','CONVERTED','DUPLICATE','REJECTED','ARCHIVED')
    OR NOT public.axora_company_snapshot_role_permission(snapshot,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.company_lead_assignments
        WHERE lead_id=p_lead_id AND status='ACTIVE'
      ) THEN 'company.lead.reassign' ELSE 'company.lead.assign' END)
    OR NOT public.axora_company_lead_manager_is_valid(p_manager_user_id,p_at)
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
  THEN RAISE EXCEPTION 'Company lead assignment is unavailable'; END IF;
  SELECT * INTO current_assignment FROM public.company_lead_assignments
  WHERE lead_id=p_lead_id AND status='ACTIVE' FOR UPDATE;
  IF current_assignment.manager_user_id=p_manager_user_id THEN
    RAISE EXCEPTION 'Company lead is already assigned to this Agent';
  END IF;
  IF current_assignment.id IS NOT NULL THEN
    UPDATE public.company_lead_assignments
    SET status='ENDED',ended_by=p_actor_user_id,ended_at=p_at,
      end_reason='Reassigned: '||btrim(p_reason)
    WHERE id=current_assignment.id;
    event_key:='company.lead.reassigned';
  ELSE event_key:='company.lead.assigned'; END IF;
  INSERT INTO public.company_lead_assignments(
    lead_id,manager_user_id,assigned_by,assigned_at,assignment_reason
  ) VALUES (p_lead_id,p_manager_user_id,p_actor_user_id,p_at,btrim(p_reason));
  IF lead_status='NEW' THEN
    PERFORM public.axora_apply_company_lead_status(
      p_lead_id,'ASSIGNED',p_actor_user_id,'Lead assigned to Agent',p_at,
      jsonb_build_object('managerUserId',p_manager_user_id)
    );
  END IF;
  event:=public.axora_append_company_lead_event(
    p_lead_id,event_key,
    event_key||':'||p_manager_user_id::text||':'
      ||extract(epoch FROM p_at)::bigint::text,
    p_actor_user_id,jsonb_build_object('managerUserId',p_manager_user_id),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

CREATE OR REPLACE FUNCTION public.axora_transition_company_lead(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_lead_id uuid,
  p_to_status text,p_reason text,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; event jsonb; event_key text; version integer;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR snapshot->>'roleKey'<>'CLIENT_ACCOUNT_MANAGER'
    OR NOT public.axora_company_lead_actor_can_view(
      snapshot,p_actor_user_id,p_lead_id,p_at
    )
    OR p_to_status NOT IN (
      'CONTACTED','INFORMATION_PENDING','QUALIFIED','ACTIVE','REJECTED','ARCHIVED'
    )
    OR char_length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 3 AND 1000
    OR (p_to_status='ACTIVE' AND NOT EXISTS (
      SELECT 1 FROM public.company_leads lead
      JOIN public.companies company ON company.id=lead.converted_company_id
      WHERE lead.id=p_lead_id AND lead.status='ONBOARDING'
        AND company.status_id=public.lookup_id('master_status','Active')
    ))
  THEN RAISE EXCEPTION 'Company lead transition is unavailable'; END IF;
  PERFORM set_config('axora.user_id',p_actor_user_id::text,true);
  PERFORM set_config('axora.change_reason','Company lead status changed',true);
  PERFORM public.axora_apply_company_lead_status(
    p_lead_id,p_to_status,p_actor_user_id,p_reason,p_at
  );
  SELECT status_version INTO version FROM public.company_leads WHERE id=p_lead_id;
  event_key:=CASE p_to_status
    WHEN 'CONTACTED' THEN 'company.lead.contacted'
    WHEN 'INFORMATION_PENDING' THEN 'company.lead.information_requested'
    WHEN 'QUALIFIED' THEN 'company.lead.qualified'
    WHEN 'ACTIVE' THEN 'company.lead.activated'
    WHEN 'REJECTED' THEN 'company.lead.rejected'
    WHEN 'ARCHIVED' THEN 'company.lead.archived'
    ELSE 'company.lead.status_changed' END;
  event:=public.axora_append_company_lead_event(
    p_lead_id,event_key,'status:'||version::text,p_actor_user_id,
    jsonb_build_object('status',p_to_status),p_at
  );
  RETURN public.axora_company_lead_mutation_payload(p_lead_id,event);
END $$;

-- HR owns assignment and reassignment. Agents retain only the narrow initial
-- self-claim used when converting their already assigned lead into a company.
DO $$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(procedure.oid) INTO definition
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public'
    AND procedure.proname='axora_company_lifecycle_workspace';
  revised:=replace(
    definition,
    'can_manage_assignments:=public.axora_company_actor_is_owner(actor_snapshot)
    OR public.axora_company_snapshot_role_permission(
      actor_snapshot,''company.lead.assign''
    );',
    'can_manage_assignments:=actor_snapshot->>''roleKey''=''HUMAN_RESOURCES_MANAGEMENT''
    AND public.axora_company_snapshot_role_permission(
      actor_snapshot,''company.lead.assign''
    );'
  );
  IF definition IS NULL OR revised=definition THEN
    RAISE EXCEPTION 'Company lifecycle assignment workspace source is unavailable';
  END IF;
  EXECUTE revised;

  SELECT pg_get_functiondef(procedure.oid) INTO definition
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public'
    AND procedure.proname='axora_manage_company_assignment';
  revised:=replace(
    definition,
    'required_permission:=CASE WHEN former_manager_id IS NULL
    THEN ''company.lead.assign'' ELSE ''company.lead.reassign'' END;',
    'IF actor_snapshot->>''roleKey''<>''HUMAN_RESOURCES_MANAGEMENT'' AND NOT (
    actor_snapshot->>''roleKey''=''CLIENT_ACCOUNT_MANAGER''
    AND p_allow_lead_self_claim AND p_assignment_type=''PRIMARY''
    AND former_manager_id IS NULL AND company_row.created_by=p_actor_user_id
    AND p_manager_user_id=p_actor_user_id
  ) THEN RAISE EXCEPTION ''The company assignment is unavailable''; END IF;

  required_permission:=CASE WHEN former_manager_id IS NULL
    THEN ''company.lead.assign'' ELSE ''company.lead.reassign'' END;'
  );
  IF definition IS NULL OR revised=definition THEN
    RAISE EXCEPTION 'Company assignment capability source is unavailable';
  END IF;
  EXECUTE revised;
END $$;

-- Preserve the reviewed conversion implementation and change only the final
-- lead lifecycle marker. The company-creator assignment trigger remains the
-- authoritative company-to-Agent relationship.
DO $$
DECLARE definition text; revised text;
BEGIN
  SELECT pg_get_functiondef(procedure.oid) INTO definition
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
  WHERE namespace.nspname='public'
    AND procedure.proname='axora_convert_company_lead';
  revised:=replace(
    definition,
    'p_lead_id,''CONVERTED'',p_actor_user_id,p_reason,p_at',
    'p_lead_id,''ONBOARDING'',p_actor_user_id,p_reason,p_at'
  );
  revised:=replace(
    revised,
    '''Cash on delivery (COD)''',
    '''Standard billing terms'''
  );
  IF definition IS NULL OR revised=definition OR revised LIKE '%Cash on delivery%' THEN
    RAISE EXCEPTION 'Company lead conversion transition source is unavailable';
  END IF;
  EXECUTE revised;
END $$;

CREATE OR REPLACE FUNCTION public.axora_require_paid_delivery_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.invoices invoice
    JOIN public.payments payment ON payment.invoice_id=invoice.id
    WHERE invoice.request_id=NEW.request_id
      AND invoice.lifecycle_status='FINALIZED'
      AND payment.payment_status='PAID'
  ) THEN
    RAISE EXCEPTION 'Delivery assignment requires a paid finalized invoice';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS delivery_jobs_paid_request_guard ON public.delivery_jobs;
CREATE TRIGGER delivery_jobs_paid_request_guard
BEFORE INSERT ON public.delivery_jobs
FOR EACH ROW EXECUTE FUNCTION public.axora_require_paid_delivery_job();

-- The active administration contract omits retired quantity-rule and supplier
-- selection fields while historical tables remain available as evidence.
CREATE OR REPLACE FUNCTION public.axora_product_administration_catalog(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE snapshot jsonb; payload jsonb;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  IF snapshot IS NULL OR NOT public.axora_snapshot_has_permission(
    snapshot,'catalog.manage','PLATFORM',NULL,NULL,NULL,NULL
  ) THEN
    RAISE EXCEPTION 'Product catalog is unavailable';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',product.id::text,
    'companyId',product.company_id::text,
    'companyName',company.name,
    'code',product.product_code,
    'name',product.name,
    'category',product.category,
    'subcategory',product.subcategory,
    'brand',product.brand,
    'size',product.product_size,
    'unit',product.unit_of_measure,
    'packaging',product.packaging,
    'description',product.description,
    'defaultBuyPrice',offer.base_cost,
    'defaultSellPrice',offer.selling_price,
    'priceRuleVersion',offer.pricing_rule_version,
    'priceEffectiveFrom',offer.price_effective_from,
    'priceChangedAt',offer.price_changed_at,
    'priceCurrency',offer.price_currency,
    'deliverySlaDays',product.delivery_sla_days,
    'hasImage',(product.image_content IS NOT NULL),
    'imageAltText',product.image_alt_text,
    'status',CASE WHEN product.needs_review THEN 'Needs Review'
      WHEN product.active THEN 'Active' ELSE 'Inactive' END,
    'duplicateWarning',(SELECT count(*)>1 FROM public.products duplicate
      WHERE lower(btrim(duplicate.name))=lower(btrim(product.name)))
  ) ORDER BY product.name),'[]'::jsonb)
  INTO payload
  FROM public.products product
  LEFT JOIN public.companies company ON company.id=product.company_id
  CROSS JOIN LATERAL public.axora_current_product_offer_internal(
    product.id,p_at
  ) offer;

  INSERT INTO public.audit_logs(entity_type,record_id,action,actor_id,reason)
  VALUES ('product_catalog',p_actor_user_id,'VIEW',p_actor_user_id,
    'Viewed platform product administration catalog');
  RETURN payload;
END $$;

REVOKE ALL ON FUNCTION public.axora_product_administration_catalog(
  uuid,uuid,timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  public.axora_company_lead_manager_is_valid(uuid,timestamptz),
  public.axora_company_lead_actor_can_view(jsonb,uuid,uuid,timestamptz),
  public.axora_company_lead_recipient_ids(uuid,boolean),
  public.axora_apply_company_lead_status(uuid,text,uuid,text,timestamptz,jsonb),
  public.axora_assign_company_lead(uuid,uuid,uuid,uuid,text,timestamptz),
  public.axora_transition_company_lead(uuid,uuid,uuid,text,text,timestamptz),
  public.axora_require_paid_delivery_job()
FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION
      public.axora_product_administration_catalog(uuid,uuid,timestamptz),
      public.axora_assign_company_lead(uuid,uuid,uuid,uuid,text,timestamptz),
      public.axora_transition_company_lead(uuid,uuid,uuid,text,text,timestamptz)
    TO axora_app;
  END IF;
END $$;

COMMIT;
