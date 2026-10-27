# AGENTS.md

The entry point for AI agents and the shortest map for people. Claude Code reads it through `CLAUDE.md`;
Codex and other tools read it directly. The design source of truth is `docs/ko/desk-structure.md`; the
English summary is `docs/architecture.md`.

## Map

| Path | What lives there |
| --- | --- |
| `apps/` | `desk/`: the Tauri 2 app, a thin adapter over the Rust core |
| `crates/` | Rust workspace, prefix `desk-`: core, sys, bridge, plugin host, VM, brain adapters, CLI |
| `packages/` | TypeScript workspace, scope `@endue-ai/`: runtime, bridge, plugin-sdk, ui, create-plugin |
| `plugins/` | Built-in features written as plugins, in the same format as community plugins |
| `examples/` | The smallest working examples; each one runs with one command |
| `specs/` | Language-neutral contracts (bridge, brain, plugin, wit): the single source of truth for types |
| `e2e/` | App-level tests (tauri-driver), install smoke tests and performance budgets |
| `docs/` | Architecture, ADRs and guides; `docs/ko/` holds the Korean design documents |
| `brand/` | endue and Eris brand assets. Not Apache-2.0: see `brand/LICENSE` |
| `scripts/` | Scripts that `justfile` recipes call |
| `.github/` | Workflows, issue and PR templates, CODEOWNERS |

## Commands

```bash
just dev     # run the desktop app
just test    # unit tests (Rust and TypeScript)
just check   # formatting, lints and types; must be green before every push
```

`just codegen` regenerates the Rust and TypeScript types from `specs/`.

## Rules

1. One entry point: `AGENTS.md`. It holds the repository map (one line per top-level folder), three
   commands (`just dev` · `just test` · `just check`), the rules, and the boundaries (no secrets, `brand/`
   is not Apache, closed services stay outside the repository).
2. Spec first. Change `specs/`, run `just codegen`, then implement. Generated files are committed and start
   with a GENERATED header, so types can be read without a build. CI catches drift between generated files
   and specs.
3. Every package has a README of at most 40 lines: purpose, public API, how to test.
4. One file, one concern, at most 400 lines. AI agents read files whole.
5. Fixed prefixes: `desk-` (crates) · `@endue-ai/` (packages) · `plugin-` (examples). The name alone is
   enough to search.
6. Tests live next to the source: Rust inside the module plus `crates/*/tests`, TypeScript in `*.test.ts`.
   App-level tests live in `e2e/`.
7. Every decision that is hard to reverse gets one page in `docs/adr/`. AI agents read the why, too.
8. Everything in `examples/` runs with one command. People writing their first plugin and AI agents both
   copy from there.
9. Built-in features in `plugins/` keep the same folder format as community plugins. Two formats would
   leave holes in the API.

## Boundaries

- No secrets. Never commit tokens, keys, certificates, `.env` files or personal data. Signing keys live in
  protected GitHub environments that AI tokens cannot reach.
- `brand/` is not Apache-2.0. Use the assets as they are; never edit or relicense them. Forks replace them.
- Closed services stay outside this repository. endue AI and endue ID are reached only through public
  contracts (`specs/brain`) and their clients.
- `docs/ko/`, `docs/reference/` and `brand/` are source material. Read them; change them only when a task
  says so.
- `.github/workflows/`, `specs/` and `brand/` belong to the maintainers (see `.github/CODEOWNERS`).

## Procedures

Repeatable work follows these procedures. Claude Code runs them as skills (`/<name> <arg>`); other tools
read the same files and follow the steps.

- `plan-task <issue>`: turn a Task issue's Requirement into the contract and label it `ai:ready`
  (`.claude/skills/plan-task/SKILL.md`).
- `run-task <issue>`: implement an `ai:ready` issue on `ai/<issue>-<slug>`, tests red first, and open the
  PR (`.claude/skills/run-task/SKILL.md`).
- `fix-ci <pr>`: fix a PR's failing checks on its branch, within budget (`.claude/skills/fix-ci/SKILL.md`).
- `add-adr <title>`: add the next MADR page to `docs/adr/` (`.claude/skills/add-adr/SKILL.md`).

Budgets per issue: 3 CI failures, 2 review rounds, 24 hours. Past any of them, stop and label
`ai:needs-human`. Which tests run for which change: `docs/qa/TESTING.md`.

## Conventions

- Language: code, comments, commits and English documents are in English.
- Commits: Conventional Commits with a DCO sign-off (`git commit -s`), author taken from git config.
- Branches: one branch per task; never push directly to `main`.
