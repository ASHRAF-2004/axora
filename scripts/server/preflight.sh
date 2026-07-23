#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"

info "Ubuntu release"
if [[ -r /etc/os-release ]]; then grep -E '^(PRETTY_NAME|VERSION_CODENAME)=' /etc/os-release; else printf 'Not running on Ubuntu.\n'; fi

info "Network addresses and interfaces"
ip -brief address 2>/dev/null || true
ip route 2>/dev/null | head -n 8 || true

info "Storage"
df -h "$PROJECT_DIR" || true

info "Required commands"
for command_name in docker openssl curl tar sha256sum; do
  if command -v "$command_name" >/dev/null 2>&1; then printf 'OK   %s\n' "$command_name"; else printf 'MISS %s\n' "$command_name"; fi
done

if command -v docker >/dev/null 2>&1; then
  info "Docker versions"
  docker --version
  docker compose version
fi

printf '\nThis report changes nothing. Use it to confirm the real LAN IP, interface, and free disk space.\n'
