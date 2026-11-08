#!/usr/bin/env bash
# Give every repository under one folder the endue commit identity: user endue-team <team@endue.ai>,
# no identity guessed from the host name, and check.sh as its pre-commit, commit-msg and pre-push
# hooks. The repositories need nothing of their own; a clone made there later has it at once.
# Personal strings go to this machine's config only, never to a repository.
#
# usage: scripts/git-identity/install.sh [--root <folder>] [--block <text>]... [--block-strict <text>]...
#   --root          the folder (default ~/Project/endue)
#   --block         refused in every repository's commits (a personal email or account name)
#   --block-strict  refused in GitHub endue-ai repositories too (a personal name)
# Run it again to add strings; it keeps what is there.
set -euo pipefail

root="$HOME/Project/endue"
block=()
strict=()
while [ $# -gt 0 ]; do
  case "$1" in
    --root) root="${2:?--root needs a folder}"; shift 2 ;;
    --block) block+=("${2:?--block needs a string}"); shift 2 ;;
    --block-strict) strict+=("${2:?--block-strict needs a string}"); shift 2 ;;
    *) echo "install.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done
root="$(cd "$root" && pwd)/"

here="$(cd "$(dirname "$0")" && pwd)"
hooks="$HOME/.config/git/endue-hooks"
conf="$HOME/.config/git/endue.gitconfig"

mkdir -p "$hooks"
install -m 0755 "$here/check.sh" "$hooks/check.sh"
for name in pre-commit commit-msg pre-push; do
  printf '#!/usr/bin/env bash\nexec "$(dirname "$0")/check.sh" %s "$@"\n' "$name" >"$hooks/$name"
  chmod 0755 "$hooks/$name"
done

git config --file "$conf" user.name endue-team
git config --file "$conf" user.email team@endue.ai
git config --file "$conf" user.useConfigOnly true
git config --file "$conf" core.hooksPath "$hooks"
add() { # add a value to a multi-valued key once
  git config --file "$conf" --fixed-value --get "$1" "$2" >/dev/null 2>&1 || git config --file "$conf" --add "$1" "$2"
}
for s in "${block[@]+"${block[@]}"}"; do add endue.block "$s"; done
for s in "${strict[@]+"${strict[@]}"}"; do add endue.blockStrict "$s"; done

key="includeIf.gitdir:$root.path"
if [ "$(git config --global --get "$key" || true)" != "$conf" ]; then git config --global "$key" "$conf"; fi

echo "endue identity: $root uses $conf"
echo "  hooks: $hooks"
echo "  blocked everywhere: $(git config --file "$conf" --get-all endue.block | wc -l | tr -d ' ') string(s);" \
  "in GitHub endue-ai too: $(git config --file "$conf" --get-all endue.blockStrict | wc -l | tr -d ' ')"
