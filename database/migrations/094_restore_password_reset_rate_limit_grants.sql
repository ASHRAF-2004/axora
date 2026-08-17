BEGIN;

SELECT pg_advisory_xact_lock(94217731);

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Migration 092 moved public-visitor rate limiting behind SECURITY DEFINER
-- functions and revoked direct access to the shared rate-bucket table. The
-- password-reset path still performs its rate-limit upsert directly as the
-- axora_app role, so it requires these narrowly scoped table privileges.
--
-- PGlite and other schema-only validation environments do not create the
-- deployment role. Match the existing migration convention by applying and
-- verifying the privilege contract only when that role exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'axora_app'
  ) THEN
    EXECUTE
      'REVOKE DELETE ON TABLE public.public_request_rate_buckets FROM axora_app';
    EXECUTE
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.public_request_rate_buckets TO axora_app';

    IF NOT has_table_privilege(
      'axora_app',
      'public.public_request_rate_buckets',
      'SELECT'
    )
      OR NOT has_table_privilege(
        'axora_app',
        'public.public_request_rate_buckets',
        'INSERT'
      )
      OR NOT has_table_privilege(
        'axora_app',
        'public.public_request_rate_buckets',
        'UPDATE'
      )
    THEN
      RAISE EXCEPTION
        'axora_app must retain SELECT, INSERT, and UPDATE on public.public_request_rate_buckets';
    END IF;

    IF has_table_privilege(
      'axora_app',
      'public.public_request_rate_buckets',
      'DELETE'
    ) THEN
      RAISE EXCEPTION
        'axora_app must not have DELETE on public.public_request_rate_buckets';
    END IF;
  END IF;
END
$$;

COMMIT;
