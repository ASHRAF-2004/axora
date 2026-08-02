BEGIN;

-- Reuse the keyed public-request bucket for login throttling. Only HMAC
-- fingerprints are retained; raw IP addresses and entered email addresses
-- never enter this table.
ALTER TABLE public_request_rate_buckets
  DROP CONSTRAINT IF EXISTS public_request_rate_buckets_action_key_check;
ALTER TABLE public_request_rate_buckets
  ADD CONSTRAINT public_request_rate_buckets_action_key_check
    CHECK (action_key IN (
      'CONTACT','PASSWORD_RESET','EMAIL_VERIFICATION','LOGIN'
    ));

CREATE INDEX IF NOT EXISTS public_request_rate_buckets_login_idx
  ON public_request_rate_buckets(scope_kind,scope_hash,bucket_started_at DESC)
  WHERE action_key='LOGIN';

COMMIT;
