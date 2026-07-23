#!/bin/sh
set -eu

node server-tools/migrate.mjs

if [ -n "${ADMIN_INITIAL_PASSWORD:-}" ]; then
  node server-tools/create-admin.mjs "${ADMIN_EMAIL:-admin@axora.local}" "${ADMIN_DISPLAY_NAME:-Ashraf}"
fi

exec node server.js
