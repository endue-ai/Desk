---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# App-level end-to-end tests drive the CEF desk over Chromium's remote debugging

## Context and Problem Statement

App-level e2e (`e2e/`) drives the packaged Tauri app with WebdriverIO and tauri-driver, on Linux only,
because tauri-driver does not run on macOS (ADR 0006). The runtime's e2e (`packages/runtime/e2e`)
runs Playwright's WebKit in a Linux container on macOS, at most two runs per machine, because native
WebKit processes made WindowServer abort and end the login session for every agent (ADR 0018). Under
ADR 0140 the desk's engine is Chromium on every OS, and CEF exposes Chromium's remote debugging. How
do the app and runtime suites drive the new desk?

## Decision Drivers

* Tests run on the engine people use
* macOS joins the app suite instead of waiting for tauri-driver
* No local run takes the window server down (ADR 0018's reason still stands)
* The existing specs keep working with as little rewriting as possible
* Playwright still runs only through `just test-e2e`

## Considered Options

* Drive the CEF desk over remote debugging, and run the runtime suites on Chromium
* Keep the WebKit runners for the runtime suites and add a CEF path for the app suite only
* An automation layer of our own over the core's `desk.sock`

## Decision Outcome

Chosen option: "drive the CEF desk over remote debugging", because Chromium already speaks a
protocol that both WebdriverIO (through chromedriver) and Playwright attach to, it works the same on
three OSes, and the runtime suites then test the engine the app ships.

* `e2e/` drives the CEF desk over Chromium's remote debugging: WebdriverIO through chromedriver
  attached to `--remote-debugging-port` (`goog:chromeOptions.debuggerAddress`), or Playwright's
  `connectOverCDP`. #48 picks one and says why; keeping the wdio specs favours chromedriver.
* `--remote-debugging-port` is on in debug and test builds only; a release build never opens it.
* The runtime suites run on Chromium: one engine and one visual baseline for app, runtime and plugin
  tests. WebKit baselines are regenerated once, and a person reviews the differences.
* Once the engine is Chromium, the Docker WebKit runner and its two slots per machine end for e2e:
  they existed because native WebKit's windows crashed WindowServer on macOS. `just test-e2e` stays
  the only entry, and the guard and the agent hook stay.
* macOS joins the app suite when the CEF desk ships, without tauri-driver.
* Until the CEF desk replaces the Tauri app at the end of Stage 1, both runners stay as they are.

### Consequences

* Good, because app, runtime and plugin tests run on one engine, on all three OSes, macOS included.
* Good, because local runs need no 4 GB image and no copy of the checkout, and DevTools reach every
  surface while debugging.
* Bad, because a debugging port is an attack surface; it must never be on in a release build, and a
  release check has to assert that.
* Bad, because Chromium's own behaviour on a crowded Mac is not measured yet; if parallel runs strain
  WindowServer, the slots come back. #48 measures before the Docker runner goes.
* Bad, because the WebKit baselines and every WebKit-only workaround in the suites are rewritten once.

## More Information

Epic #32 §11; issue #48. Amends ADR 0018 (the Docker WebKit runner and its slots end for e2e once the
engine is Chromium) and ADR 0006 (macOS joins the app suite over remote debugging, not tauri-driver).
`docs/qa/TESTING.md` and `e2e/README.md` change with #48. ADR 0140 is the direction.
