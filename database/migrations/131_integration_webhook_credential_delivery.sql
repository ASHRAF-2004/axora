BEGIN;

-- Persist whether a receiver can safely accept the one-time HMAC credential.
-- Existing subscriptions retain the Phase II behavior. Provider adapters can
-- suppress credential recovery across create replays and later rotations
-- without weakening signing or storing a plaintext secret.
ALTER TABLE public.integration_webhook_subscriptions
  ADD COLUMN credential_delivery text NOT NULL DEFAULT 'ONE_TIME',
  ADD CONSTRAINT integration_webhook_subscriptions_credential_delivery_check
    CHECK (credential_delivery IN ('ONE_TIME','NONE'));

COMMENT ON COLUMN public.integration_webhook_subscriptions.credential_delivery IS
  'Controls one-time credential disclosure only; every delivery remains HMAC-signed.';

COMMIT;
