# scripts/git-identity

The commit identity rule of `AGENTS.md` (Boundaries) as git hooks, for every repository under one
folder of a machine. `install.sh` sets, through an `includeIf` in the global git config:

- the identity `endue-team <team@endue.ai>`, and `user.useConfigOnly`, so git never guesses one from
  the host name;
- `check.sh` as the `pre-commit`, `commit-msg` and `pre-push` hooks (`core.hooksPath`). A repository's
  own hook of the same name still runs after it.

| Repository | Refused |
| --- | --- |
| remote on GitHub `endue-ai/*`, or no remote | any author, committer or email in a message other than `team@endue.ai` and Claude (`noreply@anthropic.com`), and any `endue.block` string |
| any other (GitLab) | only identities git guessed from the host name (`…@<host>.local`) |

`pre-push` checks every commit and annotated tag the push sends that the remote does not hold. For a
strict remote that is the branch's whole history, whatever the clone tracks, so an old branch can
never reach it.

The strings to refuse are personal, so they live only in the machine's config
(`~/.config/git/endue.gitconfig`), never in a repository:

```bash
scripts/git-identity/install.sh --block '<personal email>' --block '<account>' --block '<name>'
```

Run it on every machine that commits to an endue repository. `git commit --no-verify` skips the
hooks; don't.

```bash
node --test scripts/git-identity.test.mjs
```
