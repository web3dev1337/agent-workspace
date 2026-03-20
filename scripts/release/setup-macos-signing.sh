#!/usr/bin/env bash
set -euo pipefail

require_signing="${REQUIRE_MACOS_SIGNING:-false}"
require_signing="$(printf '%s' "$require_signing" | tr '[:upper:]' '[:lower:]')"

decode_base64_to_file() {
  local encoded="$1"
  local output_path="$2"

  if printf '%s' "$encoded" | base64 --decode > "$output_path" 2>/dev/null; then
    return 0
  fi

  printf '%s' "$encoded" | base64 -D > "$output_path"
}

has_cert=false
if [[ -n "${APPLE_CERTIFICATE:-}" && -n "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
  has_cert=true
fi

has_notary_api=false
if [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY_BASE64:-}" ]]; then
  has_notary_api=true
fi

has_notary_apple_id=false
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  has_notary_apple_id=true
fi

if [[ "$has_cert" != true ]]; then
  if [[ "$require_signing" == "true" ]]; then
    echo "::error::Tag releases require APPLE_CERTIFICATE and APPLE_CERTIFICATE_PASSWORD secrets."
    exit 1
  fi
  echo "::notice::Skipping macOS signing setup because certificate secrets are not configured."
  exit 0
fi

if [[ "$has_notary_api" != true && "$has_notary_apple_id" != true ]]; then
  if [[ "$require_signing" == "true" ]]; then
    echo "::error::Tag releases require notarization credentials. Set either APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_BASE64 or APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID."
    exit 1
  fi
  echo "::notice::Skipping notarization configuration because notarization secrets are not configured."
fi

if [[ -z "${RUNNER_TEMP:-}" || -z "${GITHUB_ENV:-}" ]]; then
  echo "::error::RUNNER_TEMP and GITHUB_ENV must be available in GitHub Actions."
  exit 1
fi

cert_path="$RUNNER_TEMP/agent-workspace-macos-signing.p12"
keychain_path="$RUNNER_TEMP/agent-workspace-signing.keychain-db"
keychain_password="${KEYCHAIN_PASSWORD:-agent-workspace-$(date +%s)-$$}"

decode_base64_to_file "$APPLE_CERTIFICATE" "$cert_path"

security create-keychain -p "$keychain_password" "$keychain_path"
security set-keychain-settings -lut 21600 "$keychain_path"
security unlock-keychain -p "$keychain_password" "$keychain_path"
security import "$cert_path" \
  -k "$keychain_path" \
  -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security \
  -T /usr/bin/productbuild
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain_path"
security list-keychains -d user -s "$keychain_path"
security default-keychain -d user -s "$keychain_path"

signing_identity="${APPLE_SIGNING_IDENTITY:-}"
if [[ -z "$signing_identity" ]]; then
  signing_identity="$(security find-identity -v -p codesigning "$keychain_path" | awk -F'"' '/Developer ID Application/ { print $2; exit }')"
fi
if [[ -z "$signing_identity" ]]; then
  signing_identity="$(security find-identity -v -p codesigning "$keychain_path" | awk -F'"' 'NR == 1 { print $2 }')"
fi
if [[ -z "$signing_identity" ]]; then
  echo "::error::Unable to resolve a macOS code-signing identity from the imported certificate."
  exit 1
fi

{
  echo "APPLE_SIGNING_IDENTITY=$signing_identity"
  echo "MACOS_SIGNING_KEYCHAIN=$keychain_path"
} >> "$GITHUB_ENV"

if [[ "$has_notary_api" == true ]]; then
  api_key_path="$RUNNER_TEMP/AuthKey_${APPLE_API_KEY}.p8"
  decode_base64_to_file "$APPLE_API_KEY_BASE64" "$api_key_path"
  {
    echo "APPLE_API_KEY_PATH=$api_key_path"
    echo "APPLE_API_KEY=$APPLE_API_KEY"
    echo "APPLE_API_ISSUER=$APPLE_API_ISSUER"
  } >> "$GITHUB_ENV"
fi

if [[ "$has_notary_apple_id" == true ]]; then
  {
    echo "APPLE_ID=$APPLE_ID"
    echo "APPLE_PASSWORD=$APPLE_PASSWORD"
    echo "APPLE_TEAM_ID=$APPLE_TEAM_ID"
  } >> "$GITHUB_ENV"
fi

echo "::notice::Configured macOS signing identity: $signing_identity"
