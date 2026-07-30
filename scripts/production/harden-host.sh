#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
load_config
for command in docker python3 sha256sum ss tar ufw; do
  require_command "$command"
done

apply=false
console_confirmed=false
for argument in "$@"; do
  case "$argument" in
    --check) ;;
    --apply) apply=true ;;
    --confirm-local-console) console_confirmed=true ;;
    *) die "Usage: $0 [--check|--apply] [--confirm-local-console]" ;;
  esac
done

[[ -n "$AXORA_MANAGEMENT_CIDR" ]] \
  || die "Set AXORA_MANAGEMENT_CIDR to the real trusted management network; no default is assumed."
python3 -c 'import ipaddress,sys; ipaddress.ip_network(sys.argv[1], strict=False)' "$AXORA_MANAGEMENT_CIDR" \
  || die "AXORA_MANAGEMENT_CIDR is not a valid IPv4 or IPv6 network."
if [[ ! "$AXORA_SSH_PORT" =~ ^[0-9]+$ ]] \
  || (( AXORA_SSH_PORT < 1 || AXORA_SSH_PORT > 65535 )); then
  die "AXORA_SSH_PORT is invalid."
fi
ss -H -ltn "sport = :$AXORA_SSH_PORT" | grep -q . \
  || die "No TCP listener was found on configured SSH port $AXORA_SSH_PORT."
if docker ps --format '{{.Names}}\t{{.Ports}}' \
  | grep -Eq '(^|[[:space:],])(0\.0\.0\.0:|\[::\]:)'; then
  die "A Docker container publishes a port on all host interfaces; remove that exposure before enabling UFW."
fi

if [[ -n "${SSH_CONNECTION:-}" ]]; then
  ssh_source="${SSH_CONNECTION%% *}"
  python3 - "$ssh_source" "$AXORA_MANAGEMENT_CIDR" <<'PY' \
    || die "Current SSH client is outside AXORA_MANAGEMENT_CIDR; refusing to change the firewall."
import ipaddress
import sys
raise SystemExit(0 if ipaddress.ip_address(sys.argv[1]) in ipaddress.ip_network(sys.argv[2], strict=False) else 1)
PY
elif ! "$console_confirmed"; then
  die "No SSH connection was detected. Re-run from the physical console with --confirm-local-console."
fi

log "Firewall plan: deny incoming/routed traffic, allow outgoing traffic, and allow TCP/$AXORA_SSH_PORT only from $AXORA_MANAGEMENT_CIDR."
log "No public rules will be added for HTTP, HTTPS, PostgreSQL, Docker, CUPS, or internal services."
if ! "$apply"; then
  log "Check passed. Re-run with --apply after confirming physical-console recovery access."
  exit 0
fi

snapshot_dir="$AXORA_STATE_ROOT/firewall-snapshots/$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$snapshot_dir"
ufw status verbose > "$snapshot_dir/ufw-status.txt" 2>&1 || true
ufw show raw > "$snapshot_dir/ufw-raw.txt" 2>&1 || true
tar --create --gzip --file "$snapshot_dir/etc-ufw.tar.gz" --directory /etc ufw
sha256sum "$snapshot_dir/ufw-status.txt" "$snapshot_dir/ufw-raw.txt" "$snapshot_dir/etc-ufw.tar.gz" \
  > "$snapshot_dir/checksums.sha256"
chmod 0600 "$snapshot_dir"/*

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw default deny routed
ufw allow from "$AXORA_MANAGEMENT_CIDR" to any port "$AXORA_SSH_PORT" proto tcp comment 'Axora management SSH'
ufw --force enable

ufw_status="$(ufw status verbose)"
grep -Fq 'Status: active' <<< "$ufw_status" || die "UFW did not become active."
grep -Fq "$AXORA_MANAGEMENT_CIDR" <<< "$ufw_status" || die "Management SSH rule is missing after activation."
log "Host firewall hardened. CUPS remains installed but is blocked from inbound networks."
log "Pre-change firewall snapshot: $snapshot_dir"
