#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

info "Validating configuration"
compose config --quiet

info "Building the Axora application"
compose build --pull app

info "Starting PostgreSQL"
compose up -d db --wait

info "Applying the database migration"
bash scripts/server/migrate.sh

info "Starting the web application and HTTPS gateway"
compose up -d --wait
compose ps

info "Axora is ready at https://${AXORA_HOST}"
printf 'Next: bash scripts/server/create-admin.sh you@company.com "Your name"\n'
