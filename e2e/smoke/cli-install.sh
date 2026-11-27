#!/bin/sh
# Download a release candidate into an empty directory on a minimal Linux system. The caller
# supplies the digest of the archive whose version-bound publisher signature it already verified.
set -eu
base=${1:?release download directory}
version=${2:?release version}
expected=${3:?authenticated SHA-256 digest}
scripts=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
folder="endue-cli_${version}_linux-x86_64"
archive="$folder.tar.gz"
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error --location "$base/$1" --output "$1"
  else
    /usr/lib/apt/apt-helper download-file "$base/$1" "$PWD/$1" >/dev/null
  fi
}
fetch "$archive"
fetch SHA256SUMS-cli
printf '%s  %s\n' "$expected" "$archive" > authenticated-sum
cmp authenticated-sum SHA256SUMS-cli
sha256sum -c authenticated-sum
tar -xzf "$archive"
test -s "$folder/LICENSE"
test -s "$folder/THIRD-PARTY-NOTICES.txt"
test "$(readlink "$folder/bin/desk")" = endue
test "$("$folder/bin/endue" --version)" = "endue $version"
mkdir occupied
printf '%s\n' 'already installed' > occupied/desk
chmod 755 occupied/desk
if PATH="$PWD/occupied:$PATH" "$folder/bin/activate" "$PWD/occupied" >/dev/null 2>&1; then exit 1; fi
test ! -e occupied/endue
test "$(cat occupied/desk)" = 'already installed'
"$folder/bin/activate" "$PWD/bin"
PATH="$PWD/bin:$PATH"
export PATH
"$folder/bin/activate" "$PWD/bin"
"$scripts/cli-headless.sh" endue
test "$(desk run compatibility </dev/null)" = compatibility
