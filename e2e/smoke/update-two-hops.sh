#!/usr/bin/env bash
# Update smoke, two hops (#47, ADR 0147): a desk installed from the first build updates into the
# second through the normal updater flow, then the second into the third. The first is an older
# build (the last Tauri build, from a commit before Stage 1 of #32 ended, or a CEF one); the second and
# third are builds of the desk.
#   e2e/smoke/update-two-hops.sh <dist 1> <dist 2> <dist 3>
# Each dist is a release folder as scripts/release-collect.mjs leaves it (endue-desk_<v>_<target>.<ext>
# with its .sig), the version read from the names. The three builds must carry the updater key whose
# private half is in TAURI_SIGNING_PRIVATE_KEY (and _PASSWORD) and the origin
# http://127.0.0.1:<DESK_SMOKE_PORT>/desk (19846 unless set): the release workflow's
# DESK_UPDATER_PUBKEY and DESK_UPDATE_URL at build time. A Tauri first build that is a debug build
# reads both at run time (the script passes DESK_UPDATER_PUBKEY on and sets the origin) and needs the
# updater plugin's dangerousInsecureTransportProtocol for http.
# Steps: the R2 tree written under a temp origin (each release's release.json, the beta index
# listing the second build, all signed with the key) and served on 127.0.0.1; the first build
# installed into a folder of the run's own (macOS: its .app.tar.gz; Linux: its AppImage, run
# extracted) and started with a temp HOME and an init.yaml that follows beta; `desk update check`,
# staged, `desk update apply`, until the desk on the desk socket reports the second version and the
# installed app is that build (macOS: a CEF app, its seal checked); the third listed (serial 2) and
# the same; then the desk quits. Windows waits for the desk socket's Windows transport: there the hops
# are made from the desk's update row by hand (#61). Needs node, curl, lsof and the desk CLI (DESK_CLI, else
# `cargo build -p desk-cli`); the origin is e2e/smoke/serve-origin.mjs. Exits 0 only when both hops
# passed; otherwise it names the step.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
port="${DESK_SMOKE_PORT:-19846}"
base="http://127.0.0.1:$port/desk"
pubkey="${DESK_UPDATER_PUBKEY:-}"
wait_for=180
tab=$'\t'
step="start"
work=""
data=""
server=""

fail() {
  echo "update-two-hops: $step failed: $*" >&2
  if [ -n "$work" ] && [ -d "$work/home" ]; then
    find "$work/home" -name restart.log -exec sh -c 'echo "--- $1"; tail -20 "$1"' _ {} \; >&2
    tail -20 "$work/desk.log" >&2 2>/dev/null || true
  fi
  exit 1
}

desk_pid() {
  local socket="$1"
  [ -S "$socket" ] && lsof -t "$socket" 2>/dev/null | head -1
}

cleanup() {
  if [ -n "$data" ]; then
    local pid
    pid="$(desk_pid "$data/desk.sock" || true)"
    if [ -n "$pid" ]; then kill -TERM "$pid" 2>/dev/null || true; sleep 3; kill -KILL "$pid" 2>/dev/null || true; fi
    pkill -KILL -f "$work/Applications" 2>/dev/null || true
  fi
  if [ -n "$server" ]; then kill "$server" 2>/dev/null || true; fi
  if [ -n "$work" ] && [ -z "${DESK_SMOKE_KEEP:-}" ]; then rm -rf "$work"; fi
}
trap cleanup EXIT

[ "$#" -eq 3 ] || { echo "usage: update-two-hops.sh <dist 1> <dist 2> <dist 3>" >&2; exit 2; }
case "$(uname -s)" in
  Darwin) os=macos target=darwin-$([ "$(uname -m)" = arm64 ] && echo aarch64 || echo x86_64) ;;
  Linux) os=linux target=linux-x86_64 ;;
  *) echo "update-two-hops: the desk CLI has no Windows transport yet; make the hops by hand (#61)" >&2; exit 2 ;;
esac
[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ] || { echo "update-two-hops: TAURI_SIGNING_PRIVATE_KEY is not set" >&2; exit 2; }

# The version in a dist's canonical names.
version_of() {
  local names=("$1"/endue-desk_*_"$target"*)
  [ -e "${names[0]}" ] || fail "no endue-desk_<version>_$target file in $1"
  local name="${names[0]##*/endue-desk_}"
  echo "${name%%_"$target"*}"
}

step="setup"
dists=("$(cd "$1" && pwd)" "$(cd "$2" && pwd)" "$(cd "$3" && pwd)")
versions=("$(version_of "${dists[0]}")" "$(version_of "${dists[1]}")" "$(version_of "${dists[2]}")")
echo "update-two-hops: ${versions[0]} -> ${versions[1]} -> ${versions[2]} on $target"
cli="${DESK_CLI:-}"
if [ -z "$cli" ]; then
  cargo build -q -p desk-cli --manifest-path "$root/Cargo.toml" || fail "cargo build -p desk-cli"
  cli="$root/target/debug/desk"
fi
# A short folder: the desk socket's path under the data folder must fit in 104 bytes on macOS. Its
# real path: Tauri's updater (a Tauri first build's) refuses to replace an app whose path holds a
# symlink (/tmp on macOS).
work="$(cd "$(mktemp -d /tmp/desk-2hop-XXXXXX)" && pwd -P)"
home="$work/home"
mkdir -p "$home" "$work/origin/desk"
if [ "$os" = macos ]; then data="$home/Library/Application Support/ai.endue.desk"; else data="$home/.local/share/ai.endue.desk"; fi
sign() { pnpm --dir "$root" --filter @endue-ai/desk-app exec tauri signer sign "$1" >/dev/null || fail "tauri signer sign $1"; }

# Put release `n` on the origin and list it on beta.
publish() {
  local n="$1" v="${versions[$1]}" dir="$work/origin/desk/releases/${versions[$1]}" index="$work/origin/desk/channels/beta/index.json"
  mkdir -p "$dir" "$(dirname "$index")"
  cp "${dists[$n]}"/endue-desk_"$v"_* "$dir/"
  node "$root/scripts/release-manifest.mjs" release "$dir" --version "$v" --base "$base" \
    --notes "https://github.com/endue-ai/Desk/commits" --commit 0000000 >"$dir/release.json" || fail "release.json of $v"
  sign "$dir/release.json"
  node "$root/scripts/release-manifest.mjs" list "$index" --channel beta --release "$dir/release.json" >"$index.next" || fail "listing $v"
  mv "$index.next" "$index"
  sign "$index"
  echo "update-two-hops: $v is on beta"
}

step="origin"
publish 1
node "$root/e2e/smoke/serve-origin.mjs" "$work/origin" "$port" >"$work/origin.log" 2>&1 &
server=$!
for _ in $(seq 50); do curl -fsS "$base/channels/beta/index.json" >/dev/null 2>&1 && break; sleep 0.1; done
curl -fsS "$base/channels/beta/index.json" >/dev/null || fail "no file server on $base"

step="install"
case "$os" in
  macos)
    mkdir -p "$work/Applications"
    tar -xzf "${dists[0]}/endue-desk_${versions[0]}_$target.app.tar.gz" -C "$work/Applications" || fail "unpacking the first build"
    apps=("$work/Applications/"*.app)
    installed="${apps[0]}"
    executable() { plutil -extract CFBundleExecutable raw -o - "$installed/Contents/Info.plist"; }
    app="$installed/Contents/MacOS/$(executable)"
    ;;
  linux)
    mkdir -p "$work/Applications"
    installed="$work/Applications/endue-desk.AppImage"
    install -m 755 "${dists[0]}/endue-desk_${versions[0]}_$target.AppImage" "$installed"
    executable() { echo "endue-desk.AppImage"; }
    app="$installed"
    ;;
esac
[ -x "$app" ] || fail "no desk at $app"
cat >"$work/init.yaml" <<'YAML'
version: 0
settings:
  desk.update.channel: beta
YAML

step="launch ${versions[0]}"
(
  while read -r name; do unset "$name"; done < <(compgen -e | grep -E '^(XDG_|DESK_)' || true)
  export HOME="$home" DESK_INIT="$work/init.yaml" DESK_UPDATER_PUBKEY="$pubkey" DESK_UPDATE_URL="$base"
  if [ "$os" = linux ]; then export APPIMAGE_EXTRACT_AND_RUN=1; fi
  exec "$app"
) >"$work/desk.log" 2>&1 &

# The desk's update line (`state  version  channel  chosen`), once a desk answers on its socket.
status() { HOME="$home" "$cli" update 2>/dev/null; }

# Why the desk's last update step failed, when it did.
reason() {
  HOME="$home" "$cli" --json update 2>/dev/null |
    node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{const s=JSON.parse(t).result;if(s&&s.state==="failed")console.log(s.reason)}catch{}})'
}

# Wait until the desk's update line matches `pattern`; a failed step ends the wait.
until_status() {
  local pattern="$1" line="" why
  for ((tick = 0; tick < wait_for * 2; tick++)); do
    line="$(status || true)"
    if [[ "$line" =~ $pattern ]]; then echo "update-two-hops: $line"; return 0; fi
    if [[ "$line" == failed* ]]; then
      why="$(reason)"
      fail "the desk's update failed: ${why:-$line}"
    fi
    sleep 0.5
  done
  fail "the desk never said /$pattern/ (last: ${line:-no answer})"
}

# A version as a pattern that matches only itself.
literal() { printf '%s' "${1//./\\.}"; }

# One hop: the desk at `from` updates into `to`.
hop() {
  local from="$1" to="$2" was now
  was="$(literal "$1")"
  now="$(literal "$2")"
  step="hop $from -> $to: ready"
  until_status "^[a-z-]+$tab$was${tab}beta$tab"
  step="hop $from -> $to: check"
  HOME="$home" "$cli" update check || fail "desk update check"
  until_status "^staged$tab$was${tab}beta$tab$now\$"
  step="hop $from -> $to: apply"
  HOME="$home" "$cli" update apply || fail "desk update apply"
  step="hop $from -> $to: restart"
  until_status "^[a-z-]+$tab$now${tab}beta$tab"
  step="hop $from -> $to: installed"
  if [ "$os" = macos ]; then
    # The Tauri desk and the CEF desk both run endue-desk: the CEF framework tells them apart.
    [ -d "$installed/Contents/Frameworks/Chromium Embedded Framework.framework" ] ||
      fail "the installed app ($(executable)) carries no CEF framework: it is not the CEF desk"
    codesign --verify --deep --strict "$installed" || fail "the installed app's seal after the swap"
  fi
  local left
  left="$(find "$work/Applications" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
  [ "$left" = 1 ] || fail "$left entries beside the installed app: $(ls -A "$work/Applications")"
  echo "update-two-hops: $from -> $to ok"
}

hop "${versions[0]}" "${versions[1]}"
step="origin"
publish 2
hop "${versions[1]}" "${versions[2]}"

step="quit"
pid="$(desk_pid "$data/desk.sock" || true)"
[ -n "$pid" ] || fail "no desk serves $data/desk.sock"
kill -TERM "$pid"
for _ in $(seq 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
if kill -0 "$pid" 2>/dev/null; then fail "the desk was still running 10 s after SIGTERM"; fi
echo "update-two-hops: ok"
