#!/bin/sh
set -eu

password="$(cat /run/secrets/axora_app_password)"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=app_password="$password" <<'SQL'
SELECT format('CREATE ROLE axora_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') \gexec
SELECT format('ALTER ROLE axora_app PASSWORD %L', :'app_password') \gexec
SQL
