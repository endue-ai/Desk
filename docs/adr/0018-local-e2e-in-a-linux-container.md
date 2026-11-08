---
status: accepted
date: 2026-10-29
decision-makers: Team endue
---

# Local e2e runs in a Linux container on macOS, two runs per machine

## Context and Problem Statement

Parallel agents (ADR 0015) each ran the runtime e2e on the same Mac, often with Playwright's default
of eight workers and sometimes `--workers=12 --repeat-each=10`. Playwright's WebKit on macOS is a real
Cocoa app: every worker is a WebKit process with windows backed by WindowServer, and traces and
screenshots capture those windows. On 2026-10-28 at 00:13 and 20:40 and on 2026-10-29 at 00:27 KST,
WindowServer failed an IOSurface allocation while capturing a window and aborted (26 WebKit processes
died with it the first time). macOS then ended the login session. The agents survived but lost
getaddrinfo, TLS trust and user lookups, so every task in flight stopped with "Could not resolve host"
until a person logged in and restarted them. Lowering the concurrency makes this rarer, not impossible.

## Decision Drivers

* No agent can take the Mac's window server down, however many run and whatever they type
* Local results match CI's `runtime-e2e`, which runs WebKit on Linux
* Agents keep a fast local e2e loop; CI round trips cost four minutes and the CI failure budget
* A person can still watch native WebKit and measure frame times on a real Mac
* When a session does break, agents say why instead of failing at random

## Considered Options

* `just test-e2e` runs Playwright's Linux image in Docker on macOS, behind machine-wide slots, a
  guard in the Playwright configs and an agent hook
* Native WebKit with a machine-wide limit (fewer runs, fewer workers, no traces)
* Agents never run e2e locally; CI only

## Decision Outcome

Chosen option: "Linux container behind slots and a guard", because WebKit in a Linux container
renders without a window server, so the crash path does not exist, and it is the engine and OS that
CI already gates on. The other two either keep the risk or take the e2e loop away from agents.

* `scripts/e2e.mjs` is the only entry (`just test-e2e`, `just perf-opening`). On macOS it runs the
  tests in `mcr.microsoft.com/playwright` pinned to the lockfile's `@playwright/test`, with the
  workspace's Linux `node_modules` baked into a local image tagged by the manifests' hash. The
  checkout is mounted read-only; only snapshots and test results are written back.
* Every run takes one of the machine's slots (`~/.cache/desk/e2e-slots`, two by default); the rest
  wait. A container run has four workers and 3 GB; `just perf-opening` takes every slot.
* Native WebKit on macOS is for a person: `DESK_E2E_NATIVE=1` (two workers, no traces, screenshots
  or video) and `just perf-opening`. AI agents are refused, recognised by the variables their tools
  set (`CLAUDECODE`, `CODEX_SANDBOX`, `DESK_AGENT`).
* Both Playwright configs call `scripts/e2e/guard.mjs`, so a direct `playwright test` on macOS fails
  unless the runner holds a live slot for it. A Claude Code PreToolUse hook (`scripts/agent-hook.mjs`)
  blocks direct Playwright commands and scripts that import Playwright before they start.
* `just doctor` recognises an ended login session and prints the fix; the runner and
  `just task-start` run it first.
* CI is unchanged: it runs `just test-e2e`, which goes straight to Playwright when `CI` is set.

### Consequences

* Good, because no local e2e run, by an agent or a person, touches WindowServer unless a person asks.
* Good, because local snapshots now come from the same engine and OS as CI's.
* Good, because a broken session stops agents with its cause and fix.
* Bad, because macOS needs Docker Desktop (the runner starts it), the first run builds an image of
  about 4 GB, and each run copies the checkout into the container.
* Bad, because headed and UI debugging need `DESK_E2E_NATIVE=1`, and perf runs need a person.
* Bad, because the guard trusts the environment: a tool that sets none of the agent variables and
  forges a slot can still start native WebKit. The hook and AGENTS.md cover the agents we run.

## More Information

* Issue #46; the crash analysis is in its Requirement.
* `docs/qa/TESTING.md` (Runtime, Performance budgets), `scripts/README.md`.
* `docs/ko/desk-structure.md`, "QA: 테스트 층", should say that local runtime e2e on macOS runs in the
  Linux container; it is source material, so that edit waits for a task that asks for it.
