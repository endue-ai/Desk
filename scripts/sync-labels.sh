#!/usr/bin/env bash
# Create or update every label in .github/labels.yml with the gh CLI.
# usage: ORG=endue-ai REPO=Desk scripts/sync-labels.sh   (defaults to the current gh repository)
set -euo pipefail

file="$(cd "$(dirname "$0")/.." && pwd)/.github/labels.yml"
target=()
if [[ -n "${ORG:-}" && -n "${REPO:-}" ]]; then target=(--repo "$ORG/$REPO"); fi

unquote() { sed -E 's/^[^:]+:[[:space:]]*//; s/^"(.*)"$/\1/'; }

name="" color="" description=""
flush() {
  [[ -z "$name" ]] && return
  gh label create "$name" --color "$color" --description "$description" --force ${target[@]+"${target[@]}"}
  echo "label: $name"
  name="" color="" description=""
}

while IFS= read -r line; do
  case "$line" in
    "- name:"*) flush; name="$(printf '%s' "${line#- }" | unquote)" ;;
    "  color:"*) color="$(printf '%s' "$line" | unquote)" ;;
    "  description:"*) description="$(printf '%s' "$line" | unquote)" ;;
  esac
done < "$file"
flush
