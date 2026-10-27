# Contributing to endue Desk

Thank you for helping. Start with `AGENTS.md`: it has the repository map, the commands and the rules
that people and AI agents share.

## Before you start

- For anything larger than a typo, open an issue first so the scope is agreed before code is written.
- Questions go to GitHub Discussions; security reports follow `SECURITY.md`.

## Commands

All work goes through `just`, the same entry point CI uses:

```bash
just dev       # run the desktop app
just test      # unit tests (Rust and TypeScript)
just check     # formatting, lints and types
just codegen   # regenerate types from specs/
```

Run `just check && just test` before every push.

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, `build:`, `ci:`, `chore:`, with an optional scope such as `feat(runtime):`. Release notes
  and versions are generated from these messages.
- [Developer Certificate of Origin](https://developercertificate.org/): sign off every commit with
  `git commit -s`. The sign-off certifies that you wrote the change or have the right to submit it under
  Apache-2.0. Commits without a sign-off cannot be merged.

## Pull requests

- One concern per PR. Keep it small enough to read in a few minutes.
- Files stay under 400 lines; split a file before it grows past that.
- Fill in the PR template, including the As-is → To-be table: reviewers read the table first.
- Spec changes come first in the PR: edit `specs/`, run `just codegen`, then implement.
- Tests live next to the source. A PR that changes behaviour adds or changes a test that fails without it.
- PRs are squash-merged, so the PR title becomes the commit message and must follow Conventional Commits.

## Licence

By contributing you agree that your contribution is licensed under Apache-2.0. Files in `brand/` are not
open for contributions; see `TRADEMARK.md`.
