#!/usr/bin/env bash
# Publish verified artifacts before the signed path that advertises them. The caller holds the
# release's signing environment and the channel publication lock.
set -euo pipefail

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
sign() { pnpm --filter @endue-ai/desk-app exec tauri signer sign "$1"; }
upload() { gh release upload "$tag" "$@" --clobber --repo "$GITHUB_REPOSITORY"; }
path="$work/UPGRADE_PATH.json"

case "$1" in
  packages|manual)
    dist="$2"
    version="$3"
    tag="v$version"
    node scripts/github-upgrade-path.mjs manifest "$dist" "$version" "$4" "${5:-}" > "$work/release.json"
    sign "$work/release.json"
    files=()
    for sig in "$dist"/endue-desk_*.sig; do files+=("${sig%.sig}" "$sig"); done
    upload "${files[@]}"
    upload "$work/release.json.sig"
    upload "$work/release.json"
    if [[ "$1" == packages ]]; then exit 0; fi
    node scripts/github-upgrade-path.mjs manual "$work/release.json" > "$path"
    ;;
  index)
    channel="$3"
    if [[ "$channel" == stable ]]; then
      tag="v$4"
      node scripts/github-upgrade-path.mjs tag "$2" "$4" > "$path"
    else
      tag="desk-updates-$channel"
      node scripts/github-upgrade-path.mjs preview "$2" "${BASE:?missing preview artifact origin}" > "$path"
      if ! gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null; then
        gh release create "$tag" --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" \
          --title "endue $channel updates" --notes "Signed upgrade path for the $channel channel." --prerelease --latest=false
      fi
    fi
    ;;
  *) echo "expected packages, manual or index" >&2; exit 1 ;;
esac
sign "$path"
upload "$path.sig"
upload "$path"
