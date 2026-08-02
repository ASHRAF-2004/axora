#!/bin/sh
set -eu

tailscaled_pid=""
bridge_pid=""
app_pid=""
auth_key_file=""

cleanup() {
  exit_code=$?
  trap - EXIT HUP INT TERM

  for child_pid in "$app_pid" "$bridge_pid" "$tailscaled_pid"; do
    if [ -n "$child_pid" ]; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done
  sleep 2
  for child_pid in "$app_pid" "$bridge_pid" "$tailscaled_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill -KILL "$child_pid" 2>/dev/null || true
    fi
  done
  for child_pid in "$app_pid" "$bridge_pid" "$tailscaled_pid"; do
    if [ -n "$child_pid" ]; then
      wait "$child_pid" 2>/dev/null || true
    fi
  done

  if [ -n "$auth_key_file" ] && [ -e "$auth_key_file" ]; then
    : > "$auth_key_file"
    rm -- "$auth_key_file"
  fi

  exit "$exit_code"
}

terminate() {
  exit 143
}

trap cleanup EXIT
trap terminate HUP INT TERM

if [ -n "${TAILSCALE_AUTH_KEY:-}" ]; then
  tailscale_socket="/tmp/axora-tailscaled.sock"
  auth_key_file="$(mktemp /tmp/axora-tailscale-auth.XXXXXX)"
  chmod 600 "$auth_key_file"
  printf '%s\n' "$TAILSCALE_AUTH_KEY" > "$auth_key_file"
  unset TAILSCALE_AUTH_KEY

  echo "Starting Axora's private database network"
  tailscaled \
    --socket="$tailscale_socket" \
    --state=mem: \
    --tun=userspace-networking &
  tailscaled_pid=$!

  socket_attempt=0
  while [ ! -S "$tailscale_socket" ]; do
    socket_attempt=$((socket_attempt + 1))
    if [ "$socket_attempt" -ge 60 ] || ! kill -0 "$tailscaled_pid" 2>/dev/null; then
      echo "Tailscale did not start." >&2
      exit 1
    fi
    sleep 1
  done

  tailscale --socket="$tailscale_socket" up \
    --reset \
    --auth-key="file:$auth_key_file" \
    --hostname="${TAILSCALE_HOSTNAME:-axora-render}" \
    --advertise-tags=tag:axora-render \
    --accept-dns=false \
    --accept-routes=false \
    --shields-up \
    --timeout=60s

  : > "$auth_key_file"
  rm -- "$auth_key_file"
  auth_key_file=""

  tailscale --socket="$tailscale_socket" wait --timeout=60s
  tailscale --socket="$tailscale_socket" status --json \
    | node server-tools/check-tailscale-tag.mjs

  TAILSCALE_SOCKET="$tailscale_socket" \
    node server-tools/tailscale-pg-bridge.mjs &
  bridge_pid=$!

  database_attempt=0
  until node server-tools/check-database.mjs; do
    database_attempt=$((database_attempt + 1))
    if [ "$database_attempt" -ge 18 ] || ! kill -0 "$bridge_pid" 2>/dev/null; then
      echo "The Ubuntu database is not reachable through the private network." >&2
      exit 1
    fi
    echo "Waiting for the Ubuntu database..."
    sleep 5
  done
fi

if [ "${SKIP_DATABASE_MIGRATIONS:-false}" = "true" ]; then
  echo "Hosted database migrations are disabled; Ubuntu owns the migration workflow."
else
  node server-tools/migrate.mjs
fi

if [ -n "$tailscaled_pid" ]; then
  node server.js &
  app_pid=$!

  child_is_running() {
    child_pid="$1"
    if ! kill -0 "$child_pid" 2>/dev/null || [ ! -r "/proc/$child_pid/stat" ]; then
      return 1
    fi
    read -r _ _ child_state _ < "/proc/$child_pid/stat"
    [ "$child_state" != "Z" ]
  }

  while child_is_running "$app_pid" \
    && child_is_running "$bridge_pid" \
    && child_is_running "$tailscaled_pid"; do
    sleep 2
  done

  if ! child_is_running "$app_pid"; then
    set +e
    wait "$app_pid"
    app_exit_code=$?
    set -e
    exit "$app_exit_code"
  fi

  echo "The private database network stopped; restarting the service." >&2
  exit 1
fi

trap - EXIT HUP INT TERM
exec node server.js
