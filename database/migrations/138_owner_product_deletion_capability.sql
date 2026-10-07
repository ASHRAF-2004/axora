BEGIN;

-- Permanent product deletion is an Owner lifecycle action, not ordinary
-- catalogue editing. Keep private references and all asset changes behind one
-- audited transaction without giving the shared application role raw DELETE.
CREATE OR REPLACE FUNCTION public.axora_delete_product(
  p_actor_user_id uuid,
  p_actor_role_assignment_id uuid,
  p_expected_auth_version integer,
  p_product_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp
AS $$
DECLARE
  actor_id uuid;
  assignment_id uuid;
  target_id uuid;
  snapshot jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_role_assignment_id IS NULL
    OR p_expected_auth_version IS NULL OR p_expected_auth_version<1
    OR p_product_id IS NULL
    OR p_actor_user_id IS DISTINCT FROM public.axora_try_uuid(
      nullif(current_setting('axora.user_id',true),'')
    )
    OR p_actor_role_assignment_id IS DISTINCT FROM public.axora_try_uuid(
      nullif(current_setting('axora.role_assignment_id',true),'')
    )
  THEN RETURN 'FORBIDDEN'; END IF;

  -- Permission management locks the subject user FOR UPDATE. SHARE also
  -- blocks ordinary auth-version/status updates and assignment revocation;
  -- KEY SHARE would not protect those non-key updates.
  SELECT account.id INTO actor_id
  FROM public.users account
  WHERE account.id=p_actor_user_id AND account.active
    AND account.account_status='ACTIVE'
    AND account.account_setup_completed_at IS NOT NULL
    AND account.account_kind='PLATFORM' AND account.is_owner
    AND account.auth_version=p_expected_auth_version
  FOR SHARE;
  IF actor_id IS NULL THEN RETURN 'FORBIDDEN'; END IF;

  SELECT assignment.id INTO assignment_id
  FROM public.role_assignments assignment
  JOIN public.roles role ON role.id=assignment.role_id
  WHERE assignment.id=p_actor_role_assignment_id
    AND assignment.user_id=actor_id AND assignment.active
    AND assignment.revoked_at IS NULL AND assignment.scope_type='PLATFORM'
    AND assignment.company_id IS NULL AND assignment.branch_id IS NULL
    AND assignment.department_id IS NULL AND assignment.supplier_id IS NULL
    AND role.role_key='PLATFORM_OWNER'
  FOR SHARE OF assignment;
  IF assignment_id IS NULL THEN RETURN 'FORBIDDEN'; END IF;

  snapshot:=public.axora_live_authorization_snapshot(actor_id,assignment_id,clock_timestamp());
  IF NOT public.axora_company_actor_is_owner(snapshot)
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'product.manage','PLATFORM',NULL,NULL,NULL,NULL
    )
    OR NOT public.axora_snapshot_has_permission(
      snapshot,'product.archive','PLATFORM',NULL,NULL,NULL,NULL
    )
  THEN RETURN 'FORBIDDEN'; END IF;

  SELECT product.id INTO target_id FROM public.products product
  WHERE product.id=p_product_id FOR UPDATE;
  IF target_id IS NULL THEN RETURN 'ALREADY_DELETED'; END IF;

  IF EXISTS (SELECT 1 FROM public.request_lines WHERE product_id=target_id)
    OR EXISTS (SELECT 1 FROM public.request_actual_lines
      WHERE estimated_product_id=target_id OR actual_product_id=target_id)
  THEN RETURN 'PURCHASE_HISTORY'; END IF;
  IF EXISTS (SELECT 1 FROM public.procurement_cart_items WHERE product_id=target_id)
  THEN RETURN 'CART'; END IF;
  IF EXISTS (SELECT 1 FROM public.integration_request_draft_items WHERE product_id=target_id)
  THEN RETURN 'DRAFT'; END IF;

  -- Existing foreign keys remain the final protection for concurrent or
  -- future reference types. Database-owned image bytes and supplier links
  -- roll back with the product if any deletion/audit operation fails. Append-
  -- only commercial, quantity-rule and audit history is deliberately retained.
  DELETE FROM public.product_suppliers WHERE product_id=target_id;
  DELETE FROM public.product_images WHERE product_id=target_id;
  DELETE FROM public.products WHERE id=target_id;
  RETURN 'DELETED';
END $$;

REVOKE ALL ON FUNCTION public.axora_delete_product(uuid,uuid,integer,uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='axora_app') THEN
    REVOKE DELETE ON TABLE public.products,public.product_suppliers,public.product_images FROM axora_app;
    GRANT EXECUTE ON FUNCTION public.axora_delete_product(uuid,uuid,integer,uuid) TO axora_app;
  END IF;
END $$;

COMMIT;
