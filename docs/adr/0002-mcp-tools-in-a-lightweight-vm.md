---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Run MCP tool plugins inside one lightweight Linux VM

## Context and Problem Statement

Tool plugins are MCP servers written in any language, often existing third-party servers. They are
arbitrary native processes. How do we stop a tool from reading or changing files the user never allowed?

## Decision Drivers

* Real isolation for code we did not write, not just a permission prompt
* Only folders the user allowed are visible to tools
* Existing MCP servers keep working unchanged, and endue AI agents can use the same tools
* Idle cost close to zero

## Considered Options

* One lightweight Linux VM for all MCP tools
* Plain OS processes running with the user's permissions
* An OS sandbox per process (App Sandbox, AppContainer, seccomp/landlock)

## Decision Outcome

Chosen option: "one lightweight Linux VM", because it is the only option that isolates arbitrary
binaries the same way on every OS. Allowed folders are mounted with virtiofs, the host talks to tools
over vsock, and the whole VM is paused when idle. It uses Virtualization.framework on macOS, WSL2 on
Windows and KVM on Linux. On devices that cannot start a VM, setup says "no isolation" plainly and tools
run with the user's permissions.

### Consequences

* Good, because a tool sees only the folders the user allowed.
* Good, because the same mechanism works for any language and any existing MCP server.
* Bad, because the VM image costs memory and the first-run download takes time (open question).
* Bad, because calls through the VM add latency.

### Confirmation

Rust integration tests cover the VM lifecycle (boot, folder mount, pause) on main and nightly.

## More Information

Follows the approach of Claude Cowork and Docker Desktop. Code lives in `crates/desk-vm` and
`crates/desk-plugin-host`. Design: `docs/ko/desk-structure.md`, section "결정" (decisions).
