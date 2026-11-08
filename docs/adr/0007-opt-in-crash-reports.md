---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Crash reports: Sentry, opt-in, off by default

## Context and Problem Statement

Desk promises no telemetry, yet beta promotion needs to know whether a canary build introduced new
crashes. How do we learn about crashes without breaking the promise?

## Decision Drivers

* No data leaves the device unless the user says so
* Enough signal to gate beta promotion on new crash signatures
* A standard tool, not a custom pipeline

## Considered Options

* Sentry, opt-in and off by default
* No crash reporting at all
* Crash reporting on by default with an opt-out

## Decision Outcome

Chosen option: "Sentry, opt-in, off by default". Users choose to send crash reports; nothing is sent
otherwise. New crash signatures per build are part of the beta promotion condition.

### Consequences

* Good, because the no-telemetry promise holds by default.
* Bad, because opt-in data is a smaller sample, so promotion decisions see fewer crashes.

## More Information

Follows common practice for Tauri apps. Design: `docs/ko/desk-structure.md`, section "결정".
