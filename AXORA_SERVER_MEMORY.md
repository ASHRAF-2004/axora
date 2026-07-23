# Axora Ubuntu server setup (2026-07-23)

## User preferences and safety

- User prefers English and beginner-friendly, shell-matched instructions.
- Never store or repeat passwords, one-time administrator passwords, device-login codes, API keys, or private SSH keys in memory.
- User wants Codex to perform remote setup where possible; privileged Ubuntu actions require the user to type the sudo password in an interactive terminal.
- SSH output is displayed on the Windows laptop, but commands and changes are made on `axora-server`; the existing physical Ubuntu terminal is a separate session.

## Server access

- Hostname: `axora-server`.
- User: `ashraf`.
- Current Wi-Fi address: `192.168.0.39` on `wlp8s0`; this is DHCP and should be reserved in the office router before production use.
- SSH key access from Windows works with `C:\Users\ASHRAF\.ssh\axora_server_ed25519` and `ssh -i ... ashraf@192.168.0.39`.
- Do not use the password previously exposed in chat; the user should rotate it if it is still active.

## Installed software

- Ubuntu 26.04 (`resolute`), x86_64.
- Docker Engine 29.6.2 and Docker Compose v5.3.1 installed from Docker's Ubuntu repository.
- `ashraf` is in the `docker` group; a fresh SSH session can run Docker without sudo.
- Codex CLI 0.145.0 installed under `/home/ashraf/.local/bin`; `codex login status` verified `Logged in using ChatGPT`.
- Headless Codex login used device-code authentication; never save the device code.

## Axora deployment state

- Application is deployed at `/srv/axora` from the local Windows workspace `C:\Users\ASHRAF\Desktop\Axora\axora-app`.
- `.env` was configured with `LAN_IP=192.168.0.39` and `AXORA_HOST=192.168.0.39` for the current office test.
- Production secrets were generated on the server; do not store their values. The one-time file `secrets/admin_initial_password` must be deleted after the first admin account is confirmed.
- Successful services: `axora-db-1` healthy, `axora-app-1` healthy, and `axora-caddy-1` healthy.
- Database migrations `001_initial.sql` and `002_cod_only_payments.sql` completed successfully.
- App readiness endpoint returned HTTP 200 `{"status":"ready"}` from inside the app container.
- Caddy local root certificate exported to `/srv/axora/caddy-root.crt` and copied locally to `C:\Users\ASHRAF\Desktop\Axora\tmp\server-deploy\caddy-root.crt`. Install only this public root certificate on approved client PCs; never copy Caddy private keys.
- Intended URL for the current test: `https://192.168.0.39`. Browser trust/client testing is still pending. The server-side `status.sh` HTTPS curl check produced a TLS internal error even though Caddy was healthy and `openssl s_client` completed a TLS handshake; investigate/validate from an approved client after trusting the Caddy root.

## Important deployment fixes made

- Added `data/uploads` to `.dockerignore`; Docker's sender still needed elevated read access during the build, so the deployment build was run with sudo while keeping upload permissions protected.
- Added `group_add: ["1000"]` to `db`, `migrate`, and `app` services in `compose.yaml`; file-backed secrets still required readable files because PostgreSQL drops supplementary groups during initialization.
- `secrets/` remains host-private (mode 700); secret files are mode 644 so container service users can read their mounted copies. Treat the server as a single-admin machine and do not expose the directory.
- Fixed `database/init/01-run-migration.sh`: replaced the PostgreSQL psql-variable insert for `schema_migrations` with a literal using the controlled migration filename/checksum. PostgreSQL 18 left the previous `:'filename'` syntax unsubstituted.
- Updated `scripts/server/prepare-secrets.sh` to keep the host secrets directory private while producing container-readable file modes.

## Pending next actions

1. Obtain the exact administrator email and display name from the user; do not invent them.
2. Run from `/srv/axora`: `bash scripts/server/create-admin.sh <email> "<display name>"`.
3. Sign in once using the generated one-time administrator password, confirm access, then remove `secrets/admin_initial_password`.
4. Install `caddy-root.crt` in the approved client PC trusted-root store and test `https://192.168.0.39` from another office PC.
5. Reserve the server IP in the router, then apply the real LAN firewall settings only after confirming the subnet/interface.
6. Install the backup timer, create an off-SSD backup, test reboot recovery, and run `restore-test.sh` before entering real company data.

## Troubleshooting lessons

- `sudo -v` in the physical Ubuntu terminal does not authorize a separate non-interactive SSH session when sudo uses TTY-scoped timestamps. Use an interactive SSH window or run the privileged block in the same terminal.
- A visible Windows terminal/Command Prompt showing `Connection to 192.168.0.39 closed` is still displaying commands executed on the server, not changing the Windows laptop's application state.
- Avoid inline `sed`/shell commands embedded in Windows SSH quoting; use a script copied to `/tmp` when a remote command contains nested quotes.
