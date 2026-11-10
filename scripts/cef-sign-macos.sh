#!/usr/bin/env bash
# Sign, notarise and staple the CEF desk on macOS (#46, ADR 0145). cargo-packager signs every Mach-O
# with one entitlements file and never seals the helper apps as bundles, so this signs inside out
# itself: the CEF framework's libraries, the framework, each helper app with its own entitlements
# (apps/desk/shell/packager/macos/entitlements), then the app; all under the hardened runtime.
#   scripts/cef-sign-macos.sh app <endue Desk.app>    sign, verify (--deep --strict), notarise, staple
#   scripts/cef-sign-macos.sh hook <endue Desk.app>   cargo-packager's beforeEachPackageCommand: `app`
#                                                     before the dmg format, nothing before the others
#   scripts/cef-sign-macos.sh dmg <file.dmg>          sign, notarise and staple the disk image
# Identity: APPLE_SIGNING_IDENTITY, else "-" (ad-hoc: no timestamp, nothing notarised). With
# APPLE_CERTIFICATE (a base64 .p12) and APPLE_CERTIFICATE_PASSWORD the identity comes from a keychain
# made for this run and deleted after it. Notarisation takes an App Store Connect API key
# (APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH) or an Apple ID (APPLE_ID, APPLE_PASSWORD,
# APPLE_TEAM_ID); without either it is skipped and says so, unless DESK_REQUIRE_NOTARISATION=1.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
entitlements="$root/apps/desk/shell/packager/macos/entitlements"
identity="${APPLE_SIGNING_IDENTITY:--}"
keychain=""
work=""

say() { echo "cef-sign-macos: $*"; }
fail() {
  echo "cef-sign-macos: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$keychain" ]; then security delete-keychain "$keychain" >/dev/null 2>&1 || true; fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
}
trap cleanup EXIT

# The certificate into a keychain of this run's own, which codesign is allowed to use.
import_certificate() {
  if [ -z "${APPLE_CERTIFICATE:-}" ] || [ "$identity" = "-" ]; then return; fi
  work="$(mktemp -d)"
  keychain="$work/desk-signing.keychain-db"
  local pass
  pass="$(uuidgen)"
  security create-keychain -p "$pass" "$keychain"
  security set-keychain-settings -lut 21600 "$keychain"
  security unlock-keychain -p "$pass" "$keychain"
  printf '%s' "$APPLE_CERTIFICATE" | base64 --decode >"$work/certificate.p12"
  security import "$work/certificate.p12" -k "$keychain" -P "${APPLE_CERTIFICATE_PASSWORD:-}" -T /usr/bin/codesign >/dev/null
  rm -f "$work/certificate.p12"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$pass" "$keychain" >/dev/null
  local others
  others="$(security list-keychains -d user | tr -d '"')"
  # shellcheck disable=SC2086 # one keychain path per word
  security list-keychains -d user -s "$keychain" $others
}

# The entitlements to sign with. Ad-hoc code has no Team ID, so the hardened runtime's library
# validation would refuse the ad-hoc CEF framework: a local, ad-hoc build alone also gets
# disable-library-validation, which a build signed with an identity never carries.
entitled() {
  if [ "$identity" != "-" ]; then
    printf '%s' "${1:-}"
    return
  fi
  local copy
  copy="$(mktemp "$work/entitlements.XXXXXX")"
  if [ -n "${1:-}" ]; then cp "$1" "$copy"; else plutil -create xml1 "$copy"; fi
  /usr/libexec/PlistBuddy -c "Add :com.apple.security.cs.disable-library-validation bool true" "$copy" >/dev/null
  printf '%s' "$copy"
}

# codesign <path> [entitlements]: the hardened runtime, a secure timestamp unless ad-hoc.
sign() {
  local args=(--force --sign "$identity" --options runtime)
  if [ "$identity" = "-" ]; then args+=(--timestamp=none); else args+=(--timestamp); fi
  if [ -n "$keychain" ]; then args+=(--keychain "$keychain"); fi
  if [ -n "${2:-}" ]; then args+=(--entitlements "$2"); fi
  codesign "${args[@]}" "$1"
}

sign_app() {
  local app="$1"
  [ -d "$app/Contents/MacOS" ] || fail "$app is not an app bundle"
  local frameworks="$app/Contents/Frameworks"
  local cef="$frameworks/Chromium Embedded Framework.framework"
  [ -d "$cef" ] || fail "$app has no Chromium Embedded Framework.framework"
  # Extended attributes (Finder info, quarantine) make codesign refuse a bundle.
  xattr -cr "$app"
  local lib helper count=0
  for lib in "$cef/Libraries/"*.dylib; do sign "$lib"; done
  sign "$cef"
  [ -n "$work" ] || work="$(mktemp -d)"
  local own
  for helper in "$frameworks/"*" Helper"*.app; do
    own=""
    case "$helper" in
      *" Helper (Renderer).app") own="$entitlements/helper-renderer.plist" ;;
      *" Helper (GPU).app") own="$entitlements/helper-gpu.plist" ;;
      *" Helper.app") own="$entitlements/helper.plist" ;;
    esac
    own="$(entitled "$own")"
    sign "$helper" "$own"
    count=$((count + 1))
  done
  [ "$count" -eq 5 ] || fail "$app holds $count helper apps, CEF needs 5"
  own="$(entitled "$entitlements/app.plist")"
  sign "$app" "$own"
  codesign --verify --deep --strict --verbose=2 "$app"
  say "signed $(basename "$app") as ${identity/#-/ad-hoc}"
}

# notarytool's credentials, or nothing when none are set.
credentials() {
  if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
    printf '%s\n' --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER"
  elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    printf '%s\n' --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
  fi
}

notarise() {
  local path="$1" creds=()
  while IFS= read -r line; do creds+=("$line"); done < <(credentials)
  if [ "$identity" = "-" ] || [ "${#creds[@]}" -eq 0 ]; then
    local why="no notarisation credentials"
    if [ "$identity" = "-" ]; then why="ad-hoc signed"; fi
    if [ "${DESK_REQUIRE_NOTARISATION:-}" = 1 ]; then fail "$(basename "$path") is not notarised: $why"; fi
    say "not notarised: $why"
    return
  fi
  local submit="$path"
  if [ -d "$path" ]; then
    [ -n "$work" ] || work="$(mktemp -d)"
    submit="$work/$(basename "$path").zip"
    ditto -c -k --keepParent --sequesterRsrc "$path" "$submit"
  fi
  local out id
  out="$(xcrun notarytool submit "$submit" "${creds[@]}" --wait --output-format json)" || true
  id="$(node -e 'try { process.stdout.write(JSON.parse(process.argv[1]).id ?? "") } catch {}' "$out")"
  if ! node -e 'process.exit(JSON.parse(process.argv[1]).status === "Accepted" ? 0 : 1)' "$out" 2>/dev/null; then
    if [ -n "$id" ]; then xcrun notarytool log "$id" "${creds[@]}" >&2 || true; fi
    fail "Apple did not accept $(basename "$path") ($out)"
  fi
  xcrun stapler staple "$path"
  xcrun stapler validate "$path"
  say "notarised and stapled $(basename "$path") ($id)"
}

mode="${1:-}"
path="${2:-}"
[ -n "$path" ] || fail "usage: cef-sign-macos.sh app|hook|dmg <path>"
case "$mode" in
  hook)
    [ "${CARGO_PACKAGER_FORMAT:-}" = dmg ] || exit 0
    import_certificate
    sign_app "$path"
    notarise "$path"
    ;;
  app)
    import_certificate
    sign_app "$path"
    notarise "$path"
    ;;
  dmg)
    [ -f "$path" ] || fail "no disk image at $path"
    if [ "$identity" = "-" ]; then
      say "$(basename "$path") left unsigned: an ad-hoc signature on a disk image proves nothing"
      notarise "$path"
      exit 0
    fi
    import_certificate
    args=(--force --sign "$identity" --timestamp)
    if [ -n "$keychain" ]; then args+=(--keychain "$keychain"); fi
    codesign "${args[@]}" "$path"
    notarise "$path"
    ;;
  *) fail "usage: cef-sign-macos.sh app|hook|dmg <path>" ;;
esac
