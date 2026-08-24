BEGIN;

-- Company administrators deliberately choose an authorized branch before
-- shopping. Grant only the capabilities needed to manage their own scoped
-- cart; approval remains other-user-only and is unchanged.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
CROSS JOIN public.permissions permission
WHERE role.role_key='COMPANY_ADMIN'
  AND permission.permission_code IN ('cart.manage','request.create')
  AND permission.active
ON CONFLICT(role_id,permission_id) DO NOTHING;

-- Match the application/domain command ceiling and prevent repeated ADD
-- commands from producing an aggregate quantity outside the accepted range.
ALTER TABLE public.procurement_cart_items
  ADD CONSTRAINT procurement_cart_items_quantity_upper_bound
  CHECK (quantity<=1000000);

DO $$
BEGIN
  IF (SELECT count(*)
      FROM public.roles role
      JOIN public.role_permissions role_permission ON role_permission.role_id=role.id
      JOIN public.permissions permission ON permission.id=role_permission.permission_id
      WHERE role.role_key='COMPANY_ADMIN'
        AND permission.permission_code IN ('cart.manage','request.create'))<>2
  THEN
    RAISE EXCEPTION 'Company administrator shopping/cart permissions were not installed';
  END IF;
END $$;

COMMIT;
