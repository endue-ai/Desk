#!/usr/bin/env bash
# red-on-base: tests a PR adds or changes must FAIL on the base commit. A test that already passes
# without the PR's implementation verifies nothing.
#
# usage: scripts/red-on-base.sh <base-sha> <head-sha>
#   Run from a clean checkout of <base-sha> with dependencies installed and <head-sha> fetched.
#   LABELS (comma-separated PR labels): kind:refactor skips the check.
#
# What counts as a test, and how it runs on base:
#   *.test.ts / *.test.tsx           overlaid on base, run with vitest one file at a time
#   crates/<crate>/tests/**          overlaid on base; each top-level tests/<name>.rs runs as
#                                    `cargo test -p <crate> --test <name>`
#   other .rs files with #[test]     reported only: inline tests share the file with the
#                                    implementation, so overlaying them would bring the fix along.
#                                    Put acceptance tests in crates/<crate>/tests/ instead.
set -euo pipefail

base="${1:?usage: red-on-base.sh <base-sha> <head-sha>}"
head="${2:?usage: red-on-base.sh <base-sha> <head-sha>}"

if [[ ",${LABELS:-}," == *",kind:refactor,"* ]]; then
  echo "red-on-base: skipped (kind:refactor)"
  exit 0
fi

ts_tests=()
rust_targets=()
overlay=()
inline=()

while IFS= read -r file; do
  case "$file" in
    *.test.ts | *.test.tsx)
      ts_tests+=("$file")
      overlay+=("$file")
      ;;
    crates/*/tests/*)
      overlay+=("$file")
      rest="${file#crates/*/tests/}"
      if [[ "$rest" != */* && "$file" == *.rs ]]; then rust_targets+=("$file"); fi
      ;;
    *.rs)
      if git show "$head:$file" | grep -q '#\[test\]'; then inline+=("$file"); fi
      ;;
  esac
done < <(git diff --name-only --diff-filter=AM "$base...$head")

for file in ${inline[@]+"${inline[@]}"}; do
  echo "red-on-base: note: inline tests in $file are not checked on base (move acceptance tests to crates/<crate>/tests/)"
done

if [[ ${#ts_tests[@]} -eq 0 && ${#rust_targets[@]} -eq 0 ]]; then
  echo "red-on-base: no added or changed test files; nothing to check"
  exit 0
fi

for file in ${overlay[@]+"${overlay[@]}"}; do
  mkdir -p "$(dirname "$file")"
  git show "$head:$file" > "$file"
done

green=()
log="$(mktemp)"

for file in ${ts_tests[@]+"${ts_tests[@]}"}; do
  if pnpm exec vitest run "$file" > "$log" 2>&1; then
    green+=("$file")
  else
    echo "red-on-base: red on base (good): $file"
  fi
done

for file in ${rust_targets[@]+"${rust_targets[@]}"}; do
  crate="${file#crates/}"
  crate="${crate%%/*}"
  name="$(basename "$file" .rs)"
  if cargo test -p "$crate" --test "$name" > "$log" 2>&1; then
    green+=("$file")
  else
    echo "red-on-base: red on base (good): $file"
  fi
done

git checkout -q -- . 2>/dev/null || true
git clean -qfd -- crates packages apps plugins examples 2>/dev/null || true

if [[ ${#green[@]} -gt 0 ]]; then
  echo
  echo "red-on-base: FAIL. These tests already pass on the base commit, so they do not verify the change:"
  printf '  - %s\n' "${green[@]}"
  echo "Make each test assert the new behaviour, or label the PR kind:refactor if no behaviour changes."
  exit 1
fi

echo "red-on-base: PASS (${#ts_tests[@]} TypeScript file(s), ${#rust_targets[@]} Rust target(s) fail on base)"
