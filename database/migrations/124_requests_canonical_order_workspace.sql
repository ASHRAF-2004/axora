BEGIN;

-- Receiving is now a request-detail capability. A receiving-only company role
-- therefore needs read access to the request that owns the delivery, while the
-- existing company/branch/department scope and explicit DENY rules remain final.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code='request.view'
WHERE role.role_key='RECEIVING_USER'
ON CONFLICT DO NOTHING;

-- RLS for delivery records must use the same request-bound live capability as
-- the Request workspace. This closes the legacy company-scope gap without
-- weakening Delivery Agent assignment isolation.
CREATE OR REPLACE FUNCTION public.axora_context_can_access_delivery_job(
  p_delivery_job_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.delivery_job_assignments assignment
    WHERE assignment.delivery_job_id=p_delivery_job_id
      AND assignment.driver_user_id=public.axora_context_user_id()
      AND assignment.status IN ('ASSIGNED','ACCEPTED')
      AND assignment.ended_at IS NULL
      AND (
        assignment.driver_role_assignment_id IS NULL
        OR assignment.driver_role_assignment_id=public.axora_context_role_assignment_id()
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.delivery_jobs job
    WHERE job.id=p_delivery_job_id
      AND public.axora_request_resource_access(
        public.axora_context_user_id(),
        public.axora_context_role_assignment_id(),
        'delivery.view',job.request_id,statement_timestamp()
      ) IS NOT NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.axora_context_can_confirm_delivery_receipt(
  p_delivery_job_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE actor_snapshot jsonb; request_id_value uuid;
BEGIN
  actor_snapshot:=public.axora_live_authorization_snapshot(
    public.axora_context_user_id(),public.axora_context_role_assignment_id(),
    statement_timestamp()
  );
  IF actor_snapshot IS NULL OR actor_snapshot->>'accountKind'<>'COMPANY' THEN
    RETURN false;
  END IF;
  SELECT job.request_id INTO request_id_value
  FROM public.delivery_jobs job WHERE job.id=p_delivery_job_id;
  RETURN request_id_value IS NOT NULL AND public.axora_request_resource_access(
    public.axora_context_user_id(),public.axora_context_role_assignment_id(),
    'receiving.confirm',request_id_value,statement_timestamp()
  ) IS NOT NULL;
END
$$;

DROP POLICY IF EXISTS receipts_read_scope ON public.receipts;
CREATE POLICY receipts_read_scope ON public.receipts FOR SELECT
  USING (public.axora_context_can_access_delivery_job(delivery_job_id));
DROP POLICY IF EXISTS receipts_receiver_insert ON public.receipts;
CREATE POLICY receipts_receiver_insert ON public.receipts FOR INSERT
  WITH CHECK (
    confirmed_by_user_id=public.axora_context_user_id()
    AND public.axora_context_can_confirm_delivery_receipt(delivery_job_id)
  );

-- CAM customer-finance visibility is rendered inside an already-authorized
-- request. The request resource boundary (including the active company
-- assignment) is still evaluated independently for finance.invoice.view.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission ON permission.permission_code='finance.invoice.view'
WHERE role.role_key='CLIENT_ACCOUNT_MANAGER'
ON CONFLICT DO NOTHING;

-- Customer receipt is an authenticated customer act, separate from driver
-- proof. The former trigger used the legacy branch-assignment helper and could
-- reject a company-scoped Company Administrator even though the canonical live
-- authorization snapshot granted receiving.confirm. Use the request resource
-- boundary so explicit DENY, live assignment state and tenant scope all agree
-- with the server action. Platform actors remain unable to confirm receipt.
CREATE OR REPLACE FUNCTION public.validate_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  context_user_id uuid:=public.axora_context_user_id();
  context_role_assignment_id uuid:=public.axora_context_role_assignment_id();
  actor_snapshot jsonb;
  job_row record;
BEGIN
  SELECT job.branch_id,job.request_id
  INTO job_row
  FROM public.delivery_jobs job
  WHERE job.id=NEW.delivery_job_id
    AND job.company_id=NEW.company_id;

  IF job_row.branch_id IS NULL OR job_row.branch_id<>NEW.branch_id THEN
    RAISE EXCEPTION 'Receipt branch must match the delivery job branch';
  END IF;

  actor_snapshot:=public.axora_live_authorization_snapshot(
    context_user_id,context_role_assignment_id,statement_timestamp()
  );
  IF context_user_id IS NULL
    OR context_role_assignment_id IS NULL
    OR NEW.confirmed_by_user_id<>context_user_id
    OR actor_snapshot IS NULL
    OR NOT public.axora_context_can_confirm_delivery_receipt(NEW.delivery_job_id) THEN
    RAISE EXCEPTION 'Receipt confirmation requires an authorized customer receiving user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.delivery_job_assignments assignment
    WHERE assignment.delivery_job_id=NEW.delivery_job_id
      AND assignment.driver_user_id=NEW.confirmed_by_user_id
  ) THEN
    RAISE EXCEPTION 'Driver evidence cannot serve as customer receipt confirmation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.delivery_job_events event
    JOIN public.delivery_job_assignments assignment
      ON assignment.id=event.assignment_id
     AND assignment.delivery_job_id=event.delivery_job_id
     AND assignment.status IN ('ASSIGNED','ACCEPTED','COMPLETED')
    WHERE event.delivery_job_id=NEW.delivery_job_id
      AND event.company_id=NEW.company_id
      AND event.event_type IN ('PARTIALLY_DELIVERED','DELIVERED')
  ) THEN
    RAISE EXCEPTION 'Customer receipt requires current assignment delivery evidence';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.validate_receipt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_context_can_access_delivery_job(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.axora_context_can_confirm_delivery_receipt(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    GRANT EXECUTE ON FUNCTION public.axora_context_can_access_delivery_job(uuid) TO axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_context_can_confirm_delivery_receipt(uuid) TO axora_app;
  END IF;
END
$$;

COMMIT;
