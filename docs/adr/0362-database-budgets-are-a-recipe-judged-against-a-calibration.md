---
status: accepted
date: 2026-11-23
decision-makers: Team endue
---

# The database plugin's budgets are a recipe of their own, judged against a calibration run beside them

## Context and Problem Statement

The database plugin has to stay quick as results, schemas and scripts grow (#498, PG-103). A few unit
tests already held timing budgets: the problems and warnings of a 1 MB script
(`problems-incremental.test.ts`, `warnings.test.ts`) in absolute milliseconds. Many agents build and
test on one machine at once, and at load averages above 30 those budgets failed the default run with no
regression behind them. What a person feels most also needs a real server: the first rows of a
million-row read, scrolling it to its end, a schema of 10,000 tables, a table of 1,000 columns. Where do
these budgets run, and how is a value judged so that a busy machine does not fail it while a regression
still does?

## Decision Drivers

* A regression fails a test; load alone never does
* No threshold without its measurement: every budget is a recorded baseline with its reason
* The default unit run stays fast and needs no server
* One command runs every case

## Considered Options

* A recipe of its own, `just perf-database`, each case judged against a calibration run just before
  it, timed on the process's CPU clock where the work is the process's own (chosen)
* Keep the budgets in the default unit run in absolute milliseconds, with a larger margin
* Keep them in the default unit run, judged against the calibration
* Judge only on a quiet machine: skip every budget past a load average

## Decision Outcome

Chosen option: "a recipe of its own, judged against a calibration", because it is the only one that keeps
a regression failing on a loaded machine without failing for the load.

* `e2e/perf/database/*.perf.ts` run with `just perf-database` (vitest, one file after another, its own
  config), outside `just test-unit`. The live cases run against `ENDUE_DB_TEST_POSTGRES` and are skipped
  without it, as the live tests are; their tables are made in that database and dropped after.
* Each case is the fastest of a few runs. Before it, the process times a fixed CPU workload, the median
  of five runs of about a tenth of a second (`e2e/perf/lib/calibrated.ts`). Its limit is
  `baseline × (1 + allowedRegression) + slack`, times the calibration now over the calibration at the
  record, at least 1 and at most 6. A memory or CPU share budget is not scaled.
* Work done in the process (parsing, completion, drawing) is timed on the process's CPU clock, which a
  busy machine moves far less than the wall clock; a case that waits on a server is timed on the wall.
* Past a load average of twice the cores (the busier of the moments before and after the case), a value
  over its limit is reported as busy, not failed: there a case's time is the scheduler's.
* A case of many round trips is judged on its median step (the scroll of a million rows on its median
  page), which a burst of load during it does not move as it moves the sum.
* Baselines, their calibration, load average, platform and reason live in `e2e/perf/database.json`;
  `just perf-database record` writes them. A baseline of another platform is reported, never failed.
* The timing assertions of the 1 MB problems and warnings unit tests move to `script.perf.ts`; the unit
  tests keep their checks of what is found.

### Consequences

* Good, because the default run no longer fails at load and needs no server, and the budgets cover what
  the person feels on a real server.
* Good, because a value on a loaded machine is held against a limit that grew with that load, so a
  regression of several times still fails there.
* Bad, because the budgets run only when someone runs the recipe; a change to a hot path should run it
  (docs/qa/TESTING.md says when).
* Bad, because a calibration in the process does not see the load on the server's machine or container:
  the live cases have the larger allowance.

## More Information

Issue #498 (PG-103), epic #438. The same budget-file shape as `e2e/perf/budgets.json` (#58). The cases,
their sizes and baselines: `plugins/database/README.md` and `e2e/perf/database.json`.
