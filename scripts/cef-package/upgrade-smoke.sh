#!/usr/bin/env bash
# e2e/smoke/install-and-launch.sh --upgrade-from <Desk.dmg> <endue.dmg>
# Exercise an installer-only upgrade with other software occupying the new name.
set -euo pipefail
[[ "$(uname -s)" == Darwin && $# == 2 ]] || { echo "usage on macOS: --upgrade-from <Desk.dmg> <endue.dmg>" >&2; exit 2; }
root="$(cd "$(dirname "$0")/../.." && pwd)"
old="$1"
new="$2"
work="$(mktemp -d /tmp/endue-upgrade-XXXXXX)"
home="$work/home"
apps="$work/Applications"
data="$home/Library/Application Support/ai.endue.desk"
mount="$work/image"
app="$apps/Studio.app/Contents/MacOS/endue-desk"
cli="${DESK_CLI:-$root/target/debug/desk}"
pid=""
mounted=false
stop() {
  if [[ -n "$pid" ]]; then kill -TERM "$pid" 2>/dev/null || true; wait "$pid" || true; pid=""; fi
}
cleanup() {
  stop
  if $mounted; then hdiutil detach "$mount" >/dev/null; fi
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$home/.desk" "$data" "$apps" "$mount"
[[ -x "$cli" ]] || cargo build --manifest-path "$root/Cargo.toml" -p desk-cli --bin desk
attach() { hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$mount" "$1" >/dev/null; mounted=true; }
detach() { hdiutil detach "$mount" >/dev/null; mounted=false; }
attach "$old"
ditto "$mount/endue Desk.app" "$apps/Studio.app"
detach
printf '%s\n' 'version: 0' 'settings: {}' >"$home/.desk/init.yaml"
printf '%s\n' '{"endue.notes":{"migrationExample":"same workspace"}}' >"$data/settings.json"
printf '%s\n' '{"version":3,"issuedAt":1767225300,"expiresAt":1767225600,"profile":{"displayName":"Fixture"}}' >"$data/account.json"
printf '%s\n' '{"version":1,"nextId":7001,"grants":[{"caller":"endue.notes","grant":{"grantId":"g7001","duration":"always","permission":{"permission":"ui:notify"},"grantedAt":"2026-11-01T00:00:00Z"}}]}' >"$data/grants.json"
# The registered account and credential service use a loopback-only fixture in this profile.
isolated() { env -i HOME="$home" PATH="$PATH" LANG=en_US.UTF-8 DESK_APP="$app" DESK_ENDUE_PLATFORM_URL=http://127.0.0.1:1 DESK_ENDUE_AUTH_URL=http://127.0.0.1:1 "$@"; }
desk() { isolated "$cli" "$@"; }
launch() {
  # Directly spawn the binary so the PID below belongs to the app, including on older macOS bash.
  env -i HOME="$home" PATH="$PATH" LANG=en_US.UTF-8 DESK_ENDUE_PLATFORM_URL=http://127.0.0.1:1 DESK_ENDUE_AUTH_URL=http://127.0.0.1:1 "$app" >"$work/app.log" 2>&1 &
  pid=$!
  for _ in {1..240}; do
    if grep -q '^desk ready' "$work/app.log" && desk ping >/dev/null 2>&1; then return; fi
    kill -0 "$pid"
    sleep .25
  done
  echo "Installed app did not become ready" >&2
  return 1
}
workspace() {
  desk --json plugin list >"$work/plugins.json"
  desk --json perm list >"$work/grants.json"
  desk plugin list --lock >"$work/lock"
  node --input-type=module - "$work" "$data" <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [work, data] = process.argv.slice(2);
const read = (dir, file) => JSON.parse(readFileSync(join(dir,file), "utf8"));
const notes = read(work,"plugins.json").result.plugins.find((plugin) => plugin.manifest.id === "endue.notes");
assert.ok(notes?.enabled === false || notes?.status === "disabled");
assert.match(readFileSync(join(work,"lock"), "utf8"), /endue\.notes/u);
assert.ok(read(work,"grants.json").result.grants.some((row) => row.grant.grantId === "g7001"));
assert.equal(read(data,"settings.json")["endue.notes"].migrationExample, "same workspace");
assert.equal(read(data,"account.json").profile.displayName, "Fixture");
JS
}
launch
desk plugin disable endue.notes >/dev/null
workspace
stop
mkdir "$apps/endue.app"
printf '%s\n' foreign >"$apps/endue.app/marker"
attach "$new"
"$mount/Install endue.command" --apps-dir "$apps"
detach
test "$(cat "$apps/endue.app/marker")" == foreign
test "$(plutil -extract CFBundleIdentifier raw -o - "$apps/Studio.app/Contents/Info.plist")" == ai.endue.desk
test "$(plutil -extract CFBundleDisplayName raw -o - "$apps/Studio.app/Contents/Info.plist")" == endue
test "$(plutil -extract CFBundleName raw -o - "$apps/Studio.app/Contents/Info.plist")" == endue
codesign --verify --strict --deep "$apps/Studio.app"
launch
workspace
isolated "$app" endue://v1/plugin/endue.explorer >"$work/link.log" 2>&1
grep -q "already running took this start's files" "$work/link.log"
for _ in {1..40}; do
  if desk --json cmd run desk.windows.list --timeout 2 >"$work/windows.json" 2>/dev/null && grep -Fq "endue.explorer" "$work/windows.json"; then
    echo "upgrade smoke: endue reopened the Desk profile, preserved the foreign app and opened Explorer"
    exit 0
  fi
  sleep .25
done
echo "The installed app did not open the Explorer link" >&2
exit 1
