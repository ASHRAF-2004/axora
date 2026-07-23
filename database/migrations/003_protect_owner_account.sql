BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner_uq
  ON users ((true))
  WHERE is_owner;

COMMIT;
