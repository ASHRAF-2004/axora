BEGIN;

-- Axora can have more than one protected platform owner. Platform owners are
-- still kept separate from company-scoped administrators by
-- users_owner_company_rule.
DROP INDEX IF EXISTS users_single_owner_uq;

COMMIT;
