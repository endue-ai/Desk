#!/usr/bin/env bash
# Signature check of a built bundle (ADR 0054): <file>.sig must be a minisign signature of <file> by
# the updater key, in the encoding `tauri signer` writes. The key is the second argument or
# DESK_UPDATER_PUBKEY. Without a key the build is unsigned (a pull request, a fork, `just smoke`): it
# says so and passes. With one, a missing or wrong signature fails, so a release never ships a bundle
# that does not verify. scripts/release-verify.mjs does the check with Node's crypto.
#   e2e/smoke/verify-signature.sh <file> [<base64 public key>]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
file="${1:?usage: verify-signature.sh <file> [<base64 public key>]}"
key="${2:-${DESK_UPDATER_PUBKEY:-}}"

if [ -z "$key" ]; then
  echo "verify-signature: unsigned build: no updater key, $(basename "$file") is not checked"
  exit 0
fi
node "$root/scripts/release-verify.mjs" "$file" --pubkey "$key"
