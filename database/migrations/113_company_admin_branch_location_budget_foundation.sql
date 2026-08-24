BEGIN;

-- Provider provenance is additive and nullable for historical locations and
-- previous-image compatibility. Coordinates remain the canonical destination.
ALTER TABLE public.delivery_locations
  ADD COLUMN geocoder_provider_id text,
  ADD COLUMN geocoder_place_id text,
  ADD COLUMN geocoder_attribution text,
  ADD CONSTRAINT delivery_locations_geocoder_provider_check CHECK (
    geocoder_provider_id IS NULL OR char_length(btrim(geocoder_provider_id)) BETWEEN 2 AND 100
  ),
  ADD CONSTRAINT delivery_locations_geocoder_place_check CHECK (
    geocoder_place_id IS NULL OR char_length(btrim(geocoder_place_id))<=500
  ),
  ADD CONSTRAINT delivery_locations_geocoder_attribution_check CHECK (
    geocoder_attribution IS NULL OR char_length(btrim(geocoder_attribution))<=1000
  );

CREATE TABLE public.branch_delivery_location_provider_evidence (
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.delivery_locations(id) ON DELETE CASCADE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  provider_id text NOT NULL CHECK (char_length(btrim(provider_id)) BETWEEN 2 AND 100),
  provider_place_id text CHECK (char_length(btrim(COALESCE(provider_place_id,'')))<=500),
  provider_attribution text CHECK (char_length(btrim(COALESCE(provider_attribution,'')))<=1000),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(actor_user_id,command_id)
);
ALTER TABLE public.branch_delivery_location_provider_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_delivery_location_provider_evidence FORCE ROW LEVEL SECURITY;
CREATE TRIGGER branch_delivery_location_provider_evidence_append_only
BEFORE UPDATE OR DELETE ON public.branch_delivery_location_provider_evidence
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION public.axora_branch_delivery_location_workspace(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE; location_row record;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO branch_row FROM public.branches branch WHERE branch.id=p_branch_id AND branch.active;
  IF snapshot IS NULL OR branch_row.id IS NULL OR NOT public.axora_organization_permission_at(
    snapshot,'organization.branch.view',branch_row.company_id,branch_row.id,NULL
  ) THEN RETURN NULL; END IF;
  SELECT location.* INTO location_row FROM public.delivery_locations location
  WHERE location.branch_id=branch_row.id AND location.active AND location.is_primary
  ORDER BY location.created_at,location.id LIMIT 1;
  RETURN jsonb_build_object(
    'capturedAt',p_at,'companyId',branch_row.company_id,'branchId',branch_row.id,
    'branchName',branch_row.name,'canManage',public.axora_organization_permission_at(
      snapshot,'organization.delivery_location.manage',branch_row.company_id,branch_row.id,NULL
    ),
    'location',CASE WHEN location_row.id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
      'id',location_row.id,'addressLabel',location_row.address,'latitude',location_row.latitude::text,
      'longitude',location_row.longitude::text,'instructions',location_row.delivery_instructions,
      'providerId',location_row.geocoder_provider_id,'providerPlaceId',location_row.geocoder_place_id,
      'providerAttribution',location_row.geocoder_attribution,'updatedAt',location_row.updated_at
    )) END
  );
END $$;

CREATE OR REPLACE FUNCTION public.axora_save_branch_delivery_location_v2(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_address_label text,p_latitude numeric,p_longitude numeric,p_instructions text,
  p_reason text,p_command_id uuid,p_at timestamptz,p_provider_id text,
  p_provider_place_id text,p_provider_attribution text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE base_result jsonb; command_row public.branch_delivery_location_commands%ROWTYPE;
  evidence_row public.branch_delivery_location_provider_evidence%ROWTYPE;
  provider_hash text; previous_snapshot jsonb; previous_branch_snapshot jsonb;
  result_value jsonb;
BEGIN
  IF char_length(btrim(COALESCE(p_provider_id,''))) NOT BETWEEN 2 AND 100
    OR char_length(btrim(COALESCE(p_provider_place_id,'')))>500
    OR char_length(btrim(COALESCE(p_provider_attribution,'')))>1000
  THEN RAISE EXCEPTION 'The branch delivery location provider is invalid'; END IF;
  provider_hash:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'providerId',btrim(p_provider_id),'providerPlaceId',NULLIF(btrim(COALESCE(p_provider_place_id,'')),''),
    'providerAttribution',NULLIF(btrim(COALESCE(p_provider_attribution,'')),'')
  )::text,'UTF8')),'hex');
  SELECT * INTO evidence_row FROM public.branch_delivery_location_provider_evidence evidence
  WHERE evidence.actor_user_id=p_actor_user_id AND evidence.command_id=p_command_id FOR UPDATE;
  IF evidence_row.command_id IS NOT NULL THEN
    IF evidence_row.branch_id IS DISTINCT FROM p_branch_id OR evidence_row.payload_hash IS DISTINCT FROM provider_hash
    THEN RAISE EXCEPTION 'The branch delivery location provider command is unavailable'; END IF;
    RETURN public.axora_branch_delivery_location_workspace(
      p_actor_user_id,p_actor_role_assignment_id,p_branch_id,p_at
    )||jsonb_build_object('commandId',p_command_id);
  END IF;
  base_result:=public.axora_save_branch_delivery_location(
    p_actor_user_id,p_actor_role_assignment_id,p_branch_id,p_address_label,p_latitude,
    p_longitude,p_instructions,p_reason,p_command_id,p_at
  );
  SELECT * INTO command_row FROM public.branch_delivery_location_commands command
  WHERE command.actor_user_id=p_actor_user_id AND command.command_id=p_command_id FOR UPDATE;
  IF command_row.command_id IS NULL THEN RAISE EXCEPTION 'The branch delivery location command is unavailable'; END IF;
  SELECT to_jsonb(branch) INTO previous_branch_snapshot FROM public.branches branch
  WHERE branch.id=p_branch_id AND branch.company_id=command_row.company_id FOR UPDATE;
  UPDATE public.branches SET delivery_address=btrim(p_address_label),
    delivery_instructions=NULLIF(btrim(COALESCE(p_instructions,'')),''),updated_at=p_at
  WHERE id=p_branch_id AND company_id=command_row.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The branch delivery location command is unavailable'; END IF;
  SELECT to_jsonb(location) INTO previous_snapshot FROM public.delivery_locations location
  WHERE location.id=command_row.location_id FOR UPDATE;
  UPDATE public.delivery_locations SET geocoder_provider_id=btrim(p_provider_id),
    geocoder_place_id=NULLIF(btrim(COALESCE(p_provider_place_id,'')),''),
    geocoder_attribution=NULLIF(btrim(COALESCE(p_provider_attribution,'')),''),updated_at=p_at
  WHERE id=command_row.location_id AND branch_id=p_branch_id AND company_id=command_row.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'The branch delivery location command is unavailable'; END IF;
  INSERT INTO public.branch_delivery_location_provider_evidence(
    actor_user_id,command_id,company_id,branch_id,location_id,payload_hash,provider_id,
    provider_place_id,provider_attribution,created_at
  ) VALUES (
    p_actor_user_id,p_command_id,command_row.company_id,p_branch_id,command_row.location_id,
    provider_hash,btrim(p_provider_id),NULLIF(btrim(COALESCE(p_provider_place_id,'')),''),
    NULLIF(btrim(COALESCE(p_provider_attribution,'')),''),p_at
  );
  INSERT INTO public.organization_structure_history(
    company_id,node_type,node_id,change_type,previous_snapshot,new_snapshot,reason,changed_by,changed_at
  ) VALUES (
    command_row.company_id,'DELIVERY_LOCATION',command_row.location_id,'UPDATED',previous_snapshot,
    (SELECT to_jsonb(location) FROM public.delivery_locations location WHERE location.id=command_row.location_id),
    'GEOCODER_PROVIDER_RECORDED',p_actor_user_id,p_at
  );
  INSERT INTO public.organization_structure_history(
    company_id,node_type,node_id,change_type,previous_snapshot,new_snapshot,reason,changed_by,changed_at
  ) VALUES (
    command_row.company_id,'BRANCH',p_branch_id,'UPDATED',previous_branch_snapshot,
    (SELECT to_jsonb(branch) FROM public.branches branch WHERE branch.id=p_branch_id),
    'CANONICAL_DELIVERY_LOCATION_SYNCHRONIZED',p_actor_user_id,p_at
  );
  result_value:=public.axora_branch_delivery_location_workspace(
    p_actor_user_id,p_actor_role_assignment_id,p_branch_id,p_at
  )||jsonb_build_object('commandId',p_command_id);
  RETURN result_value;
END $$;

CREATE TABLE public.branch_creation_commands (
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(actor_user_id,command_id)
);
ALTER TABLE public.branch_creation_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_creation_commands FORCE ROW LEVEL SECURITY;
CREATE TRIGGER branch_creation_commands_append_only BEFORE UPDATE OR DELETE ON public.branch_creation_commands
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE TABLE public.branch_details_commands (
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(actor_user_id,command_id)
);
ALTER TABLE public.branch_details_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_details_commands FORCE ROW LEVEL SECURITY;
CREATE TRIGGER branch_details_commands_append_only BEFORE UPDATE OR DELETE ON public.branch_details_commands
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION public.axora_create_branch_with_primary_location(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_input jsonb,
  p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_variable
DECLARE snapshot jsonb; company_row public.companies%ROWTYPE; branch_id_value uuid:=gen_random_uuid();
  existing public.branch_creation_commands%ROWTYPE; payload_hash_value text; result_value jsonb;
  company_id_value uuid; latitude_value numeric; longitude_value numeric;
BEGIN
  BEGIN
    company_id_value:=(p_input->>'companyId')::uuid;
    latitude_value:=(p_input->>'latitude')::numeric;
    longitude_value:=(p_input->>'longitude')::numeric;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'The branch creation command is invalid'; END;
  IF p_command_id IS NULL OR jsonb_typeof(p_input)<>'object'
    OR char_length(btrim(COALESCE(p_input->>'name',''))) NOT BETWEEN 2 AND 300
    OR COALESCE(p_input->>'branchCode','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,49}$'
    OR char_length(btrim(COALESCE(p_input->>'city',''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_input->>'addressLabel',''))) NOT BETWEEN 3 AND 5000
    OR latitude_value NOT BETWEEN -90 AND 90 OR longitude_value NOT BETWEEN -180 AND 180
    OR char_length(btrim(COALESCE(p_input->>'contactName',''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_input->>'contactPhone',''))) NOT BETWEEN 5 AND 120
    OR char_length(btrim(COALESCE(p_input->>'providerId',''))) NOT BETWEEN 2 AND 100
  THEN RAISE EXCEPTION 'The branch creation command is invalid'; END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(p_input::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('branch-create:'||p_actor_user_id::text||':'||p_command_id::text,0));
  SELECT * INTO existing FROM public.branch_creation_commands command
  WHERE command.actor_user_id=p_actor_user_id AND command.command_id=p_command_id;
  IF existing.command_id IS NOT NULL THEN
    IF existing.payload_hash IS DISTINCT FROM payload_hash_value THEN RAISE EXCEPTION 'The branch creation command is unavailable'; END IF;
    RETURN existing.result;
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO company_row FROM public.companies company WHERE company.id=company_id_value AND company.active FOR UPDATE;
  IF snapshot IS NULL OR company_row.id IS NULL OR NOT public.axora_organization_permission_at(
    snapshot,'organization.branch.manage',company_id_value,NULL,NULL
  ) THEN RAISE EXCEPTION 'The branch creation command is unavailable'; END IF;
  INSERT INTO public.branches(
    id,branch_code_id,company_id,name,branch_code,delivery_address,city,contact_name,
    contact_phone,contact_email,delivery_instructions,notes,timezone,active,created_at,updated_at
  ) VALUES (
    branch_id_value,public.next_branch_code(),company_id_value,btrim(p_input->>'name'),upper(btrim(p_input->>'branchCode')),
    btrim(p_input->>'addressLabel'),btrim(p_input->>'city'),btrim(p_input->>'contactName'),btrim(p_input->>'contactPhone'),
    lower(btrim(COALESCE(p_input->>'contactEmail',''))),NULLIF(btrim(COALESCE(p_input->>'deliveryInstructions','')),''),
    NULLIF(btrim(COALESCE(p_input->>'notes','')),''),company_row.timezone,true,p_at,p_at
  );
  PERFORM public.axora_save_branch_delivery_location_v2(
    p_actor_user_id,p_actor_role_assignment_id,branch_id_value,p_input->>'addressLabel',latitude_value,
    longitude_value,COALESCE(p_input->>'deliveryInstructions',''),'BRANCH_CREATED_WITH_PRIMARY_LOCATION',
    p_command_id,p_at,p_input->>'providerId',COALESCE(p_input->>'providerPlaceId',''),
    COALESCE(p_input->>'providerAttribution','')
  );
  result_value:=jsonb_build_object('status','CREATED','branchId',branch_id_value,'companyId',company_id_value);
  INSERT INTO public.branch_creation_commands(actor_user_id,command_id,company_id,branch_id,payload_hash,result,created_at)
  VALUES (p_actor_user_id,p_command_id,company_id_value,branch_id_value,payload_hash_value,result_value,p_at);
  RETURN result_value;
END $$;

CREATE OR REPLACE FUNCTION public.axora_update_branch_details(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_input jsonb,p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
#variable_conflict use_variable
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE;
  existing public.branch_details_commands%ROWTYPE; payload_hash_value text;
  previous_snapshot jsonb; result_value jsonb;
BEGIN
  IF p_command_id IS NULL OR jsonb_typeof(p_input)<>'object'
    OR char_length(btrim(COALESCE(p_input->>'name',''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_input->>'city',''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_input->>'contactName',''))) NOT BETWEEN 2 AND 300
    OR char_length(btrim(COALESCE(p_input->>'contactPhone',''))) NOT BETWEEN 5 AND 120
    OR char_length(btrim(COALESCE(p_input->>'contactEmail','')))>320
    OR (btrim(COALESCE(p_input->>'contactEmail',''))<>''
      AND btrim(p_input->>'contactEmail') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    OR char_length(btrim(COALESCE(p_input->>'notes','')))>1000
    OR p_input::text ~ '[[:cntrl:]]'
    OR NOT public.workflow_metadata_is_safe(p_input)
  THEN RAISE EXCEPTION 'The branch details command is invalid'; END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(p_input::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'branch-details:'||p_actor_user_id::text||':'||p_command_id::text,0
  ));
  SELECT * INTO existing FROM public.branch_details_commands command
  WHERE command.actor_user_id=p_actor_user_id AND command.command_id=p_command_id;
  IF existing.command_id IS NOT NULL THEN
    IF existing.branch_id IS DISTINCT FROM p_branch_id
      OR existing.payload_hash IS DISTINCT FROM payload_hash_value
    THEN RAISE EXCEPTION 'The branch details command is unavailable'; END IF;
    RETURN existing.result;
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(
    p_actor_user_id,p_actor_role_assignment_id,p_at
  );
  SELECT * INTO branch_row FROM public.branches branch
  WHERE branch.id=p_branch_id FOR UPDATE;
  IF snapshot IS NULL OR branch_row.id IS NULL
    OR NOT public.axora_organization_permission_at(
      snapshot,'organization.branch.manage',branch_row.company_id,branch_row.id,NULL
    )
  THEN RAISE EXCEPTION 'The branch details command is unavailable'; END IF;
  previous_snapshot:=to_jsonb(branch_row);
  UPDATE public.branches SET name=btrim(p_input->>'name'),city=btrim(p_input->>'city'),
    contact_name=btrim(p_input->>'contactName'),contact_phone=btrim(p_input->>'contactPhone'),
    contact_email=lower(btrim(COALESCE(p_input->>'contactEmail',''))),
    notes=NULLIF(btrim(COALESCE(p_input->>'notes','')),''),updated_at=p_at
  WHERE id=branch_row.id AND company_id=branch_row.company_id;
  result_value:=jsonb_build_object(
    'status','UPDATED','branchId',branch_row.id,'companyId',branch_row.company_id
  );
  INSERT INTO public.organization_structure_history(
    company_id,node_type,node_id,change_type,previous_snapshot,new_snapshot,
    reason,changed_by,changed_at
  ) VALUES (
    branch_row.company_id,'BRANCH',branch_row.id,'UPDATED',previous_snapshot,
    (SELECT to_jsonb(branch) FROM public.branches branch WHERE branch.id=branch_row.id),
    'BRANCH_DETAILS_UPDATED',p_actor_user_id,p_at
  );
  INSERT INTO public.branch_details_commands(
    actor_user_id,command_id,company_id,branch_id,payload_hash,result,created_at
  ) VALUES (
    p_actor_user_id,p_command_id,branch_row.company_id,branch_row.id,
    payload_hash_value,result_value,p_at
  );
  RETURN result_value;
END $$;

-- Budget commands are replay-safe evidence; the active period and its ledger
-- remain immutable while future renewal configuration is append-only.
CREATE TABLE public.branch_budget_commands (
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  budget_account_id uuid NOT NULL REFERENCES public.budget_accounts(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY(actor_user_id,command_id)
);
ALTER TABLE public.branch_budget_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_budget_commands FORCE ROW LEVEL SECURITY;
CREATE TRIGGER branch_budget_commands_append_only BEFORE UPDATE OR DELETE ON public.branch_budget_commands
FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

CREATE TABLE public.branch_budget_funding_states (
  budget_account_id uuid PRIMARY KEY REFERENCES public.budget_accounts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  required_amount numeric(18,2) NOT NULL CHECK (required_amount>0),
  available_amount numeric(18,2) NOT NULL CHECK (available_amount>=0),
  period_id uuid REFERENCES public.budget_periods(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state='FUNDING_REQUIRED'),
  first_detected_at timestamptz NOT NULL,
  last_checked_at timestamptz NOT NULL
);
ALTER TABLE public.branch_budget_funding_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_budget_funding_states FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.axora_protect_active_budget_period()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.status='ACTIVE' AND (
    NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
    OR NEW.timezone IS DISTINCT FROM OLD.timezone OR NEW.allocation_method IS DISTINCT FROM OLD.allocation_method
    OR NEW.rollover_policy IS DISTINCT FROM OLD.rollover_policy OR NEW.rollover_cap IS DISTINCT FROM OLD.rollover_cap
    OR (OLD.schedule_id IS NOT NULL AND (NEW.schedule_id IS DISTINCT FROM OLD.schedule_id
      OR NEW.schedule_version IS DISTINCT FROM OLD.schedule_version))
    OR NEW.cycle_number IS DISTINCT FROM OLD.cycle_number OR NEW.previous_period_id IS DISTINCT FROM OLD.previous_period_id
  ) THEN RAISE EXCEPTION 'Active budget period financial terms are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_active_budget_period BEFORE UPDATE ON public.budget_periods
FOR EACH ROW EXECUTE FUNCTION public.axora_protect_active_budget_period();

CREATE OR REPLACE FUNCTION public.axora_configure_first_branch_budget(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,p_amount numeric,
  p_cycle text,p_start_date date,p_custom_end_date date,p_command_id uuid,p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; branch_row public.branches%ROWTYPE; account_row public.budget_accounts%ROWTYPE;
  period_row public.budget_periods%ROWTYPE; command_row public.branch_budget_commands%ROWTYPE;
  balance_row record; wallet_available numeric(18,2); payload_hash_value text; result_value jsonb;
  schedule_id_value uuid; schedule_version_value integer; frequency_value text; custom_days integer;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2) OR p_cycle NOT IN ('MONTHLY','YEARLY','CUSTOM')
    OR p_start_date IS NULL OR p_command_id IS NULL
    OR (p_cycle='CUSTOM' AND (p_custom_end_date IS NULL OR p_custom_end_date<p_start_date))
  THEN RAISE EXCEPTION 'The first branch budget command is invalid'; END IF;
  payload_hash_value:=encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'branchId',p_branch_id,'amount',p_amount,'cycle',p_cycle,'startDate',p_start_date,'customEndDate',p_custom_end_date
  )::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('first-branch-budget:'||p_actor_user_id::text||':'||p_command_id::text,0));
  SELECT * INTO command_row FROM public.branch_budget_commands command
  WHERE command.actor_user_id=p_actor_user_id AND command.command_id=p_command_id;
  IF command_row.command_id IS NOT NULL THEN
    IF command_row.payload_hash IS DISTINCT FROM payload_hash_value THEN RAISE EXCEPTION 'The first branch budget command is unavailable'; END IF;
    RETURN command_row.result||jsonb_build_object('status','ALREADY_CREATED');
  END IF;
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  SELECT * INTO branch_row FROM public.branches branch WHERE branch.id=p_branch_id AND branch.active FOR UPDATE;
  SELECT * INTO account_row FROM public.budget_accounts account
  WHERE account.branch_id=p_branch_id AND account.level_type='BRANCH' AND account.active FOR UPDATE;
  SELECT * INTO period_row FROM public.budget_periods period
  WHERE period.budget_account_id=account_row.id AND period.status='ACTIVE' FOR UPDATE;
  IF snapshot IS NULL OR branch_row.id IS NULL OR account_row.id IS NULL OR period_row.id IS NULL
    OR NOT public.axora_budget_account_permission(snapshot,'budget.assign','BRANCH',branch_row.company_id,branch_row.id,NULL)
  THEN RAISE EXCEPTION 'The first branch budget command is unavailable'; END IF;
  IF p_start_date<>(p_at AT TIME ZONE account_row.period_timezone)::date
  THEN RAISE EXCEPTION 'The first branch budget command is invalid'; END IF;
  SELECT COALESCE(balance.allocated,0) AS allocated,COALESCE(balance.reserved,0) AS reserved,
    COALESCE(balance.spent,0) AS spent,COALESCE(balance.pending_approval,0) AS pending
  INTO balance_row FROM public.v_budget_period_balances balance WHERE balance.budget_period_id=period_row.id;
  IF account_row.recurring_allocation>0 OR COALESCE(balance_row.allocated,0)>0 OR COALESCE(balance_row.reserved,0)>0
    OR COALESCE(balance_row.spent,0)>0 OR COALESCE(balance_row.pending,0)>0
  THEN RETURN jsonb_build_object('status','ACTIVE_IMMUTABLE','branchId',p_branch_id,'accountId',account_row.id); END IF;
  SELECT COALESCE(balance.available_balance,0) INTO wallet_available
  FROM public.v_company_wallet_balances balance WHERE balance.company_id=branch_row.company_id AND balance.currency=account_row.currency;
  wallet_available:=COALESCE(wallet_available,0);
  IF wallet_available<p_amount THEN
    INSERT INTO public.branch_budget_funding_states(
      budget_account_id,company_id,branch_id,required_amount,available_amount,period_id,state,first_detected_at,last_checked_at
    ) VALUES (account_row.id,branch_row.company_id,p_branch_id,p_amount,wallet_available,period_row.id,'FUNDING_REQUIRED',p_at,p_at)
    ON CONFLICT(budget_account_id) DO UPDATE SET required_amount=EXCLUDED.required_amount,
      available_amount=EXCLUDED.available_amount,period_id=EXCLUDED.period_id,last_checked_at=EXCLUDED.last_checked_at;
    RETURN jsonb_build_object('status','FUNDING_REQUIRED','branchId',p_branch_id,'accountId',account_row.id);
  END IF;
  DELETE FROM public.branch_budget_funding_states state WHERE state.budget_account_id=account_row.id;
  frequency_value:=p_cycle;
  custom_days:=CASE WHEN p_cycle='CUSTOM' THEN p_custom_end_date-p_start_date+1 ELSE NULL END;
  SELECT COALESCE(max(schedule.schedule_version),0)+1 INTO schedule_version_value
  FROM public.budget_cycle_schedules schedule WHERE schedule.budget_account_id=account_row.id;
  INSERT INTO public.budget_cycle_schedules(
    company_id,budget_account_id,schedule_version,frequency,interval_count,custom_interval_days,
    timezone,anchor_local,dst_resolution,fixed_allocation,rollover_mode,low_threshold_percentage,
    critical_threshold_percentage,hysteresis_percentage,effective_at,approved_by,
    approved_by_role_assignment_id,approval_reason
  ) VALUES (
    branch_row.company_id,account_row.id,schedule_version_value,frequency_value,1,custom_days,
    account_row.period_timezone,p_start_date::timestamp,'EARLIER',p_amount,'RESET_FIXED',25,10,5,p_at,
    p_actor_user_id,p_actor_role_assignment_id,'First branch budget configured by Company Administrator'
  ) RETURNING id INTO schedule_id_value;
  UPDATE public.budget_accounts SET recurring_allocation=p_amount,refresh_interval=p_cycle,updated_at=p_at WHERE id=account_row.id;
  UPDATE public.branches SET monthly_budget=p_amount,budget_updated_at=p_at WHERE id=p_branch_id AND company_id=branch_row.company_id;
  PERFORM public.axora_post_budget_entry_internal(
    branch_row.company_id,account_row.id,period_row.id,'INITIAL_ALLOCATION',p_amount,p_amount,p_amount,
    0,0,0,0,0,NULL,NULL,NULL,NULL,'BUDGET_ACCOUNT',account_row.id,p_actor_user_id,
    p_actor_role_assignment_id,NULL,'FIRST_BRANCH_BUDGET','First branch budget configured',p_command_id,
    'first-branch-budget-'||p_command_id::text,p_at
  );
  result_value:=jsonb_build_object('status','CREATED','branchId',p_branch_id,'accountId',account_row.id,
    'periodId',period_row.id,'scheduleId',schedule_id_value,'amount',p_amount::text,'cycle',p_cycle);
  INSERT INTO public.branch_budget_commands(actor_user_id,command_id,company_id,branch_id,budget_account_id,payload_hash,result,created_at)
  VALUES (p_actor_user_id,p_command_id,branch_row.company_id,p_branch_id,account_row.id,payload_hash_value,result_value,p_at);
  RETURN result_value;
END $$;

CREATE OR REPLACE FUNCTION public.axora_branch_budget_funding_state(
  p_actor_user_id uuid,p_actor_role_assignment_id uuid,p_branch_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot jsonb; funding public.branch_budget_funding_states%ROWTYPE;
BEGIN
  snapshot:=public.axora_live_authorization_snapshot(p_actor_user_id,p_actor_role_assignment_id,p_at);
  IF snapshot IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches branch
    WHERE branch.id=p_branch_id
      AND public.axora_budget_account_permission(snapshot,'budget.view','BRANCH',branch.company_id,branch.id,NULL)
  ) THEN RETURN NULL; END IF;
  SELECT state.* INTO funding FROM public.branch_budget_funding_states state
  WHERE state.branch_id=p_branch_id;
  IF funding.budget_account_id IS NULL THEN RETURN jsonb_build_object('state','READY'); END IF;
  RETURN jsonb_build_object(
    'state',funding.state,'requiredAmount',funding.required_amount::text,
    'availableAmount',funding.available_amount::text,'lastCheckedAt',funding.last_checked_at
  );
END $$;

-- A legacy active account can lack a user_profiles row. Keep a scheduled
-- funding warning local and typed instead of letting a NULL email locale roll
-- the entire renewal check back.
DO $patch$
DECLARE original_definition text; patched_definition text; marker text;
BEGIN
  SELECT pg_get_functiondef('public.axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure)
  INTO original_definition;
  marker:='  SELECT profile.preferred_locale INTO selected_locale
  FROM public.user_profiles profile WHERE profile.user_id=p_recipient_user_id;';
  patched_definition:=replace(original_definition,marker,marker||$insert$
  selected_locale:=CASE WHEN selected_locale IN ('en','ar','ms') THEN selected_locale ELSE 'en' END;
$insert$);
  IF patched_definition=original_definition THEN RAISE EXCEPTION 'Workflow email locale fallback patch was not applied'; END IF;
  EXECUTE patched_definition;
END $patch$;

-- Renewal checks Wallet availability before any period is closed or ledger
-- entry is posted. A retry is safe and never creates a duplicate period.
DO $patch$
DECLARE original_definition text; patched_definition text; marker text;
BEGIN
  SELECT pg_get_functiondef('public.axora_refresh_budget_period_internal(uuid,uuid,uuid,text,text,text,timestamptz)'::regprocedure)
  INTO original_definition;
  marker:='  base_allocation:=CASE WHEN schedule.rollover_mode=''NONE''
    THEN 0 ELSE schedule.fixed_allocation END;';
  patched_definition:=replace(original_definition,marker,marker||$insert$
  IF base_allocation>COALESCE((SELECT wallet_balance.available_balance
    FROM public.v_company_wallet_balances wallet_balance
    WHERE wallet_balance.company_id=account.company_id AND wallet_balance.currency=account.currency),0) THEN
    INSERT INTO public.branch_budget_funding_states(
      budget_account_id,company_id,branch_id,required_amount,available_amount,period_id,state,first_detected_at,last_checked_at
    ) VALUES (account.id,account.company_id,account.branch_id,base_allocation,
      COALESCE((SELECT wallet_balance.available_balance FROM public.v_company_wallet_balances wallet_balance
        WHERE wallet_balance.company_id=account.company_id AND wallet_balance.currency=account.currency),0),
      current_period.id,'FUNDING_REQUIRED',p_at,p_at)
    ON CONFLICT(budget_account_id) DO UPDATE SET required_amount=EXCLUDED.required_amount,
      available_amount=EXCLUDED.available_amount,period_id=EXCLUDED.period_id,last_checked_at=EXCLUDED.last_checked_at;
    PERFORM public.axora_emit_budget_notification(account.id,'budget.refresh_failed',
      'budget-funding-required:'||account.id::text||':'||current_period.id::text,NULL,p_actor_user_id,
      correlation,p_at,jsonb_build_object('errorCode','FUNDING_REQUIRED','requiredAmount',base_allocation::text));
    RETURN jsonb_build_object('accountId',account.id,'periodId',current_period.id,'changed',false,
      'fundingRequired',true,'requiredAmount',base_allocation::text);
  END IF;
  DELETE FROM public.branch_budget_funding_states funding WHERE funding.budget_account_id=account.id;
$insert$);
  IF patched_definition=original_definition THEN RAISE EXCEPTION 'Budget renewal Wallet guard patch was not applied'; END IF;
  EXECUTE patched_definition;
END $patch$;

DO $patch$
DECLARE original_definition text; patched_definition text; marker text;
BEGIN
  SELECT pg_get_functiondef('public.axora_process_budget_refresh_job(text,uuid,uuid,timestamptz)'::regprocedure)
  INTO original_definition;
  marker:='    UPDATE public.budget_refresh_jobs SET state=''SUCCEEDED'',';
  patched_definition:=replace(original_definition,marker,$insert$
    IF COALESCE((result->>'fundingRequired')::boolean,false) THEN
      next_attempt:=p_at+interval '24 hours';
      UPDATE public.budget_refresh_jobs SET state='RETRY',attempt_count=greatest(attempt_count-1,0),
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=next_attempt,
        last_error_code='FUNDING_REQUIRED',result=result,updated_at=p_at WHERE id=job.id;
      INSERT INTO public.budget_refresh_job_events(
        job_id,company_id,event_type,attempt_count,worker_id,error_code,occurred_at,metadata
      ) VALUES (job.id,job.company_id,'RETRY_SCHEDULED',job.attempt_count,p_worker_id,
        'FUNDING_REQUIRED',p_at,jsonb_build_object('nextAttemptAt',next_attempt));
      RETURN jsonb_build_object('jobId',job.id,'state','RETRY','errorCode','FUNDING_REQUIRED',
        'nextAttemptAt',next_attempt,'result',result);
    END IF;
    UPDATE public.budget_refresh_jobs SET state='SUCCEEDED',$insert$);
  patched_definition:=replace(patched_definition,'  result jsonb;','  refresh_result jsonb;');
  patched_definition:=replace(patched_definition,'result:=public.axora_refresh','refresh_result:=public.axora_refresh');
  patched_definition:=replace(patched_definition,'(result->>','(refresh_result->>');
  patched_definition:=replace(patched_definition,'result=result','result=refresh_result');
  patched_definition:=replace(patched_definition,'''result'',result','''result'',refresh_result');
  patched_definition:=replace(patched_definition,'p_at,result','p_at,refresh_result');
  IF patched_definition=original_definition THEN RAISE EXCEPTION 'Budget funding retry patch was not applied'; END IF;
  EXECUTE patched_definition;
END $patch$;

REVOKE ALL ON TABLE public.branch_delivery_location_provider_evidence,
  public.branch_creation_commands,public.branch_details_commands,public.branch_budget_commands,
  public.branch_budget_funding_states FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_save_branch_delivery_location_v2(
  uuid,uuid,uuid,text,numeric,numeric,text,text,uuid,timestamptz,text,text,text
),public.axora_create_branch_with_primary_location(uuid,uuid,jsonb,uuid,timestamptz),
public.axora_update_branch_details(uuid,uuid,uuid,jsonb,uuid,timestamptz),
public.axora_configure_first_branch_budget(uuid,uuid,uuid,numeric,text,date,date,uuid,timestamptz),
public.axora_branch_budget_funding_state(uuid,uuid,uuid,timestamptz)
FROM PUBLIC;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE ALL ON TABLE public.branch_delivery_location_provider_evidence,
      public.branch_creation_commands,public.branch_details_commands,public.branch_budget_commands,
      public.branch_budget_funding_states FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_save_branch_delivery_location_v2(
      uuid,uuid,uuid,text,numeric,numeric,text,text,uuid,timestamptz,text,text,text
    ),public.axora_create_branch_with_primary_location(uuid,uuid,jsonb,uuid,timestamptz),
    public.axora_update_branch_details(uuid,uuid,uuid,jsonb,uuid,timestamptz),
    public.axora_configure_first_branch_budget(uuid,uuid,uuid,numeric,text,date,date,uuid,timestamptz),
    public.axora_branch_budget_funding_state(uuid,uuid,uuid,timestamptz)
    TO axora_app;
  END IF;
END $grant$;

INSERT INTO public.company_deletion_ownership_rules(table_name,unprotected_action,protected_action,rationale) VALUES
  ('branch_delivery_location_provider_evidence','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED','Immutable provider provenance for canonical branch locations.'),
  ('branch_creation_commands','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED','Replay-safe branch creation evidence.'),
  ('branch_details_commands','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED','Replay-safe audited branch detail changes.'),
  ('branch_budget_commands','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED','Immutable first-budget command evidence.'),
  ('branch_budget_funding_states','CASCADE_DELETE','RETAIN_WITH_ACCESS_REVOKED','Current derived funding requirement state; immutable financial evidence remains elsewhere.')
ON CONFLICT(table_name) DO UPDATE SET unprotected_action=EXCLUDED.unprotected_action,
  protected_action=EXCLUDED.protected_action,rationale=EXCLUDED.rationale;

UPDATE public.company_deletion_ownership_dag SET delete_order=delete_order+500;
UPDATE public.company_deletion_ownership_dag SET delete_order=delete_order-495;
INSERT INTO public.company_deletion_ownership_dag(delete_order,table_name,rationale)
SELECT ordered.ordinality::integer,ordered.table_name,
  'Company-owned foundation record deleted before its referenced branch, location, budget period, or budget account.'
FROM unnest(ARRAY[
  'branch_delivery_location_provider_evidence','branch_creation_commands','branch_details_commands',
  'branch_budget_commands','branch_budget_funding_states'
]::text[]) WITH ORDINALITY AS ordered(table_name,ordinality)
ON CONFLICT(table_name) DO NOTHING;

COMMIT;
