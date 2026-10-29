#!/usr/bin/env bash
# Signature check of a built bundle. A stub: release signing is not set up yet (signing and
# notarisation arrive with the release workflows), so there is nothing to verify. It says so and passes.
set -euo pipefail

echo "verify-signature: signing is not set up yet; ${1:-the bundle} is not checked"
