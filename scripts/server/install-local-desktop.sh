#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

DESKTOP_USER="ashraf"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RESOURCE_DIR="$SCRIPT_DIR/desktop"
LOG_FILE="/var/log/axora-desktop-install.log"
LOCK_FILE="/run/lock/axora-desktop-install.lock"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '\n[Axora desktop] %s\n' "$*"
}

[[ "$EUID" -eq 0 ]] \
  || fail "Run this installer with: sudo bash $SCRIPT_DIR/install-local-desktop.sh"

exec > >(tee -a "$LOG_FILE") 2>&1
exec 9>"$LOCK_FILE"
flock -n 9 || fail "Another desktop installation is already running."

DESKTOP_ENTRY="$(getent passwd "$DESKTOP_USER")"
[[ -n "$DESKTOP_ENTRY" ]] || fail "Linux user $DESKTOP_USER does not exist."
DESKTOP_HOME="$(cut -d: -f6 <<<"$DESKTOP_ENTRY")"
DESKTOP_GROUP="$(id -gn "$DESKTOP_USER")"
[[ "$DESKTOP_HOME" == "/home/$DESKTOP_USER" ]] \
  || fail "Unexpected home directory for $DESKTOP_USER: $DESKTOP_HOME"

# shellcheck source=/dev/null
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "26.04" ]] \
  || fail "This installer was audited for Ubuntu 26.04 only."

for resource in \
  50-axora-desktop.conf \
  helpers.rc \
  mimeapps.list \
  whatsapp-web.desktop \
  xfce4-panel.xml; do
  [[ -r "$RESOURCE_DIR/$resource" ]] || fail "Missing installer resource: $resource"
done

systemctl is-active --quiet systemd-networkd \
  || fail "systemd-networkd is not active; refusing to risk server connectivity."
systemctl is-active --quiet docker \
  || fail "Docker is not active; refusing to modify the Axora host."
dpkg --audit | grep -q . \
  && fail "dpkg reports an unfinished package operation. Repair it before continuing."
apt-get check >/dev/null

AVAILABLE_KIB="$(df --output=avail / | tail -n 1 | tr -d ' ')"
[[ "$AVAILABLE_KIB" =~ ^[0-9]+$ && "$AVAILABLE_KIB" -ge 5242880 ]] \
  || fail "At least 5 GiB of free space is required."

if ! grep -Rqs '^connected$' /sys/class/drm/card*-*/status; then
  fail "No connected monitor was detected."
fi

PACKAGES=(
  alsa-utils
  atril
  dbus-x11
  fonts-liberation
  fonts-noto-color-emoji
  fonts-noto-core
  gimp
  gnome-keyring
  gvfs-backends
  gvfs-fuse
  hunspell-en-us
  libgl1-mesa-dri
  libpam-gnome-keyring
  libreoffice-calc
  libreoffice-draw
  libreoffice-gtk3
  libreoffice-impress
  libreoffice-writer
  lightdm
  lightdm-gtk-greeter
  mate-polkit
  mesa-vulkan-drivers
  pavucontrol
  pdfarranger
  pipewire-audio
  python3-img2pdf
  ristretto
  shotcut
  thunar-volman
  tumbler
  vlc
  wireplumber
  xdg-user-dirs-gtk
  xfce4
  xfce4-notifyd
  xfce4-power-manager
  xfce4-screensaver
  xfce4-terminal
  xfce4-whiskermenu-plugin
  xserver-xorg
  xserver-xorg-video-amdgpu
  xubuntu-artwork
  xubuntu-default-settings
)

info "Refreshing Ubuntu package metadata"
apt-get update

info "Installing the XFCE desktop and the requested essential applications"
printf 'lightdm shared/default-x-display-manager select lightdm\n' \
  | debconf-set-selections
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  "${PACKAGES[@]}"

info "Installing Canonical Chromium for the WhatsApp desktop launcher"
if ! snap list chromium >/dev/null 2>&1; then
  snap install chromium --channel=latest/stable
fi

[[ -x /snap/bin/chromium ]] || fail "Chromium was not installed correctly."

info "Applying the local-login and desktop settings"
install -d -m 0755 /etc/lightdm/lightdm.conf.d
install -m 0644 \
  "$RESOURCE_DIR/50-axora-desktop.conf" \
  /etc/lightdm/lightdm.conf.d/50-axora-desktop.conf

install -d -o "$DESKTOP_USER" -g "$DESKTOP_GROUP" -m 0755 \
  "$DESKTOP_HOME/Desktop" \
  "$DESKTOP_HOME/.config" \
  "$DESKTOP_HOME/.config/xfce4" \
  "$DESKTOP_HOME/.config/xfce4/xfconf" \
  "$DESKTOP_HOME/.config/xfce4/xfconf/xfce-perchannel-xml" \
  "$DESKTOP_HOME/.local" \
  "$DESKTOP_HOME/.local/share" \
  "$DESKTOP_HOME/.local/share/applications"

PANEL_TARGET="$DESKTOP_HOME/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml"
if [[ ! -e "$PANEL_TARGET" ]]; then
  install -o "$DESKTOP_USER" -g "$DESKTOP_GROUP" -m 0600 \
    "$RESOURCE_DIR/xfce4-panel.xml" \
    "$PANEL_TARGET"
else
  info "Preserving the existing XFCE panel layout"
fi

HELPERS_TARGET="$DESKTOP_HOME/.config/xfce4/helpers.rc"
if [[ ! -e "$HELPERS_TARGET" ]]; then
  install -o "$DESKTOP_USER" -g "$DESKTOP_GROUP" -m 0600 \
    "$RESOURCE_DIR/helpers.rc" \
    "$HELPERS_TARGET"
fi

MIME_TARGET="$DESKTOP_HOME/.config/mimeapps.list"
if [[ ! -e "$MIME_TARGET" ]]; then
  install -o "$DESKTOP_USER" -g "$DESKTOP_GROUP" -m 0600 \
    "$RESOURCE_DIR/mimeapps.list" \
    "$MIME_TARGET"
fi

install -o "$DESKTOP_USER" -g "$DESKTOP_GROUP" -m 0644 \
  "$RESOURCE_DIR/whatsapp-web.desktop" \
  "$DESKTOP_HOME/.local/share/applications/whatsapp-web.desktop"
install -o "$DESKTOP_USER" -g "$DESKTOP_GROUP" -m 0755 \
  "$RESOURCE_DIR/whatsapp-web.desktop" \
  "$DESKTOP_HOME/Desktop/WhatsApp.desktop"

info "Preventing desktop sleep from taking the production server offline"
systemctl mask \
  sleep.target \
  suspend.target \
  hibernate.target \
  hybrid-sleep.target \
  suspend-then-hibernate.target

systemctl set-default graphical.target
systemctl enable lightdm.service

info "Starting the graphical login on the connected monitor"
systemctl start lightdm.service

info "Verifying the desktop without changing Axora networking"
systemctl is-active --quiet lightdm
systemctl is-active --quiet docker
systemctl is-active --quiet systemd-networkd
systemctl is-enabled --quiet systemd-networkd

if systemctl is-active --quiet NetworkManager 2>/dev/null; then
  fail "NetworkManager unexpectedly became active."
fi

for package in \
  atril \
  gimp \
  libreoffice-writer \
  lightdm \
  pdfarranger \
  pipewire-audio \
  ristretto \
  shotcut \
  vlc \
  xfce4-session; do
  dpkg-query -W -f='${Status}' "$package" 2>/dev/null \
    | grep -qx 'install ok installed' \
    || fail "Required package did not install correctly: $package"
done

snap list chromium >/dev/null

printf '\nDesktop installation complete.\n'
printf 'Log in as %s on the connected monitor.\n' "$DESKTOP_USER"
printf 'WhatsApp is available from the desktop icon and application menu.\n'
printf 'Installation log: %s\n' "$LOG_FILE"
