#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command docker
require_server_config
require_secrets

info "Applying the idempotent Axora database migration"
compose run --rm migrate
info "Migration complete"
