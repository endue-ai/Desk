#!/usr/bin/env bash
# Publish verified artifacts before the signed path that advertises them. The caller holds the
# release's signing environment and the channel publication lock; "signed" only uploads what "sign"
# signed in a build that held them, and needs no secret.
set -euo pipefail

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# pnpm runs the signer in apps/desk, so it gets an absolute path, not one relative to the checkout.
sign() { pnpm --filter @endue-ai/desk-app exec tauri signer sign "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
upload() { gh release upload "$tag" "$@" --clobber --repo "$GITHUB_REPOSITORY"; }
path="$work/UPGRADE_PATH.json"

case "$1" in
  sign)
    # release-macos's build (#823): write and sign release.json and UPGRADE_PATH.json into $6 and
    # upload nothing; its attach job, which holds no secret, publishes them with "signed".
    dist="$2"
    version="$3"
    out="$6"
    mkdir -p "$out"
    node scripts/release-manifest.mjs check-files "$dist" --version "$version"
    node scripts/github-upgrade-path.mjs manifest "$dist" "$version" "$4" "${5:-}" > "$out/release.json"
    sign "$out/release.json"
    node scripts/github-upgrade-path.mjs manual "$out/release.json" > "$out/UPGRADE_PATH.json"
    sign "$out/UPGRADE_PATH.json"
    exit 0
    ;;
  signed)
    # Publish what "sign" made: the packages, then release.json, then the path that advertises them.
    dist="$2"
    version="$3"
    signed="$4"
    tag="v$version"
    node scripts/release-manifest.mjs check-files "$dist" --version "$version"
    prefix="$(node scripts/release-assets.mjs desktop-prefix "$version")"
    for name in release.json release.json.sig UPGRADE_PATH.json UPGRADE_PATH.json.sig; do
      [ -s "$signed/$name" ] || { echo "publish-upgrade-path: $signed lacks $name" >&2; exit 1; }
    done
    files=()
    for sig in "$dist"/"$prefix"*.sig; do files+=("${sig%.sig}" "$sig"); done
    upload "${files[@]}"
    upload "$signed/release.json.sig"
    upload "$signed/release.json"
    upload "$signed/UPGRADE_PATH.json.sig"
    upload "$signed/UPGRADE_PATH.json"
    exit 0
    ;;
  packages|manual)
    dist="$2"
    version="$3"
    tag="v$version"
    node scripts/release-manifest.mjs check-files "$dist" --version "$version"
    prefix="$(node scripts/release-assets.mjs desktop-prefix "$version")"
    node scripts/github-upgrade-path.mjs manifest "$dist" "$version" "$4" "${5:-}" > "$work/release.json"
    sign "$work/release.json"
    files=()
    for sig in "$dist"/"$prefix"*.sig; do files+=("${sig%.sig}" "$sig"); done
    if [[ "$1" == packages && -f "$dist/endue-cli_${version}_linux-x86_64.tar.gz" ]]; then
      cli="$dist/endue-cli_${version}_linux-x86_64.tar.gz"
      files+=("$cli" "$cli.sig" "$dist/SHA256SUMS-cli")
    fi
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
  *) echo "expected sign, signed, packages, manual or index" >&2; exit 1 ;;
esac
sign "$path"
upload "$path.sig"
upload "$path"
