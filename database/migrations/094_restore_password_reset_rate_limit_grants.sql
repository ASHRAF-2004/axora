BEGIN;

SELECT pg_advisory_xact_lock(94217731);

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Migration 092 moved public-visitor rate limiting behind SECURITY DEFINER
-- functions and revoked direct access to the shared rate-bucket table. The
-- password-reset path still performs its rate-limit upsert directly as the
-- axora_app role, so it requires these narrowly scoped table privileges.
REVOKE DELETE
  ON TABLE public.public_request_rate_buckets
  FROM axora_app;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.public_request_rate_buckets
  TO axora_app;

DO $$
BEGIN
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
END
$$;

COMMIT;
