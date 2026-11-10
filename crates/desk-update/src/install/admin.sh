# The administrator's step of a macOS update the desk cannot write itself (#99, ADR 0163): put the
# app in the archive the desk verified in place of the installed app, and nothing else. It runs as
# root behind macOS's prompt, as `sh -c <this> desk-update <archive> <sha256> <app> <name> <exe>`:
# the verified .app.tar.gz, its SHA-256, the installed app, the app's folder in the archive and
# its executable. It works in a folder of its own beside the app, which only root can enter, and
# reads nothing the person's account can change after the check: it copies the archive in, checks
# the copy's SHA-256, unpacks the copy, then swaps the two apps in one step (renamex_np through
# JavaScript for Automation; two moves where the volume cannot swap). Only its own words reach
# stderr, which macOS's prompt hands back to the desk as the reason.
set -u
umask 022
archive=$1 sha256=$2 app=$3 name=$4 executable=$5
fail() {
	echo "$1" >&2
	exit "$2"
}
case $name in */* | . | .. | '') fail "the update names no app" 64 ;; esac
case $executable in */* | . | .. | '') fail "the update names no executable" 64 ;; esac
case $app in /*.app) ;; *) fail "$app is not an app" 64 ;; esac
work=$(/usr/bin/mktemp -d "$(/usr/bin/dirname "$app")/.endue-desk-update.XXXXXX" 2>/dev/null) ||
	fail "no folder could be made beside $app" 73
trap '/bin/rm -rf "$work"' EXIT
cd "$work" || fail "the folder beside $app cannot be entered" 73
/bin/cp -X "$archive" update.tar.gz 2>/dev/null || fail "the update cannot be read at $archive" 66
digest=$(/usr/bin/openssl dgst -sha256 -r update.tar.gz | /usr/bin/cut -d ' ' -f 1)
[ "$digest" = "$sha256" ] || fail "the update changed after Desk checked it" 65
/usr/bin/tar -xzf update.tar.gz --no-same-owner --no-same-permissions --no-xattrs --no-acls \
	--no-fflags --no-mac-metadata 2>/dev/null || fail "the update did not unpack" 65
[ -d "$name" ] && [ ! -L "$name" ] && [ -x "$name/Contents/MacOS/$executable" ] ||
	fail "the update holds no $name with $executable" 65
# Root owns the new app: everyone who ran the old one reads and runs it, nobody else writes it.
/bin/chmod -R -P go+rX,go-w "$name" || fail "the update's permissions cannot be set" 65
/usr/bin/xattr -drs com.apple.quarantine "$name" 2>/dev/null
if /usr/bin/xattr -p com.apple.quarantine "$name/Contents/MacOS/$executable" >/dev/null 2>&1; then
	fail "the update stays quarantined" 65
fi
swap='function run(argv) { ObjC.import("stdio"); return $.renamex_np(argv[0], argv[1], 2) === 0 ? "swapped" : "failed"; }'
case $(/usr/bin/osascript -l JavaScript -e "$swap" "$name" "$app" 2>/dev/null) in
swapped) ;;
failed)
	/bin/mv "$app" previous.app 2>/dev/null || fail "$app cannot be moved" 73
	if ! /bin/mv "$name" "$app" 2>/dev/null; then
		/bin/mv previous.app "$app" 2>/dev/null
		fail "the update cannot be put in place of $app" 73
	fi
	;;
*) fail "$app cannot be swapped" 73 ;;
esac
/usr/bin/touch "$app" || :
