#!/usr/bin/env bash
# Install smoke.
#   e2e/smoke/install-and-launch.sh [<package>]        (or DESK_SMOKE_PACKAGE=<package>)
# With a package of the desk (#46), install it the way a person would, into a folder of the
# run's own where the OS allows: a .dmg or an .app.tar.gz (or an .app) into a temp Applications
# folder on macOS; an NSIS -setup.exe (silent, per user) or an .msi into a temp folder on Windows; a
# .deb with apt, or an AppImage run in place, on Linux. Its code signature is checked
# (`verify-signature.sh --code`; ad-hoc or unsigned passes unless DESK_REQUIRE_SIGNED=1) and so is
# the package's updater signature when DESK_UPDATER_PUBKEY is set. The download and installed sizes
# are printed and added to e2e/test-results/smoke-sizes.txt (and the run's summary in Actions).
# Without one, it builds the desk (`just build-shell`) and launches that build, as the app e2e does
# (ADR 0144): the .app bundle's binary on macOS, target/debug/endue-desk(.exe) elsewhere. Nothing is
# installed or checked then.
# Either way the app starts with a temp HOME and e2e/fixtures/init.yaml, the script waits for the ready
# line it prints (desk_ready) and quits it with SIGTERM. Exits 0 only when every step passed;
# otherwise it names the step that failed. `just smoke` runs it; the e2e workflow runs that under
# xvfb-run, and release-build.yml runs it on each package it builds.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
results="$root/e2e/test-results"
package="${1:-${DESK_SMOKE_PACKAGE:-}}"
ready_within=60
quit_within=10

step="start"
pkg=""
pid=""
home=""
work=""
uninstall=""
app=""
installed=""
sudo=""
if [ "$(id -u)" -ne 0 ]; then sudo="sudo"; fi

fail() {
  echo "smoke: $step failed: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  if [ -n "$uninstall" ]; then eval "$uninstall" >/dev/null 2>&1 || true; fi
  if [ -n "$pkg" ]; then $sudo apt-get remove -y "$pkg" >/dev/null 2>&1 || true; fi
  if [ -n "$home" ]; then rm -rf "$home"; fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
}
trap cleanup EXIT

kib() { du -sk "$1" | cut -f1; }

# Install `$package` into `$work`; sets app (what to launch) and installed (what it put on disk).
install_package() {
  [ -e "$package" ] || fail "no package at $package"
  work="$(mktemp -d)"
  case "$package" in
    *.dmg)
      mkdir -p "$work/mnt" "$work/Applications"
      hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$work/mnt" "$package" >/dev/null ||
        fail "hdiutil could not attach $package"
      local found=("$work/mnt/"*.app)
      [ -d "${found[0]}" ] || fail "no .app on the disk image"
      ditto "${found[0]}" "$work/Applications/$(basename "${found[0]}")"
      hdiutil detach "$work/mnt" >/dev/null || fail "hdiutil could not detach the disk image"
      ;;
    *.app.tar.gz)
      mkdir -p "$work/Applications"
      tar -xzf "$package" -C "$work/Applications" || fail "tar could not unpack $package"
      ;;
    *.app)
      mkdir -p "$work/Applications"
      ditto "$package" "$work/Applications/$(basename "$package")"
      ;;
    *-setup.exe)
      # NSIS: /S silent, /D the folder, last and unquoted.
      "$package" /S "/D=$(cygpath -w "$work/app")" || fail "the installer exited $?"
      uninstall="'$work/app/uninstall.exe' /S"
      installed="$work/app"
      app="$work/app/endue-desk.exe"
      ;;
    *.msi)
      msiexec //i "$(cygpath -w "$package")" //qn "INSTALLDIR=$(cygpath -w "$work/app")" ||
        fail "msiexec exited $?"
      uninstall="msiexec //x '$(cygpath -w "$package")' //qn"
      installed="$work/app"
      app="$work/app/endue-desk.exe"
      ;;
    *.deb)
      pkg="$(dpkg-deb -f "$package" Package)" || fail "cannot read the package name from $package"
      chmod 755 "$work"
      install -m 644 "$package" "$work/$pkg.deb"
      $sudo apt-get install -y "$work/$pkg.deb" || fail "apt-get install exited $?"
      app="$(command -v endue-desk)" || fail "endue-desk is not on PATH after the install"
      installed="/usr/lib/endue-desk"
      ;;
    *.AppImage)
      install -m 755 "$package" "$work/desk.AppImage"
      app="$work/desk.AppImage"
      installed="$app"
      ;;
    *) fail "$package is not a package the smoke installs (.dmg, .app.tar.gz, .app, -setup.exe, .msi, .deb, .AppImage)" ;;
  esac
  if [ -z "$app" ]; then
    local apps=("$work/Applications/"*.app)
    [ -d "${apps[0]}" ] || fail "no .app after unpacking $package"
    installed="${apps[0]}"
    # The executable the app's Info.plist names.
    local executable
    executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$installed/Contents/Info.plist")" ||
      fail "the app's Info.plist names no executable"
    app="$installed/Contents/MacOS/$executable"
  fi
  [ -x "$app" ] || fail "no desk at $app"
  echo "smoke: installed $(basename "$package") at $installed"
}

record_sizes() {
  local download installed_kib line
  download="$(wc -c <"$package" | tr -d ' ')"
  installed_kib="$(kib "$installed")"
  line="$(basename "$package"): download $((download / 1048576)) MiB ($download bytes), installed $((installed_kib / 1024)) MiB"
  echo "smoke: $line"
  mkdir -p "$results"
  echo "$line" >>"$results/smoke-sizes.txt"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- $line" >>"$GITHUB_STEP_SUMMARY"; fi
}

if [ -n "$package" ]; then
  step="install"
  echo "smoke: $step $(basename "$package")"
  install_package
  step="signature"
  case "$package" in
    *.dmg | *.msi | *-setup.exe) "$root/e2e/smoke/verify-signature.sh" --code "$package" || fail "the package's code signature" ;;
  esac
  case "$(uname -s)" in
    Darwin) "$root/e2e/smoke/verify-signature.sh" --code "$installed" || fail "the app's code signature" ;;
    MINGW* | MSYS* | CYGWIN*)
      for file in "$app" "$installed/libcef.dll"; do
        "$root/e2e/smoke/verify-signature.sh" --code "$file" || fail "the code signature of $(basename "$file")"
      done
      ;;
  esac
  # The updater's artifacts carry its signature; the first-install image (.dmg) does not.
  case "$package" in
    *.app.tar.gz | *-setup.exe | *.msi | *.AppImage | *.deb)
      "$root/e2e/smoke/verify-signature.sh" "$package" || fail "the updater signature"
      ;;
  esac
  record_sizes
else
  step="build"
  echo "smoke: $step (the desk)"
  just --justfile "$root/justfile" build-shell || fail "just build-shell exited $?"
  case "$(uname -s)" in
    Darwin) app="$root/target/bundle/endue-desk.app/Contents/MacOS/endue-desk" ;;
    MINGW* | MSYS* | CYGWIN*) app="$root/target/debug/endue-desk.exe" ;;
    *) app="$root/target/debug/endue-desk" ;;
  esac
  [ -x "$app" ] || fail "no desk at $app"
  echo "smoke: a development build: nothing to install or check (give a package to install one)"
fi

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
  # Runners have no FUSE: the AppImage unpacks itself to a temp folder and runs from there.
  if [[ "$app" == *.AppImage ]]; then export APPIMAGE_EXTRACT_AND_RUN=1; fi
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
