BEGIN;

SELECT pg_advisory_xact_lock(12020260826);
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

-- The current CAM workspace includes customer invoices. This grants only the
-- customer invoice register capability; supplier finance remains protected by
-- finance.manage in the application projection. Explicit DENY overrides and
-- assignment lifecycle checks remain authoritative in the live snapshot.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT role.id,permission.id
FROM public.roles role
JOIN public.permissions permission
  ON permission.permission_code='finance.invoice.view'
 AND permission.active
WHERE role.role_key='CLIENT_ACCOUNT_MANAGER'
ON CONFLICT DO NOTHING;

COMMIT;
