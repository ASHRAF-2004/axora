#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
require_command sha256sum

TARGET="${1:-}"
[[ -n "$TARGET" ]] || fail "Usage: bash scripts/server/verify-backup.sh backups/axora_DATE_TIME"
[[ -d "$TARGET" ]] || fail "Backup directory not found: $TARGET"
RESOLVED="$(realpath "$TARGET")"
BACKUP_ROOT="$(realpath backups)"
[[ "$RESOLVED" == "$BACKUP_ROOT"/* ]] || fail "The backup directory must be inside $BACKUP_ROOT"
[[ -f "$RESOLVED/checksums.sha256" ]] || fail "checksums.sha256 is missing."
[[ -f "$RESOLVED/axora.dump" ]] || fail "axora.dump is missing."

(cd "$RESOLVED" && sha256sum --check checksums.sha256)
if command -v docker >/dev/null 2>&1 && docker compose ps db --status running --quiet 2>/dev/null | grep -q .; then
  docker compose exec -T db pg_restore --list < "$RESOLVED/axora.dump" >/dev/null
fi
info "Backup checksums and archive validation passed"
