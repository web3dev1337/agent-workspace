#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 ]]; then
  echo "usage: $0 <app-path> [dmg-path]"
  exit 1
fi

app_path="$1"
dmg_path="${2:-}"

if [[ ! -d "$app_path" ]]; then
  echo "::error::macOS app bundle not found: $app_path"
  exit 1
fi

echo "[release] Verifying codesign for $app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"
codesign -dv --verbose=4 "$app_path"

echo "[release] Assessing Gatekeeper policy for $app_path"
spctl --assess --type execute --verbose=4 "$app_path"

echo "[release] Validating notarization staple for $app_path"
xcrun stapler validate "$app_path"

if [[ -n "$dmg_path" ]]; then
  if [[ ! -f "$dmg_path" ]]; then
    echo "::error::macOS DMG not found: $dmg_path"
    exit 1
  fi
  echo "[release] Validating notarization staple for $dmg_path"
  xcrun stapler validate "$dmg_path"
fi
