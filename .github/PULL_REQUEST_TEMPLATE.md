<!--
Title: Conventional Commits, for example "feat(runtime): restore the layout on start".
Keep every heading. scope-check reads the table and the "Closes" line; reviewers read the table first.
-->

Closes #

## Requirement

> (the issue's Requirement, verbatim)

## As-is → To-be

| Area | As-is | To-be | How to verify |
| --- | --- | --- | --- |
| | | | |

<!--
One row per observable change. Every changed file belongs to a row and every row to changed files.
"How to verify" names a test, snapshot, vector file or command and is never empty. Examples:
| UI | Settings has no Eris item | Settings > Eris item | runtime snapshot `settings-eris` |
| Behaviour | default only | uses the chosen value | test `chooses_value` |
| Spec | bridge v0 has no argument | optional argument | vector `specs/bridge/v0/vectors/...` |
| Data | none | one settings key | no migration |
-->

## Assumptions and decisions

<!-- What you assumed or decided instead of asking. To overturn one, reject the PR with one line. -->

## Out of scope

<!-- What this PR deliberately does not do. -->

## Rollback

<!-- How to undo it: revert the squash commit, plus any data or setting steps. -->

## Gate results

<!-- Local results of `just check` and `just test`; CI checks (ci, scope-check, red-on-base, security) appear below. -->
