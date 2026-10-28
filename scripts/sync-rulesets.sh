#!/usr/bin/env bash
# Create or update every ruleset in .github/rulesets/*.json with the gh CLI, then drop the classic
# branch protection on main, which the "main" ruleset replaces (ADR 0015). Maintainers run it by hand,
# after the workflows that answer merge_group events are on main; otherwise the queue never merges.
# usage: ORG=endue-ai REPO=Desk scripts/sync-rulesets.sh   (defaults to the current gh repository)
set -euo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)/.github/rulesets"
repo="${ORG:+$ORG/$REPO}"
repo="${repo:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

for file in "$dir"/*.json; do
  name="$(jq -r .name "$file")"
  id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"
  if [[ -n "$id" ]]; then
    gh api --method PUT "repos/$repo/rulesets/$id" --input "$file" >/dev/null
    echo "ruleset: $name (updated)"
  else
    gh api --method POST "repos/$repo/rulesets" --input "$file" >/dev/null
    echo "ruleset: $name (created)"
  fi
done

if gh api "repos/$repo/branches/main/protection" >/dev/null 2>&1; then
  gh api --method DELETE "repos/$repo/branches/main/protection"
  echo "classic branch protection on main: removed"
fi
