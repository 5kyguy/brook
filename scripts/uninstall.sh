#!/usr/bin/env bash
# Remove a Brook AppImage install created by scripts/install.sh.

set -euo pipefail

INSTALL_DIR="${BROOK_INSTALL_DIR:-${HOME}/.local/bin}"
DATA_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}"
ICON_PATH="${DATA_DIR}/icons/hicolor/256x256/apps/brook.png"
DESKTOP_PATH="${DATA_DIR}/applications/brook.desktop"

removed=0

remove_path() {
  local path="$1"
  if [ -e "$path" ] || [ -L "$path" ]; then
    rm -f "$path"
    echo "removed ${path}"
    removed=1
  fi
}

main() {
  shopt -s nullglob
  for path in "${INSTALL_DIR}"/brook "${INSTALL_DIR}"/brook.AppImage "${INSTALL_DIR}"/Brook_*.AppImage; do
    remove_path "$path"
  done
  remove_path "$DESKTOP_PATH"
  remove_path "$ICON_PATH"

  if [ "$removed" -eq 0 ]; then
    echo "No Brook install found."
  else
    echo "Brook uninstalled."
  fi
}

main "$@"
