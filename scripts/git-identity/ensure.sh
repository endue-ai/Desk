#!/usr/bin/env bash
# Make sure this machine commits to this repository as endue-team with the identity hooks (AGENTS.md,
# Boundaries), at the start of work: Claude Code runs it at every session start (.claude/settings.json)
# and `just task-start` before a task.
#
# - Installed: silent, except that it puts this checkout's check.sh in place of an older one.
# - Not installed, on a team machine (gh's account can push to endue-ai/Desk, or
#   ENDUE_IDENTITY_TEAM=1): install for this repository and its worktrees only.
# - Not installed otherwise: only say how. A contributor's commits stay their own; they never become
#   endue-team's.
#
# usage: scripts/git-identity/ensure.sh   (never fails the session or the task it starts)
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
version() { sed -n 's/^IDENTITY_VERSION=\([0-9][0-9]*\).*/\1/p' "$1" 2>/dev/null | head -1; }

hooks="$(git config --get core.hooksPath || true)"
if [ "$(git config --get user.email)" = team@endue.ai ] && [ -n "$hooks" ] && [ -f "$hooks/check.sh" ]; then
  new="$(version "$here/check.sh")"
  old="$(version "$hooks/check.sh")"
  if [ -n "$new" ] && { [ -z "$old" ] || [ "$new" -gt "$old" ]; }; then
    install -m 0755 "$here/check.sh" "$hooks/check.sh" &&
      echo "git-identity: the identity hooks now run version $new"
  fi
  exit 0
fi

team="${ENDUE_IDENTITY_TEAM:-}"
if [ -z "$team" ]; then
  team=0
  if command -v gh >/dev/null 2>&1 &&
    [ "$(gh api repos/endue-ai/Desk --jq .permissions.push 2>/dev/null)" = true ]; then team=1; fi
fi
if [ "$team" = 1 ]; then
  root="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
  if bash "$here/install.sh" --root "$root" >/dev/null; then
    echo "git-identity: installed for $root: commits as endue-team, identity hooks on (AGENTS.md)"
  else
    echo "git-identity: install failed; run 'just identity' before committing (AGENTS.md, Boundaries)"
  fi
else
  echo "git-identity: not installed. Team members run 'just identity' before committing (AGENTS.md)."
fi
exit 0
