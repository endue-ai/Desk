#!/usr/bin/env bash
# Install smoke on Linux: build the .deb (`just bundle-app`), install it with apt, check the signature
# (a stub for now), launch `endue-desk` from PATH with a temp HOME and e2e/fixtures/init.yaml, wait for
# the ready line it prints (commands/ready.rs), quit it with SIGTERM and remove the package.
# Exits 0 only when every step passed; otherwise it names the step that failed. `just smoke` runs it;
# the e2e workflow runs that under xvfb-run, and people on Linux bring their own DISPLAY.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
results="$root/e2e/test-results"
ready_within=60
quit_within=10

step="start"
pkg=""
pid=""
home=""
work=""
sudo=""
if [ "$(id -u)" -ne 0 ]; then sudo="sudo"; fi

fail() {
  echo "smoke: $step failed: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  if [ -n "$pkg" ]; then $sudo apt-get remove -y "$pkg" >/dev/null 2>&1 || true; fi
  if [ -n "$home" ]; then rm -rf "$home"; fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
}
trap cleanup EXIT

step="build"
echo "smoke: $step"
just --justfile "$root/justfile" bundle-app || fail "just bundle-app exited $?"
debs=("$root"/target/release/bundle/deb/*.deb)
[ -f "${debs[0]}" ] || fail "no .deb in target/release/bundle/deb"
deb="${debs[0]}"

step="install"
echo "smoke: $step $(basename "$deb")"
pkg="$(dpkg-deb -f "$deb" Package)" || fail "cannot read the package name from $deb"
# Tauri names the file after productName ("endue Desk"); apt gets a copy without the space.
work="$(mktemp -d)"
chmod 755 "$work"
install -m 644 "$deb" "$work/$pkg.deb"
$sudo apt-get install -y "$work/$pkg.deb" || fail "apt-get install exited $?"
app="$(command -v endue-desk)" || fail "endue-desk is not on PATH after the install"
echo "smoke: installed $pkg at $app"

step="signature"
"$root/e2e/smoke/verify-signature.sh" "$deb" || fail "verify-signature exited $?"

step="launch"
mkdir -p "$results"
out="$results/smoke.stdout.log"
err="$results/smoke.stderr.log"
home="$(mktemp -d)"
echo "smoke: $step $app (HOME=$home)"
(
  # The data folder follows HOME; nothing from the runner's desk setup leaks in.
  while read -r name; do unset "$name"; done < <(compgen -e | grep -E '^(XDG_|DESK_)' || true)
  export HOME="$home" DESK_INIT="$root/e2e/fixtures/init.yaml"
  exec "$app"
) >"$out" 2>"$err" &
pid=$!

step="ready"
for ((tick = 0; tick < ready_within * 10; tick++)); do
  if grep -q '^desk ready' "$out"; then break; fi
  if grep -q '^desk cannot reach the core' "$out"; then fail "$(grep -m1 '^desk cannot' "$out")"; fi
  kill -0 "$pid" 2>/dev/null || { wait "$pid" && code=0 || code=$?; fail "the app exited ($code) before printing a ready line"; }
  sleep 0.1
done
grep -q '^desk ready' "$out" || fail "no ready line within $ready_within s"
echo "smoke: $(grep -m1 '^desk ready' "$out")"

step="quit"
kill -TERM "$pid"
for ((tick = 0; tick < quit_within * 10; tick++)); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$pid" 2>/dev/null; then fail "the app was still running $quit_within s after SIGTERM"; fi
wait "$pid" 2>/dev/null || true
pid=""

echo "smoke: ok"
