---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# A plugin is asked only for what its manifest declares

## Context and Problem Statement

A plugin's `plugin.json` lists the permissions it may ask for, and the Market shows that list when the
person installs it. The core never read it again: `perm.request`, the calls that ask by themselves
(`shell.open`, `audio.capture.start`) and `perm.grant` asked or granted any caller anything. A plugin
could ask at run time for what it never declared, so "a plugin without the permission is refused" was
in practice "is asked", and the install-time list bounded nothing (two reviews of 2026-11-16, #311 and
PR #344). Some built-in plugins need what no fixed list can name: a computer the person types in
(Screen Sharing), the host of any view source (Universal), the client a setting names (Database), any
program in a terminal, and the folder of any file the person opens (the openers, ADR 0131). How does
the manifest bound a plugin without breaking those?

## Decision Drivers

* A plugin can only be asked for, and granted, what its manifest declares; anything else is refused
  without asking the person
* What was granted before, or by the host, allows nothing the manifest no longer covers
* The desk, the CLI, MCP servers and agents keep their own rules (agents: ADR 0072, ADR 0268)
* Every built-in plugin keeps working, and still asks where it asked before
* One manifest format for built-in and community plugins

## Considered Options

* Read the declarations at ask time and at use time; `*` in a declared host or program, and `/**`
  for paths, stand for any value the person names at run time
* The same, but the four open-ended plugins keep today's behaviour through an exemption list
* No wildcards: declare only known values, refusing the rest

## Decision Outcome

Chosen option: "read the declarations at ask time and at use time, with `*` and `/**`", because it
bounds every plugin by one rule written in its own manifest, and an exemption list or fixed values
would either leave four plugins unbounded or break connecting to any computer, any view source, a
custom client path and any terminal program.

* **Who**: a caller the core installed as a plugin (its registry), judged by its manifest's
  `permissions`; a manifest that failed validation declares nothing. Any other caller (`desk`,
  `cli`, `palette`, `agent:<id>`, `mcp:<name>`) is not bounded by it (`declared.rs`).
* **Ask time** (`capped`): `perm.request` answers `granted: false, reason: "undeclared"` at once,
  even with a lasting grant that covers it, and `shell.open` and `audio.capture.start` answer
  `permission_denied` without a prompt, each on the `perm` log as a refusal; `perm.grant` is
  `permission_denied`, and a dialog's grant and a prompt's wider offer give nothing undeclared.
* **Use time** (`check`): a call whose scope no declaration covers is `permission_denied`, whatever
  the plugin holds, so an `always` grant kept from an earlier version, or one the host made with
  `Core::grant`, allows nothing.
* **Covers** (`declares`): as a grant covers a scope (`perm::covers`), and a declared `*` host
  (`net:fetch`, `net:connect`, `web:*`) or `*` program (`proc:spawn`, `pty` still declared), or a
  declared `/**` path (`fs:*`, `shell:open`; `~` and Windows drives too), covers any. A scope that
  itself holds `*` is never covered: `*` widens what may be asked, never what is held. In a grant or an
  allowlist `*` stays literal and matches nothing.
* **Install** (`grant_installed`): a built-in plugin, or a market plugin for what the person accepted,
  is granted its declarations at install as before, except those holding `*` or `/**`: they say only
  what may be asked, so the openers still ask, or get ADR 0131's grant, per folder. A `*` in a
  `cmd:invoke` id is an id pattern as before, granted like any other (the palette's `*`).
* **Built in**: every manifest declares what its code uses
  (`crates/desk-core/tests/builtin_declarations.rs`, from an audit of each plugin's code). The
  openers and the plugins that save, reveal or keep a folder the person names declare `fs:*` or
  `shell:open` of `/**`; Screen Sharing, Local models and Network `net:connect` of `*`; Universal
  `net:fetch` of `*`; Database, API Studio, Local models and the terminal `proc:spawn` of `*`. The
  terminal declares `cmd:invoke` of `*` for the commands `endue.terminal.event-commands` names
  (ADR 0258); as a built-in it holds that from install, as it holds a shell in a PTY.

### Consequences

* Good, because the permission list the person reads at install is the most a plugin can ever hold
* Good, because a grant that outlived its declaration is inert, and a refusal says why (`undeclared`)
* Good, because the open-ended plugins say so in their manifest, where the install shows it
* Bad, because a plugin that adds a new use must add its declaration in the same change, or the use
  is refused; the built-in check catches it only for the uses it lists
* Bad, because `*` and `/**` declarations are wide: the bound for those plugins is the person's
  answer at run time, as before
* Bad, because listings that filter by grants (`cmd.list`, `catalog.get`, event delivery) still read
  grants alone; only calls and asks read the declarations
* Bad, because a built-in's fixed declarations (`shell:open` of links, a `cmd:invoke` id, the
  terminal's `*`) are held from install, so a few first uses that asked before no longer ask

## More Information

`crates/desk-core/src/declared.rs`, `core_perm.rs` (`check`, `perm_grant`), `agents.rs` (`capped`),
`crates/desk-core/tests/declared.rs`; `specs/bridge/v0/perm.schema.json` (`RefusalReason`),
`specs/plugin/v0/permission.schema.json` (`HostPattern`, `Command`, `PathPattern`). Narrows ADR 0131's
grant, ADR 0029's grants and ADR 0258's ask to the declarations.
