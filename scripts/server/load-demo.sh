#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

printf 'This loads sanitized demonstration companies, products, suppliers, and requests.\n'
printf 'Do not use it after real company data has been entered.\n'
read -r -p 'Type LOAD DEMO exactly to continue: ' CONFIRMATION
[[ "$CONFIRMATION" == "LOAD DEMO" ]] || fail "Demo load cancelled."

compose exec -T db psql --username postgres --dbname axora --set=ON_ERROR_STOP=1 < database/seeds/demo.sql
info "Sanitized demonstration data loaded"
