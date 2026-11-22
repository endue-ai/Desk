#!/usr/bin/env bash
# Verify the signature, then download and run exactly those bytes as a non-root Debian user.
set -euo pipefail
dist="$(cd "${1:?release directory}" && pwd -P)"
version="${2:?release version}"
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
archive="$dist/endue-cli_${version}_linux-x86_64.tar.gz"
node "$root/scripts/release-verify.mjs" "$archive" --pubkey "${DESK_UPDATER_PUBKEY:?missing trusted public key}" --version "$version"
digest="$(node -e 'const fs=require("node:fs"), c=require("node:crypto"); console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$archive")"
fixture="$(docker run --rm -d --network none --read-only --user 65534:65534 \
  --mount "type=bind,src=$dist,dst=/downloads,readonly" \
  --mount "type=bind,src=$root/examples/brain-echo,dst=/src/examples/brain-echo,readonly" \
  --mount "type=bind,src=$root/e2e/smoke/cli-release-fixture.mjs,dst=/src/e2e/smoke/cli-release-fixture.mjs,readonly" \
  node:22-bookworm-slim node /src/e2e/smoke/cli-release-fixture.mjs /downloads)"
trap 'docker stop -t 2 "$fixture" >/dev/null' EXIT
for _ in {1..40}; do
  if docker logs "$fixture" 2>&1 | grep -q 'CLI fixture ready'; then break; fi
  sleep 0.25
done
docker run --rm --platform linux/amd64 --network "container:$fixture" --read-only \
  --user 65534:65534 --tmpfs /tmp:exec,mode=1777 \
  --mount "type=bind,src=$root/e2e/smoke,dst=/smoke,readonly" \
  --env ENDUE_BRAIN_URL=http://127.0.0.1:8787/v0 debian:bookworm-slim \
  /smoke/cli-install.sh http://127.0.0.1:8788 "$version" "$digest"
