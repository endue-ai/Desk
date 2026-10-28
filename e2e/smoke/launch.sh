#!/usr/bin/env bash
# Install smoke, macOS and Linux: start the app, wait for the runtime's ready line, then stop it.
# The app stays resident without frames (ADR 0019), so the script always ends it itself.
#
# usage: e2e/smoke/launch.sh <app binary> [seconds]
set -euo pipefail

binary="${1:?usage: launch.sh <app binary> [seconds]}"
seconds="${2:-90}"
log="$(mktemp)"

if [[ "$(uname)" == "Linux" && -z "${DISPLAY:-}" ]]; then
  xvfb-run -a "$binary" >"$log" 2>&1 &
else
  "$binary" >"$log" 2>&1 &
fi
pid=$!

for _ in $(seq "$seconds"); do
  if grep -q "^desk ready" "$log"; then
    grep "^desk ready" "$log"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "launch: the app exited before it was ready" >&2
    cat "$log" >&2
    exit 1
  fi
  sleep 1
done

echo "launch: no ready line after ${seconds}s" >&2
cat "$log" >&2
pkill -P "$pid" 2>/dev/null || true
kill "$pid" 2>/dev/null || true
exit 1
