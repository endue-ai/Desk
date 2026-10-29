---
status: accepted
date: 2026-10-29
decision-makers: Team endue
---

# Logic plugins are Wasm components on Wasmtime, with an empty WASI

## Context and Problem Statement

Logic plugins (`kind: logic`) run code next to the desk without a UI: event hooks, commands, small
automations. They must be isolated from the desk and from each other, reach the machine only through the
bridge's permission checks, stay within memory and time limits, and be replaced while the desk runs
(CORE-10). `specs/wit/desk-host.wit` already described the host interface as a Wasm component world. What
do logic plugins compile to, what runs them, and what else may they import?

## Decision Drivers

* Every capability goes through the bridge vocabulary and its grants ("들여다보기 전에 묻는다")
* Any language that targets Wasm, with typed bindings generated from one contract
* A trap, a loop or a memory leak in one plugin never reaches the desk or another plugin
* Ordinary toolchains: a plugin builds with the language's own command, no extra tool

## Considered Options

* Components of the `desk:host` world on Wasmtime, plus WASI 0.2 with nothing behind it
* The same components with `desk:host` only, no WASI
* The same components with WASI that sees the plugin folder and the network
* Core Wasm modules with a hand-written ABI (pointers and lengths) on any engine

## Decision Outcome

Chosen option: "Components of the `desk:host` world on Wasmtime, plus WASI 0.2 with nothing behind it",
because the component model makes `desk:host` a typed contract with bindings for host and guests, and an
empty WASI lets ordinary guests instantiate without giving them anything the bridge does not check.

* Wasmtime 49 with Cranelift; each plugin gets its own store. Memory is capped by a resource limiter
  (64 MiB by default) and time by epoch interruption (1 s per call, 10 ms ticks), which costs far less
  than fuel metering.
* `wasm32-wasip2` Rust components import `wasi:cli`, `wasi:io` and `wasi:clocks` even when they use none
  of it. The host links WASI 0.2 with no preopened folders, environment, arguments or network, and with
  stdio discarded; files, network, notifications and storage come only from `desk:host`.
* A reload builds a new instance from the folder's bytes; state that must survive lives in the store
  (`store.get` / `store.set`), never in the instance.

### Consequences

* Good, because Rust, C, Go and JavaScript (componentize-js) guests all build with their usual tools.
* Good, because a trap or a limit ends one store; the host reports it and the plugin waits for a reload.
* Bad, because Wasmtime, Cranelift and wasmtime-wasi (with tokio) add build time and size to the core.
* Bad, because guests now depend on WASI being linked: removing it later breaks every `std` guest.
* Bad, because the component model's tools still move quickly; wit-bindgen and Wasmtime upgrades need
  the example and its committed build to follow.

## More Information

Design: `docs/ko/desk-structure.md` (로직 플러그인: Wasmtime). Requirement: CORE-10 and DX-04 in the
requirements draft. Task: #39. Code: `crates/desk-plugin-host`, `specs/wit/desk-host.wit`,
`examples/plugin-hello-wasm`.
