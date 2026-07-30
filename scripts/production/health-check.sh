#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config
require_command curl

scope=all
case "${1:-}" in
  "") ;;
  --local) scope=local ;;
  --external) scope=external ;;
  --all) scope=all ;;
  *) die "Usage: $0 [--local|--external|--all]" ;;
esac

check_endpoint() {
  local base_url="$1"
  local endpoint="$2"
  local expected_status="$3"
  local label="$4"
  local response_file http_status

  response_file="$(mktemp)"
  http_status="$(
    curl \
      --silent \
      --show-error \
      --header "Host: axora.management" \
      --connect-timeout 10 \
      --max-time 20 \
      --output "$response_file" \
      --write-out '%{http_code}' \
      "$base_url$endpoint"
  )" || {
    rm -f -- "$response_file"
    die "$label request failed: $endpoint"
  }

  if [[ "$http_status" != "200" ]] || ! grep -Eq "\"status\"[[:space:]]*:[[:space:]]*\"$expected_status\"" "$response_file"; then
    rm -f -- "$response_file"
    die "$label returned an invalid response for $endpoint (HTTP $http_status)."
  fi
  rm -f -- "$response_file"
}

check_external_contract() {
  local http_headers https_headers http_status https_status location

  http_headers="$(mktemp)"
  https_headers="$(mktemp)"
  http_status="$(
    curl \
      --silent \
      --show-error \
      --connect-timeout 10 \
      --max-time 20 \
      --output /dev/null \
      --dump-header "$http_headers" \
      --write-out '%{http_code}' \
      "http://axora.management/"
  )" || {
    rm -f -- "$http_headers" "$https_headers"
    die "External HTTP redirect check could not connect."
  }
  location="$(awk 'tolower($0) ~ /^location:/ {sub(/\r$/, ""); sub(/^[^:]+:[[:space:]]*/, ""); print; exit}' "$http_headers")"
  if [[ "$http_status" != "301" && "$http_status" != "308" ]] \
    || [[ "$location" != https://axora.management* ]]; then
    rm -f -- "$http_headers" "$https_headers"
    die "External HTTP does not redirect safely to https://axora.management (HTTP $http_status)."
  fi

  https_status="$(
    curl \
      --silent \
      --show-error \
      --connect-timeout 10 \
      --max-time 20 \
      --output /dev/null \
      --dump-header "$https_headers" \
      --write-out '%{http_code}' \
      "$AXORA_PUBLIC_URL/api/health/ready"
  )" || {
    rm -f -- "$http_headers" "$https_headers"
    die "External HTTPS header check could not connect."
  }
  [[ "$https_status" == "200" ]] || {
    rm -f -- "$http_headers" "$https_headers"
    die "External HTTPS header check returned HTTP $https_status."
  }
  for header in \
    strict-transport-security \
    x-content-type-options \
    x-frame-options \
    referrer-policy; do
    if ! grep -Eiq "^${header}:" "$https_headers"; then
      rm -f -- "$http_headers" "$https_headers"
      die "External HTTPS response is missing required header: $header"
    fi
  done
  rm -f -- "$http_headers" "$https_headers"
}

local_base="http://${AXORA_ORIGIN_BIND}:${AXORA_ORIGIN_PORT}"
if [[ "$AXORA_ORIGIN_BIND" == "::1" ]]; then
  local_base="http://[::1]:${AXORA_ORIGIN_PORT}"
fi

if [[ "$scope" == "local" || "$scope" == "all" ]]; then
  check_endpoint "$local_base" "/api/health/live" "ok" "Local liveness"
  check_endpoint "$local_base" "/api/health/ready" "ready" "Local readiness"
  log "Local liveness and database readiness checks passed."
fi

if [[ "$scope" == "external" || "$scope" == "all" ]]; then
  check_endpoint "$AXORA_PUBLIC_URL" "/api/health/live" "ok" "External liveness"
  check_endpoint "$AXORA_PUBLIC_URL" "/api/health/ready" "ready" "External readiness"
  check_external_contract
  log "External HTTPS, redirect, security-header, liveness, and database readiness checks passed."
fi
