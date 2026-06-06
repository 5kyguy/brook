#!/usr/bin/env bash
# Install Brook from GitHub Releases (Linux AppImage).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/5kyguy/brook/main/scripts/install.sh | bash
#   BROOK_VERSION=v0.1.0 bash scripts/install.sh
#   BROOK_INSTALL_DIR=~/.local/bin bash scripts/install.sh
#
# Environment:
#   BROOK_VERSION      Release tag (e.g. v0.1.0) or "latest" (default)
#   BROOK_INSTALL_DIR  Binary directory (default: ~/.local/bin)
#   BROOK_VERIFY       Set to 1 to verify SHA256SUMS when available

set -euo pipefail

REPO="5kyguy/brook"
APP_NAME="Brook"
INSTALL_DIR="${BROOK_INSTALL_DIR:-${HOME}/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}"
ICON_DIR="${DATA_DIR}/icons/hicolor/256x256/apps"
DESKTOP_DIR="${DATA_DIR}/applications"
ICON_URL="https://raw.githubusercontent.com/${REPO}/main/backend/icons/icon.png"

err() {
  echo "brook install: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "missing required command: $1"
}

detect_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) echo "amd64" ;;
    aarch64 | arm64) echo "aarch64" ;;
    *) err "unsupported architecture: $(uname -m) (x86_64 and aarch64 only)" ;;
  esac
}

api_get() {
  curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/$1"
}

resolve_release_tag() {
  local version="${BROOK_VERSION:-latest}"
  if [ "$version" = "latest" ]; then
    api_get "repos/${REPO}/releases/latest" | jq -r .tag_name
  else
    case "$version" in
      v*) echo "$version" ;;
      *) echo "v${version}" ;;
    esac
  fi
}

find_asset() {
  local tag="$1"
  local arch="$2"
  local pattern="${APP_NAME}_.*_${arch}\\.AppImage"

  api_get "repos/${REPO}/releases/tags/${tag}" \
    | jq -r --arg pattern "$pattern" '
        .assets[]
        | select(.name | test($pattern))
        | .name + "\t" + .browser_download_url
      ' \
    | head -n 1
}

verify_checksum() {
  local appimage_path="$1"
  local filename="$2"
  local tag="$3"
  local sums_url="https://github.com/${REPO}/releases/download/${tag}/SHA256SUMS"
  local tmp_sums expected actual
  tmp_sums="$(mktemp)"
  trap 'rm -f "$tmp_sums"' RETURN

  if ! curl -fsSL "$sums_url" -o "$tmp_sums" 2>/dev/null; then
    err "BROOK_VERIFY=1 but SHA256SUMS not found for ${tag}"
  fi

  expected="$(awk -v file="$filename" '$2 == file { print $1; exit }' "$tmp_sums")"
  if [ -z "$expected" ]; then
    err "no checksum entry for ${filename} in SHA256SUMS"
  fi

  actual="$(sha256sum "$appimage_path" | awk '{ print $1 }')"
  if [ "$actual" != "$expected" ]; then
    err "checksum verification failed"
  fi
}

write_desktop_entry() {
  local appimage_path="$1"
  cat >"${DESKTOP_DIR}/brook.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Brook
Comment=Offline local music player
Exec=${appimage_path} %U
Icon=brook
Terminal=false
Categories=Audio;Music;Player;
StartupWMClass=brook
EOF
}

main() {
  if [ "$(uname -s)" != "Linux" ]; then
    err "Brook installs on Linux only."
  fi

  need_cmd curl
  need_cmd jq
  need_cmd chmod

  local arch
  arch="$(detect_arch)"

  local tag
  tag="$(resolve_release_tag)"

  local asset_line asset_name asset_url
  asset_line="$(find_asset "$tag" "$arch")"
  if [ -z "$asset_line" ]; then
    err "no AppImage found for ${tag} (${arch}). Check https://github.com/${REPO}/releases"
  fi
  asset_name="${asset_line%%$'\t'*}"
  asset_url="${asset_line#*$'\t'}"

  mkdir -p "$INSTALL_DIR" "$DESKTOP_DIR" "$ICON_DIR"

  local appimage_path="${INSTALL_DIR}/${asset_name}"
  echo "Downloading Brook ${tag} (${arch})..."
  curl -fsSL "$asset_url" -o "$appimage_path"
  chmod +x "$appimage_path"

  if [ "${BROOK_VERIFY:-0}" = "1" ]; then
    need_cmd sha256sum
    echo "Verifying checksum..."
    verify_checksum "$appimage_path" "$asset_name" "$tag"
  fi

  ln -sf "$asset_name" "${INSTALL_DIR}/brook"

  echo "Installing icon..."
  curl -fsSL "$ICON_URL" -o "${ICON_DIR}/brook.png"

  write_desktop_entry "$appimage_path"

  if ! echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
    echo
    echo "Add ${INSTALL_DIR} to your PATH, for example:"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
  fi

  echo
  echo "Brook ${tag} installed."
  echo "Launch with: brook"
  echo "Uninstall with: curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/uninstall.sh | bash"
}

main "$@"
