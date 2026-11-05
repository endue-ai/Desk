#!/usr/bin/env bash
# Create or update every ruleset in .github/rulesets/*.json with the gh CLI, then drop the classic
# branch protection on main, which the "main" ruleset replaces (ADR 0015). Maintainers run it by hand,
# after the workflows that answer merge_group events are on main; otherwise the queue never merges.
# A ruleset that names "$RELEASE_APP_ID" as a bypass actor (release, protect-release-tags; ADR 0090)
# takes the release GitHub App's id from the environment.
# usage: RELEASE_APP_ID=<id> ORG=endue-ai REPO=Desk scripts/sync-rulesets.sh   (default: the gh repository)
set -euo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)/.github/rulesets"
repo="${ORG:+$ORG/$REPO}"
repo="${repo:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
for file in "$dir"/*.json; do
  name="$(jq -r .name "$file")"
  if grep -q '"\$RELEASE_APP_ID"' "$file"; then
    if [[ ! "${RELEASE_APP_ID:-}" =~ ^[0-9]+$ ]]; then
      echo "ruleset: $name needs RELEASE_APP_ID, the release app's numeric id (docs/releasing.md)" >&2
      exit 1
    fi
    jq --argjson app "$RELEASE_APP_ID" \
      '.bypass_actors |= map(if .actor_id == "$RELEASE_APP_ID" then .actor_id = $app else . end)' \
      "$file" > "$body"
  else
    cp "$file" "$body"
  fi
  id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id")"
  if [[ -n "$id" ]]; then
    gh api --method PUT "repos/$repo/rulesets/$id" --input "$body" >/dev/null
    echo "ruleset: $name (updated)"
  else
    gh api --method POST "repos/$repo/rulesets" --input "$body" >/dev/null
    echo "ruleset: $name (created)"
  fi
done

if gh api "repos/$repo/branches/main/protection" >/dev/null 2>&1; then
  gh api --method DELETE "repos/$repo/branches/main/protection"
  echo "classic branch protection on main: removed"
fi
