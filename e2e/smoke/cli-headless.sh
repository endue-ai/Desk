#!/bin/sh
# A clean Linux host supplies the CLI and the public brain-echo fixture's URL.
set -eu
cli=${1:-endue}
: "${ENDUE_BRAIN_URL:?set ENDUE_BRAIN_URL to the public echo endpoint ending in /v0}"
unset DISPLAY WAYLAND_DISPLAY ENDUE_BRAIN_TOKEN
export DESK_SOCKET=/tmp/endue-headless-no-desktop.sock
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
"$cli" run 'hello from SSH' </dev/null >"$out/answer"
printf '%s\n' 'hello from SSH' >"$out/expected"
cmp "$out/expected" "$out/answer"
status=0
"$cli" run 'tool: hello' </dev/null >"$out/answer" 2>"$out/error" || status=$?
test "$status" -eq 1
test ! -s "$out/answer"
grep -q tool "$out/error"
echo "Headless text turn and failure exit verified."
