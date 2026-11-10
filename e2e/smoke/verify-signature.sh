#!/usr/bin/env bash
# Signature checks of a built bundle.
#   e2e/smoke/verify-signature.sh <file> [<base64 public key>]
# The updater signature (ADR 0054): <file>.sig must be a minisign signature of <file> by the updater
# key, in the encoding `tauri signer` writes. The key is the second argument or DESK_UPDATER_PUBKEY.
# Without a key the build is unsigned (a pull request, a fork, `just smoke`): it says so and passes.
# With one, a missing or wrong signature fails, so a release never ships a bundle that does not
# verify. scripts/release-verify.mjs does the check with Node's crypto.
#   e2e/smoke/verify-signature.sh --code <app, installer or installed file>
# The OS's code signature (#46): on macOS `codesign --verify --deep --strict` of an .app (ad-hoc
# passes) or a .dmg's signature, and for a Developer ID build Gatekeeper's assessment and the stapled
# notarisation ticket; on Windows the Authenticode signature of an .exe, .msi or .dll. Linux packages
# carry the updater signature only. An unsigned or ad-hoc build says so and passes, unless
# DESK_REQUIRE_SIGNED=1 (a release built with the signing identities), which fails it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"

unsigned() {
  if [ "${DESK_REQUIRE_SIGNED:-}" = 1 ]; then
    echo "verify-signature: $1, and DESK_REQUIRE_SIGNED=1" >&2
    exit 1
  fi
  echo "verify-signature: $1"
  exit 0
}

code_macos() {
  local path="$1" name info
  name="$(basename "$path")"
  if ! info="$(codesign -dv "$path" 2>&1)"; then unsigned "$name is not signed"; fi
  case "$path" in
    *.app) codesign --verify --deep --strict --verbose=2 "$path" ;;
    *) codesign --verify --strict --verbose=2 "$path" ;;
  esac
  if grep -q '^Signature=adhoc' <<<"$info"; then unsigned "$name is ad-hoc signed (valid, not notarised)"; fi
  case "$path" in
    *.app) spctl --assess --type execute --verbose=2 "$path" ;;
    *) spctl --assess --type open --context context:primary-signature --verbose=2 "$path" ;;
  esac
  xcrun stapler validate "$path"
  echo "verify-signature: $name is signed ($(grep -m1 '^Authority=' <<<"$info" || true)), notarised and stapled"
}

code_windows() {
  local path="$1" status
  status="$(powershell -NoProfile -Command "(Get-AuthenticodeSignature -LiteralPath '$(cygpath -w "$path")').Status")"
  status="${status//$'\r'/}"
  case "$status" in
    Valid) echo "verify-signature: $(basename "$path") has a valid Authenticode signature" ;;
    NotSigned) unsigned "$(basename "$path") has no Authenticode signature" ;;
    *)
      echo "verify-signature: $(basename "$path"): Authenticode says $status" >&2
      exit 1
      ;;
  esac
}

if [ "${1:-}" = "--code" ]; then
  path="${2:?usage: verify-signature.sh --code <app, installer or installed file>}"
  [ -e "$path" ] || { echo "verify-signature: no $path" >&2; exit 1; }
  case "$(uname -s)" in
    Darwin) code_macos "$path" ;;
    MINGW* | MSYS* | CYGWIN*) code_windows "$path" ;;
    *) echo "verify-signature: $(basename "$path"): Linux packages carry the updater signature only" ;;
  esac
  exit 0
fi

file="${1:?usage: verify-signature.sh <file> [<base64 public key>] | --code <path>}"
key="${2:-${DESK_UPDATER_PUBKEY:-}}"

if [ -z "$key" ]; then
  echo "verify-signature: unsigned build: no updater key, $(basename "$file") is not checked"
  exit 0
fi
node "$root/scripts/release-verify.mjs" "$file" --pubkey "$key"
