#!/bin/sh
set -eu

AXORA_APP_ROLE_PASSWORD="$(cat /run/secrets/axora_app_password)"
AXORA_CLEANUP_ROLE_PASSWORD="$(cat /run/secrets/axora_cleanup_worker_password)"
AXORA_INTEGRATION_WORKER_ROLE_PASSWORD="$(cat /run/secrets/axora_integration_worker_password)"
export AXORA_APP_ROLE_PASSWORD AXORA_CLEANUP_ROLE_PASSWORD
export AXORA_INTEGRATION_WORKER_ROLE_PASSWORD

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv app_password AXORA_APP_ROLE_PASSWORD
\getenv cleanup_password AXORA_CLEANUP_ROLE_PASSWORD
\getenv integration_worker_password AXORA_INTEGRATION_WORKER_ROLE_PASSWORD
SELECT format('CREATE ROLE axora_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_app') \gexec
SELECT format('ALTER ROLE axora_app PASSWORD %L', :'app_password') \gexec
SELECT format('CREATE ROLE axora_cleanup_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'cleanup_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_cleanup_worker') \gexec
SELECT format('ALTER ROLE axora_cleanup_worker PASSWORD %L', :'cleanup_password') \gexec
SELECT format('CREATE ROLE axora_integration_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'integration_worker_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'axora_integration_worker') \gexec
SELECT format('ALTER ROLE axora_integration_worker PASSWORD %L', :'integration_worker_password') \gexec
SQL
unset AXORA_APP_ROLE_PASSWORD AXORA_CLEANUP_ROLE_PASSWORD
unset AXORA_INTEGRATION_WORKER_ROLE_PASSWORD
