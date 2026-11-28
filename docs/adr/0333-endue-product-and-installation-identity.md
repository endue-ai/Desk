---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# The endue app and CLI share a release

## Context and Problem Statement

Desk is the graphical client. Its current CLI validates plugins and reads files on its own, and sends live commands to the app over a local socket. Giving both clients the name **endue** affects package ownership, installed data and signed updates. Some machines may already have an application or command with that name.

## Decision Drivers

People can upgrade an existing installation, keep their scripts working and choose a terminal-only download on a server. Installers must identify which existing files they own before replacing them.

## Considered Options

- Rename every installed identifier together with the product.
- Change the user-facing name, carry existing installation identities forward and build both distributions from the same public release.

## Decision Outcome

Adopt the second option. The current GUI is the **endue app**. The public `crates/desk-cli` crate supplies the **endue CLI**. Both distributions take the CLI for their target from the same tagged revision. Release manifests identify its version, target and the checksum of each downloadable package.

| Surface today | Public name and transition | Owner and verification |
| --- | --- | --- |
| endue Desk, `ai.endue.desk`, Debian package `endue-desk` | Display **endue**. Carry forward the app bundle ID, Windows upgrade and uninstall identities, Debian package identity and file registrations. | Desktop packaging (#582). Upgrade an installed copy on each supported OS and open an associated file. |
| `~/.desk`, platform data under `ai.endue.desk`, OS credential store | Reopen the same profile, settings, plugin lock, permissions and credential references in place. | Desktop packaging (#582). Seed a disposable profile, grant and test credential, upgrade and read them back. |
| `desk`, its `DESK_*` overrides and `desk.sock` | Install `endue` as the primary command. Route the legacy entry point through the same implementation, retaining existing arguments, overrides, output and exit codes for scripts. | CLI (#585). Exercise both command names against file-only and socket-backed commands. |
| `endue://v1/…` links, `desk.*` commands and existing plugin IDs | Continue to dispatch existing links and commands under their published names. | Desktop and CLI (#582, #585). Open an existing link and invoke an installed plugin by its original command ID. |
| `endue-ai/Desk` and its signed release URLs | Rename the existing repository to `endue-ai/endue`. A transition release reads the exact old and new release paths. Keep tag indexes readable by a client that missed the transition. | Release (#581, #584). Test both hops with both tags already visible, and test the documented manual path for installer-only builds. |

[ADR 0401](0401-the-app-identifier-is-ai-endue-desktop.md) replaces the identifier `ai.endue.desk` in the first two rows with `ai.endue.desktop`, before the first signed release.

Keep the `desk` entry point throughout the current major release line. Removing it requires a separately announced major release after at least one stable release has shipped both names and migration instructions.

### Installation paths

- **Existing Desk user.** Upgrade the installation identified by the OS package receipt or bundle ID, even if the user renamed its folder. An installer-only build follows the documented manual upgrade. Both paths reopen the same data.
- **Name already in use.** If the intended app target or terminal command belongs to another installation, leave it in place. Offer an explicitly chosen app location or the packaged CLI's full path. Only point a PATH entry at endue when the destination is available or verified as owned. Reinstalling the same release is safe in either case.
- **Fresh Linux server.** Install the Linux x86_64 CLI package. The first workload is `endue run "prompt"`, one text turn against a configured provider of the public brain v0 contract. The CLI creates a session, acquires its lease, submits the turn and releases the lease. On success it writes the answer to stdout and exits zero. Failures report a reason on stderr and exit nonzero. Verify over SSH using the public echo fixture, a closed stdin and no desktop socket or display (#586, #587).

### Consequences

A display-name change can ship independently of Linux CLI availability. Package maintainers must continue testing old configuration names and release links. Endue AI and endue ID stay behind their public contracts.

## More Information

[Product rollout](https://github.com/endue-ai/Desk/issues/579), [CLI transport](0030-the-cli-reaches-the-desk-over-a-local-socket.md), [signed upgrade paths](0291-github-release-upgrade-paths.md), [brain contract](../../specs/brain/v0/README.md). The product and package names belong in the architecture guide when the GUI ships (#583).
