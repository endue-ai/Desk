#!/usr/bin/env bash
# Makes the RAR fixtures with RARLAB's rar for Linux (a trial version, never committed): fetches the
# two pinned releases, checks their SHA-256, writes the originals (originals.mjs) and runs
# build-rars.sh in a linux/amd64 Debian container. rar 7.23 makes the RAR 5 archives; rar 6.24, the
# last release that writes RAR 4 (-ma4), makes those. Needs curl, node and Docker.
#   make-fixtures.sh                the committed fixtures and originals.json
#   make-fixtures.sh --large <dir>  also large5.rar and large4.rar (200 MB) in <dir>, for bench.mjs
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tools=${RAR_TOOLS:-${TMPDIR:-/tmp}/desk-rar-tools}
image=debian:bookworm-slim
large=""
if [ "${1:-}" = --large ]; then large=${2:?usage: make-fixtures.sh --large <dir>}; fi

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
fetch() {
  local version=$1 want=$2 file="rarlinux-x64-$1.tar.gz"
  mkdir -p "$tools/$version"
  [ -f "$tools/$file" ] || curl -fsSL -o "$tools/$file" "https://www.rarlab.com/rar/$file"
  if [ "$(sha "$tools/$file")" != "$want" ]; then
    echo "$file does not match its pinned SHA-256" >&2
    exit 1
  fi
  tar -xzf "$tools/$file" -C "$tools/$version"
}
fetch 723 759b4b6aa0d9f77131882162951193f3a0e54bf60e1d8dc4255aa308accab588
fetch 624 88e22a8e84125c947637bbf28c746e338a0a63279d80f9f9d7373603875db1eb

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
node "$here/originals.mjs" "$work/src"
mkdir -p "$work/out" "$work/large"
if [ -n "$large" ]; then node "$here/originals.mjs" --large "$work/large"; fi

docker run --rm --platform linux/amd64 -e LANG=C.UTF-8 -e TZ=UTC \
  -v "$tools/723/rar:/r7:ro" -v "$tools/624/rar:/r6:ro" -v "$here/build-rars.sh:/build-rars.sh:ro" \
  -v "$work/src:/src" -v "$work/out:/out" -v "$work/large:/large" "$image" bash /build-rars.sh

if [ -n "$large" ]; then
  mkdir -p "$large"
  mv "$work/out/large5.rar" "$work/out/large4.rar" "$large/"
  cp "$work/large/large.bin" "$large/"
fi
rm -f "$here/fixtures/"*.rar
cp "$work/out/"*.rar "$here/fixtures/"
node "$here/originals.mjs" --hashes >"$here/fixtures/originals.json"
ls -l "$here/fixtures"
