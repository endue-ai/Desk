#!/usr/bin/env bash
# The endue commit identity (AGENTS.md, Boundaries) as git hooks for every repository under one
# folder (install.sh). A repository whose remote is GitHub's endue-ai is strict: author, committer and
# every email in a message are team@endue.ai or Claude (noreply@anthropic.com). Any other repository
# refuses only identities git guessed (an address ending in .local) and the strings in this machine's
# `endue.block` config. `endue.blockStrict` strings are refused in strict repositories too. Neither
# list lives in the repository: install.sh writes them to the machine's own config.
#
# usage: check.sh pre-commit | commit-msg <file> | pre-push <remote> <url>   (stdin as git gives it)
set -uf -o pipefail
export LC_ALL=C

hook="${1:?usage: check.sh pre-commit | commit-msg <file> | pre-push <remote> <url>}"
shift

# strict when the URL is a GitHub endue-ai repository
strict_url() { printf '%s\n' "$1" | grep -qiE 'github\.com[:/]endue-ai/'; }

# strict when any remote is GitHub's endue-ai, or there is no remote yet
mode_here() {
  local urls
  urls="$(git remote -v 2>/dev/null | awk '{ print $2 }')"
  if [ -z "$urls" ] || strict_url "$urls"; then echo strict; else echo personal; fi
}

# Records on stdin: "I<TAB>label<TAB>Name <email>" or "M<TAB>label<TAB>message line".
# Prints each refused record and exits 1 when there is one.
scan() {
  ENDUE_BLOCK="$(git config --get-all endue.block 2>/dev/null)" \
    ENDUE_BLOCK_STRICT="$(git config --get-all endue.blockStrict 2>/dev/null)" \
    awk -F '\t' -v mode="$1" '
      function listed(s, list,   n, i, item) {
        n = split(list, item, "\n")
        for (i = 1; i <= n; i++) if (item[i] != "" && index(s, tolower(item[i])) > 0) return 1
        return 0
      }
      BEGIN {
        allowed = "^(team@endue\\.ai|noreply@anthropic\\.com)$"
        email = "[][a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]+"
        guessed = "@[a-z0-9.-]+\\.local([^a-z0-9.-]|$)"
        block = ENVIRON["ENDUE_BLOCK"]; strict = ENVIRON["ENDUE_BLOCK_STRICT"]
      }
      {
        text = $3
        for (i = 4; i <= NF; i++) text = text "\t" $i
        low = tolower(text); why = ""
        if (listed(low, block) || low ~ guessed) why = "a personal or guessed identity"
        else if (mode == "strict" && listed(low, strict)) why = "a personal name"
        else if (mode == "strict" && $1 == "I") {
          e = low; sub(/.*</, "", e); sub(/>.*/, "", e)
          if (e !~ allowed) why = "not team@endue.ai or Claude"
        } else if (mode == "strict") {
          s = low
          while (match(s, email)) {
            e = substr(s, RSTART, RLENGTH)
            if (e !~ allowed) { why = "names " e; break }
            s = substr(s, RSTART + RLENGTH)
          }
        }
        if (why != "") { bad++; if (bad <= 20) printf "  %s: %s\n    %s\n", $2, why, text }
      }
      END { if (bad > 20) printf "  ... and %d more\n", bad - 20; exit (bad > 0) }'
}

refuse() {
  {
    echo "endue identity ($1): $2 refused. Commits here may name only endue-team <team@endue.ai>"
    [ "$1" = strict ] && echo "or Claude <noreply@anthropic.com>, in the author, committer and message."
    [ "$1" = strict ] || echo "or an identity that is neither personal nor guessed by git."
    echo "Fix the commits (git commit --amend --reset-author, or a rebase) instead of skipping the check."
  } >&2
  exit 1
}

# The repository's own hook of the same name, which core.hooksPath would otherwise skip.
chain() {
  local own
  own="$(git rev-parse --git-common-dir)/hooks/$hook"
  if [ -x "$own" ]; then "$own" "$@"; fi
}

ident() { git var "$1" | sed -E 's/ [0-9]+ [-+][0-9]{4}$//'; }

case "$hook" in
  pre-commit)
    mode="$(mode_here)"
    printf 'I\tauthor\t%s\nI\tcommitter\t%s\n' "$(ident GIT_AUTHOR_IDENT)" \
      "$(ident GIT_COMMITTER_IDENT)" | scan "$mode" >&2 || refuse "$mode" "this commit"
    chain "$@"
    ;;
  commit-msg)
    mode="$(mode_here)"
    awk '/^# -+ >8 -+$/ { exit } !/^#/ { print "M\tmessage\t" $0 }' "$1" | scan "$mode" >&2 \
      || refuse "$mode" "this message"
    chain "$@"
    ;;
  pre-push)
    remote="$1" url="$2" failed=0 input="$(cat)"
    if strict_url "$url"; then mode=strict; else mode=personal; fi
    while read -r _ lsha rref rsha; do
      [ -n "${lsha:-}" ] || continue
      case "$lsha" in *[!0]*) ;; *) continue ;; esac # a deleted ref pushes no commit
      revs=("$lsha")
      case "${rsha:-0}" in
        *[!0]*) git cat-file -e "$rsha^{commit}" 2>/dev/null && revs+=("^$rsha") ;;
      esac
      # Strict checks the whole history the remote does not hold, whatever this clone tracks: an old
      # branch's commits must never reach a strict repository. Personal skips what the remote holds.
      if [ "$mode" = personal ]; then
        if git config --get "remote.$remote.url" >/dev/null; then revs+=(--not "--remotes=$remote")
        else revs+=(--not --remotes); fi
      fi
      {
        if [ "$(git cat-file -t "$lsha")" = tag ]; then # an annotated tag names its tagger
          git cat-file -p "$lsha" | awk -v h="${lsha:0:7}" '
            /^tagger / { sub(/^tagger /, ""); sub(/ [0-9]+ [-+][0-9]+$/, ""); print "I\t" h " tagger\t" $0; next }
            body { print "M\t" h " tag message\t" $0 }
            /^$/ { body = 1 }'
        fi
        git log --format='I%x09%h author%x09%an <%ae>%nI%x09%h committer%x09%cn <%ce>' "${revs[@]}"
        git log --format='%x01%h%n%B' "${revs[@]}" |
          awk '/^\001/ { h = substr($0, 2); next } { print "M\t" h " message\t" $0 }'
      } | scan "$mode" >&2 || failed=1
      [ "$failed" = 0 ] || refuse "$mode" "the push of $rref"
    done <<<"$input"
    printf '%s\n' "$input" | chain "$remote" "$url"
    ;;
  *)
    echo "check.sh: unknown hook $hook" >&2
    exit 2
    ;;
esac
