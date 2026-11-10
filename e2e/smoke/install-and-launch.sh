#!/usr/bin/env bash
# Install smoke. DESK_E2E_SHELL picks the app, as for the app e2e (ADR 0144):
# - `cef` (default): build the CEF desk (`just build-shell`) and launch its build: the .app bundle's
#   binary on macOS, target/debug/endue-desk-cef(.exe) elsewhere. It has no package to install or signature
#   to check until cargo-packager builds one (#46), so those steps say so and pass.
# - `tauri`: on Linux, build the .deb (`just bundle-app`), install it with apt, check its signature
#   against the updater key (`verify-signature.sh`; a local or pull-request build has none and says it
#   is unsigned), launch `endue-desk` from PATH, and remove the package afterwards.
# Either way the app starts with a temp HOME and e2e/fixtures/init.yaml, the script waits for the ready
# line it prints (desk_ready) and quits it with SIGTERM. Exits 0 only when every step passed;
# otherwise it names the step that failed. `just smoke` runs it; the e2e workflow runs that under
# xvfb-run, and people on Linux bring their own DISPLAY.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
results="$root/e2e/test-results"
shell="${DESK_E2E_SHELL:-cef}"
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

case "$shell" in
  cef)
    step="build"
    echo "smoke: $step (the CEF desk)"
    just --justfile "$root/justfile" build-shell || fail "just build-shell exited $?"
    case "$(uname -s)" in
      Darwin) app="$root/target/bundle/endue-desk-cef.app/Contents/MacOS/endue-desk-cef" ;;
      MINGW* | MSYS* | CYGWIN*) app="$root/target/debug/endue-desk-cef.exe" ;;
      *) app="$root/target/debug/endue-desk-cef" ;;
    esac
    [ -x "$app" ] || fail "no CEF desk at $app"
    step="install"
    echo "smoke: $step: nothing to install, the CEF desk has no package until #46"
    step="signature"
    echo "smoke: $step: unsigned build: the CEF desk is not signed until #46"
    ;;
  tauri)
    [ "$(uname -s)" = Linux ] || fail "the Tauri smoke installs the Linux .deb; use DESK_E2E_SHELL=cef here"
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
    ;;
  *) fail "DESK_E2E_SHELL is cef or tauri, not $shell" ;;
esac

step="launch"
mkdir -p "$results"
out="$results/smoke.stdout.log"
err="$results/smoke.stderr.log"
# A short HOME: on macOS the desk socket's path under Library/Application Support must fit in 104 bytes.
home="$(mktemp -d /tmp/desk-smoke-XXXXXX)"
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
