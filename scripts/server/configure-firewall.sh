#!/usr/bin/env bash
set -Eeuo pipefail

LAN_SUBNET="${1:-}"
LAN_INTERFACE="${2:-}"
SSH_PORT="${3:-22}"
[[ "$LAN_SUBNET" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || { echo "Usage: bash configure-firewall.sh 192.168.10.0/24 enp5s0 [ssh-port]" >&2; exit 1; }
ip link show "$LAN_INTERFACE" >/dev/null 2>&1 || { echo "Interface not found: $LAN_INTERFACE" >&2; exit 1; }
[[ "$SSH_PORT" =~ ^[0-9]+$ && "$SSH_PORT" -ge 1 && "$SSH_PORT" -le 65535 ]] || { echo "Invalid SSH port." >&2; exit 1; }

printf 'LAN subnet:    %s\nLAN interface: %s\nSSH port:      %s\n' "$LAN_SUBNET" "$LAN_INTERFACE" "$SSH_PORT"
printf 'This will enable UFW and add a persistent Docker source-subnet restriction.\n'
read -r -p 'Type APPLY FIREWALL exactly to continue: ' CONFIRMATION
[[ "$CONFIRMATION" == "APPLY FIREWALL" ]] || { echo "Cancelled."; exit 1; }

sudo apt-get update
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y ufw iptables-persistent
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow proto tcp from "$LAN_SUBNET" to any port "$SSH_PORT"
sudo ufw allow proto tcp from "$LAN_SUBNET" to any port 80
sudo ufw allow proto tcp from "$LAN_SUBNET" to any port 443
sudo ufw --force enable

if ! sudo iptables -C DOCKER-USER -i "$LAN_INTERFACE" '!' -s "$LAN_SUBNET" -m conntrack --ctstate NEW -j DROP 2>/dev/null; then
  sudo iptables -I DOCKER-USER -i "$LAN_INTERFACE" '!' -s "$LAN_SUBNET" -m conntrack --ctstate NEW -j DROP
fi
sudo netfilter-persistent save
sudo ufw status verbose
sudo iptables -S DOCKER-USER

printf '\nFirewall applied. Test Axora from an approved office PC before ending this session.\n'
printf 'Do not configure router port forwarding for ports 80 or 443.\n'
