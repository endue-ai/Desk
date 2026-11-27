---
status: accepted
date: 2026-11-27
decision-makers: Team endue
---

# Plugin pages take the person's own style and script

## Context and Problem Statement

Every plugin page is HTML and JavaScript. People want to change how a page looks or behaves ("make
the notes text bigger", "hide this toolbar") by asking Eris, and want the change to come back at
every start and every sign-in. Themes (ADR 0056) and design systems (ADR 0090) change the whole desk
through tokens; nothing changed one plugin's page. ADR 0171 had turned down a shell-injected user
style sheet for the theme's native controls.

## Decision Drivers

* Every plugin gets it, built in or from the market, with no change to the plugin.
* Kept for the endue account signed in, and applied again at start and at sign-in.
* A script runs with the plugin's permissions, so an agent must not add one unreviewed.
* A page the person broke must still open.

## Considered Options

* Rewrite each page's HTML in `desk-web`'s `plugin_scheme` to add a style and a script.
* Send them over the plugin protocol as `desk:custom`, which the SDK applies, kept by the runtime.
* Evaluate them in the CEF renderer, as the shell's shim is.

## Decision Outcome

Chosen: `desk:custom` over the protocol. The `desk.customize` policy keeps a set per endue account
(named by a SHA-256 of its email, never the email) and one for this computer while nobody is signed
in, in the core's store under `customize`. The plugin host keeps each plugin's message and sends it
after that plugin's init only. The SDK puts the style last in the head and runs the script once per
page load after the plugin mounted; a changed script reloads the page. An account's first sign-in
takes this computer's set. `desk.customize.style` and `.clear` are reversible and on Eris's list;
`desk.customize.script` is irreversible, so an agent's script waits for the person's approval, and
`desk.palette` takes none. Safe mode and `desk.customize.enabled: false` send nothing.

### Consequences

* Good: no Rust or shell change to serve pages; the e2e server and the CEF desk behave the same.
* Good: undo, approval and Eris's scope rules are the command registry's, as for every desk command.
* Bad: the style lands after the page's first paint, so a page can flash its own look once.
* Bad: a page that does not use the SDK gets nothing.
* Bad: the sets live on this desk only; they travel between desks once endue serves sync (ADR 0016).
