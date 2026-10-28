#!/usr/bin/env bash
# One worktree per task, so parallel agents never share a checkout, a node_modules or a target/ dir.
#
# usage: scripts/worktree.sh start <issue> <branch>   add .claude/worktrees/ai-<issue> on <branch> from
#                                                     origin/main, install dependencies, print the path
#        scripts/worktree.sh gc                       remove task worktrees whose PR merged and that
#                                                     hold no uncommitted work
set -euo pipefail

# Worktrees live under the main checkout, also when this runs inside another worktree.
repo="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
dir="$repo/.claude/worktrees"

start() {
  local issue="${1:?usage: worktree.sh start <issue> <branch>}"
  local branch="${2:?usage: worktree.sh start <issue> <branch>}"
  local path="$dir/ai-$issue"
  if [[ -e "$path" ]]; then
    echo "worktree: $path already exists; continue there or run gc" >&2
    exit 1
  fi
  git -C "$repo" fetch --quiet origin main
  git -C "$repo" worktree add --quiet -b "$branch" "$path" origin/main
  (cd "$path" && pnpm install --frozen-lockfile --prefer-offline --silent)
  echo "$path"
}

gc() {
  local path branch state
  git -C "$repo" fetch --quiet --prune origin
  for path in "$dir"/ai-*; do
    [[ -d "$path" ]] || continue
    branch="$(git -C "$path" branch --show-current)"
    if git -C "$repo" worktree list --porcelain | grep -A3 "^worktree $path\$" | grep -q '^locked'; then
      echo "keep $path: locked by a running session"
      continue
    fi
    if [[ -n "$(git -C "$path" status --porcelain)" ]]; then
      echo "keep $path: uncommitted changes"
      continue
    fi
    state="$(gh pr list --head "$branch" --state all --json state --jq '.[0].state // ""')"
    # A closed PR may be reopened or finished by hand; only merged work is gone for good.
    if [[ "$state" != "MERGED" ]]; then
      echo "keep $path: PR ${state:-not opened}"
      continue
    fi
    git -C "$repo" worktree remove "$path"
    git -C "$repo" branch -D "$branch" >/dev/null
    echo "removed $path ($branch, merged)"
  done
}

case "${1:-}" in
  start) shift; start "$@" ;;
  gc) gc ;;
  *) echo "usage: worktree.sh start <issue> <branch> | gc" >&2; exit 1 ;;
esac
