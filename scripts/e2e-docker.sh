#!/usr/bin/env bash
# just test-e2e-docker: the runtime's Playwright tests in WebKit on Linux, inside the Playwright image,
# one run at a time on this machine. Many worktrees share one Mac (ADR 0015); local WebKit runs side by
# side overload it and make the snapshots flaky, and CI runs them on Linux anyway.
#
#   scripts/e2e-docker.sh [playwright args...]   for example: e2e/policies.spec.ts --workers=2
#   E2E_UPDATE=1 scripts/e2e-docker.sh ...        write new snapshots back into the checkout
#
# The checkout is copied in without node_modules, target or .git (macOS node_modules hold native
# binaries that do not run on Linux), and dependencies are installed inside the container.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('$root/packages/runtime/package.json').devDependencies['@playwright/test']")"
image="mcr.microsoft.com/playwright:v${version}-noble"
# One fixed name: a second run waits for the first instead of running beside it.
name="desk-e2e"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

while docker container inspect "$name" >/dev/null 2>&1; do
  echo "e2e-docker: another run is in progress ($name); waiting..." >&2
  sleep 5
done

args=("$@")
if [[ "${E2E_UPDATE:-}" == "1" ]]; then args+=("--update-snapshots"); fi

COPYFILE_DISABLE=1 tar -C "$root" --no-xattrs --exclude=node_modules --exclude=target --exclude=.git --exclude=test-results \
  --exclude=.claude/worktrees -cf - . |
  docker run --rm -i --name "$name" --ipc=host \
    -e CI=1 -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 -e E2E_UPDATE="${E2E_UPDATE:-}" \
    -v desk-e2e-pnpm-store:/root/.local/share/pnpm/store \
    -v "$out:/out" \
    "$image" bash -euo pipefail -c '
      mkdir -p /work && tar -xf - -C /work && cd /work
      corepack enable >/dev/null 2>&1
      pnpm install --frozen-lockfile --reporter=silent
      status=0
      pnpm --filter @endue-ai/runtime exec playwright test "$@" || status=$?
      if [[ "$E2E_UPDATE" == "1" ]]; then
        cp -R packages/runtime/e2e/__snapshots__ /out/snapshots
      fi
      exit "$status"
    ' e2e-docker "${args[@]}"

if [[ "${E2E_UPDATE:-}" == "1" && -d "$out/snapshots" ]]; then
  cp -R "$out/snapshots/." "$root/packages/runtime/e2e/__snapshots__/"
  echo "e2e-docker: snapshots written to packages/runtime/e2e/__snapshots__" >&2
fi
