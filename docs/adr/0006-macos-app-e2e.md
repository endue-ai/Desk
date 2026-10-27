---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# macOS app testing without tauri-driver

## Context and Problem Statement

App-level end-to-end tests use WebdriverIO with tauri-driver, which supports Linux and Windows but not
macOS. macOS is the primary development target. How do we test the app there?

## Decision Drivers

* Coverage of what users see on macOS (WKWebView)
* No custom macOS automation stack to maintain
* A clear switch-over point when the tooling catches up

## Considered Options

* Runtime Playwright tests + install smoke test + 10 minutes of manual exploration before stable
* A custom macOS UI automation harness

## Decision Outcome

Chosen option: "runtime Playwright + install smoke + 10-minute manual pass". The runtime is tested in
WebKit with Playwright, every build is installed and launched by a smoke script that also verifies the
signature, and a 10-minute manual exploration runs before each stable release. When tauri-driver supports
macOS, macOS joins the app e2e suite.

### Consequences

* Good, because most macOS-specific rendering is covered by WebKit runtime tests.
* Bad, because native integration on macOS relies on the smoke test and a manual checklist
  (`docs/qa/release-checklist.md`).

## More Information

Follows common practice for Tauri projects. Design: `docs/ko/desk-structure.md`, sections "QA: 테스트 층"
and "결정".
