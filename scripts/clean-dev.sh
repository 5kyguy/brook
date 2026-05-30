#!/usr/bin/env bash
# Reset Brook to a clean slate for manual testing: app data (SQLite, Tauri cache),
# frontend build output, and Rust/Tauri build artifacts.
#
# Usage:
#   ./scripts/clean-dev.sh           # remove data + build (no prompt)
#   ./scripts/clean-dev.sh -f        # same (explicit)
#   ./scripts/clean-dev.sh --data-only
#   ./scripts/clean-dev.sh --build-only
#   ./scripts/clean-dev.sh --fast    # skip backend/target (quicker rebuild)
#   ./scripts/clean-dev.sh -n        # dry run — print paths only
#
# Close the running Brook app before cleaning app data.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="dev.skyguy.brook"

DATA_ONLY=false
BUILD_ONLY=false
FAST=false
DRY_RUN=false

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-only) DATA_ONLY=true ;;
    --build-only) BUILD_ONLY=true ;;
    --fast) FAST=true ;;
    -n | --dry-run) DRY_RUN=true ;;
    -f | --force) ;; # accepted for ergonomics; no prompt by default
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if $DATA_ONLY && $BUILD_ONLY; then
  echo "Use only one of --data-only or --build-only." >&2
  exit 1
fi

DO_DATA=true
DO_BUILD=true
if $DATA_ONLY; then DO_BUILD=false; fi
if $BUILD_ONLY; then DO_DATA=false; fi

removed=0

rm_path() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    if $DRY_RUN; then
      echo "would remove: $path"
    else
      rm -rf "$path"
      echo "removed: $path"
    fi
    removed=$((removed + 1))
  fi
}

app_data_dirs() {
  if [[ "${OS:-}" == "Windows_NT" ]] || [[ -n "${APPDATA:-}" && -d "${APPDATA:-}" ]]; then
    [[ -n "${APPDATA:-}" ]] && printf '%s\n' "${APPDATA}/${APP_ID}"
    [[ -n "${LOCALAPPDATA:-}" ]] && printf '%s\n' "${LOCALAPPDATA}/${APP_ID}"
    return
  fi
  if [[ "$(uname -s)" == "Darwin" ]]; then
    local home="${HOME:-}"
    printf '%s\n' \
      "${home}/Library/Application Support/${APP_ID}" \
      "${home}/Library/Caches/${APP_ID}" \
      "${home}/Library/WebKit/${APP_ID}" \
      "${home}/Library/Saved Application State/${APP_ID}.savedState"
    return
  fi
  local data_home="${XDG_DATA_HOME:-${HOME:-}/.local/share}"
  local cache_home="${XDG_CACHE_HOME:-${HOME:-}/.cache}"
  local config_home="${XDG_CONFIG_HOME:-${HOME:-}/.config}"
  printf '%s\n' \
    "${data_home}/${APP_ID}" \
    "${cache_home}/${APP_ID}" \
    "${config_home}/${APP_ID}"
}

clean_build() {
  echo "== Build artifacts =="
  rm_path "${ROOT}/frontend/dist"
  rm_path "${ROOT}/dist"
  rm_path "${ROOT}/backend/gen"
  rm_path "${ROOT}/node_modules/.vite"
  if ! $FAST; then
    rm_path "${ROOT}/backend/target"
  else
    echo "(skipped backend/target; use without --fast for a full Rust clean)"
  fi
}

clean_data() {
  echo "== App data (DB, Tauri/WebView storage, cache) =="
  while IFS= read -r dir; do
    rm_path "$dir"
  done < <(app_data_dirs)
  echo ""
  echo "UI prefs in localStorage (theme, last track id) live in the paths above when using Tauri."
  echo "Music files under \$HOME/Music are never touched."
}

echo "Brook dev clean (identifier: ${APP_ID})"
echo "Project: ${ROOT}"
echo ""

if $DO_DATA; then
  clean_data
  echo ""
fi

if $DO_BUILD; then
  clean_build
  echo ""
fi

if [[ $removed -eq 0 ]]; then
  echo "Nothing to remove — already clean."
else
  if $DRY_RUN; then
    echo "Dry run: ${removed} path(s) would be removed."
  else
    echo "Done. ${removed} path(s) removed."
    echo "Run: bun run tauri:dev"
  fi
fi
