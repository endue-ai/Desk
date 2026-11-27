# scripts/git-identity

The commit identity rule of `AGENTS.md` (Boundaries) as git hooks, for every repository under one
folder of a machine. `install.sh` sets, through an `includeIf` in the global git config:

- the identity `endue-team <team@endue.ai>`, and `user.useConfigOnly`, so git never guesses one from
  the host name;
- `check.sh` as the `pre-commit`, `commit-msg` and `pre-push` hooks (`core.hooksPath`). A repository's
  own hook of the same name still runs after it.

| Repository | Refused |
| --- | --- |
| remote on GitHub `endue-ai/*`, or no remote | any author, committer or email in a message other than `team@endue.ai` and Claude (`noreply@anthropic.com`), and private comparison values; a pushed commit may have `GitHub <noreply@github.com>` as its committer, who commits a pull request's squash merge |
| any other (GitLab) | only identities git guessed from the host name (`…@<host>.local`) |

`pre-push` checks every commit and annotated tag the push sends that the remote does not hold. For a
strict remote that is the branch's whole history, whatever the clone tracks, so an old branch can
never reach it.

Supply extra comparison values to the Git process with `ENDUE_IDENTITY_BLOCK`, one per line.
The hook reads them in memory and reports the reason for a refusal. Existing external
`endue.block` settings still apply. Setup writes home-relative Git configuration for a checkout under home.

Run it on every machine that commits to an endue repository (`just identity`). `ensure.sh` does it at
the start of work, from every Claude Code session and `just task-start`: on a team machine (gh can
push to `endue-ai/endue`) it installs for this repository, and it keeps the hooks at this checkout's
`IDENTITY_VERSION`; elsewhere it only says how. `git commit --no-verify` skips the hooks; don't.

```bash
node --test scripts/git-identity.test.mjs
```
