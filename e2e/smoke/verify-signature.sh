#!/usr/bin/env bash
# Signature smoke, macOS: the app is signed with the hardened runtime and its entitlements, accepted by
# Gatekeeper, and its notarization ticket is stapled.
#
# usage: e2e/smoke/verify-signature.sh "<path>/endue Desk.app"
set -euo pipefail

app="${1:?usage: verify-signature.sh <app bundle>}"

codesign --verify --deep --strict --verbose=2 "$app"
codesign --display --verbose=2 "$app" 2>&1 | grep -q "flags=.*runtime" || {
  echo "verify-signature: the hardened runtime is off" >&2
  exit 1
}
entitlements="$(codesign --display --entitlements - --xml "$app" 2>/dev/null)"
for key in com.apple.security.device.audio-input com.apple.security.virtualization; do
  grep -q "$key" <<<"$entitlements" || {
    echo "verify-signature: entitlement $key is missing" >&2
    exit 1
  }
done
spctl --assess --type execute --verbose=2 "$app"
xcrun stapler validate "$app"
echo "verify-signature: $app is signed, notarized and stapled"
