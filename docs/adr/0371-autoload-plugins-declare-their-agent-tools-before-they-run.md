---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Autoload plugins declare their agent tools before they run

## Context and Problem Statement

[ADR 0124](0124-eris-knows-closed-windows-and-every-command.md) describes what Eris can find.
An installed autoload plugin can start without a frame or a command registration. Other installed
plugins can defer the descriptions and schemas of their agent tools until their page runs.

## Decision Drivers

- Make a healthy autoload plugin's tools discoverable before it mounts.
- Respect manual disables, start-up holds and configured role providers.
- Keep read-only tool calls out of the foreground while recording them in normal agent run history.

## Considered Options

- Start every plugin window to collect the tool registrations.
- Register eligible agent tools from manifests and start a frame when a command needs it.

## Decision Outcome

The runtime registers an eligible autoload plugin's manifest agent tools and retains its normal
command delivery path. The core reports automatic activation eligibility as `autoStart`. The desk's
`automatic` activation preserves the saved manual choice and checks current eligibility before
changing plugin state. Explicit choices take precedence. Previously saved enabled or disabled flags
keep their meaning.

A read-only agent invocation opens or wakes its frame in the background. The command's result goes to
the agent, with the invocation visible in run history. Non-read-only invocations keep their existing
foreground behavior. The capability catalogue includes the state and declared agent commands of an
installed plugin whose window cannot start.

### Consequences

- Agent metadata for built-in plugins comes from their manifests. The core rejects a registration
  with conflicting agent metadata, and the Docker and Database manifests contain their existing tools.
- The file-opening lifecycle can finish an automatic activation and return the plugin to its dormant
  state while keeping it discoverable.

## More Information

- [ADR 0046](0046-file-plugins-autoload.md)
- [Issue #717](https://github.com/endue-ai/endue/issues/717)
