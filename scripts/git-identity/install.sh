#!/usr/bin/env bash
# Give every repository under one folder the endue commit identity: user endue-team <team@endue.ai>,
# no identity guessed from the host name, and check.sh as its pre-commit, commit-msg and pre-push
# hooks. The repositories need nothing of their own; a clone made there later has it at once.
# Additional private checks are supplied to each Git process through ENDUE_IDENTITY_BLOCK.
#
# usage: scripts/git-identity/install.sh [--root <folder>]
#   --root   the folder (default ~/Project/endue)
set -euo pipefail

root="$HOME/Project/endue"
while [ $# -gt 0 ]; do
  case "$1" in
    --root) root="${2:?--root needs a folder}"; shift 2 ;;
    --block) echo "Use ENDUE_IDENTITY_BLOCK in the Git process for private comparisons." >&2; exit 2 ;;
    *) echo "install.sh: unknown argument" >&2; exit 2 ;;
  esac
done
root="$(cd "$root" 2>/dev/null && pwd)/" || { echo "Could not open the installation root." >&2; exit 1; }

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
git config --file "$conf" core.hooksPath '~/.config/git/endue-hooks'

key="includeIf.gitdir:$root.path"
if [[ "$root" == "$HOME/"* ]]; then
  old_key="$key"
  key="includeIf.gitdir:~/${root#"$HOME/"}.path"
  # Remove only the absolute include written by a previous installation for this same folder.
  if git config --global --fixed-value --get "$old_key" "$conf" >/dev/null 2>&1; then
    git config --global --fixed-value --unset-all "$old_key" "$conf"
  fi
fi
reference='~/.config/git/endue.gitconfig'
if [ "$(git config --global --get "$key" || true)" != "$reference" ]; then
  git config --global "$key" "$reference"
fi
echo "endue identity: installed the team identity and Git hooks."
