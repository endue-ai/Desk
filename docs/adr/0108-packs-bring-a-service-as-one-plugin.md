---
status: accepted
date: 2026-11-06
decision-makers: Team endue
---

# A pack is a data-only plugin that brings a service's connector, views and layout as one

## Context and Problem Statement

Setting up a service on the desk took four separate steps: install or find its connector, enter a token,
find or make views of its items, and arrange a layout. The roadmap's killer feature 6 (ADR 0093) is "name
a service, get its connector, views and layout". The pieces exist as plugins (http connectors, ADR 0106;
view plugins and universal views, ADR 0032 and 0087; profiles, ADR 0079), and the market installs any kind
(ADR 0107). What carries them as one, so that a person, Eris and the market all handle one thing?

## Decision Drivers

* No new runtime: a pack runs no code, so it can come from any market marked as not verified
* What a pack brings must leave with it, and what it only names must stay
* Eris proposes it from a sentence and the person applies it, as with every proposal (ADR 0073)
* One format for a built-in pack and a market pack

## Considered Options

* A plugin kind `pack`: a pack block naming the plugins it brings (nested in its folder, or on the desk),
  the commands its Apply runs and the profile it lays out; its own views and contributions
* A pack as a market entry only: a list of other entries to install together
* A profile that names plugins and installs the missing ones

## Decision Outcome

Chosen option: "a plugin kind `pack`", because it is a folder like every plugin: `desk plugin validate`
checks it, plugins.lock pins it, the market carries it as one `.desk-plugin`, and a built-in pack is a
folder in `plugins/`. The core installs the plugins nested under `plugins/` in a pack's folder with it
(built in when the pack is) and removes them with it; a plugin the pack names that is neither nested nor
on the desk fails the pack, naming it. A pack may carry views (as a view plugin does) and contribute
commands and profiles. From a market, nested plugins get the permissions the person accepted that each
asks, and nested code is held to the endue index (ADR 0107). Make with Eris routes "Set up <service>"
(and "<service> 연결해줘") to the pack whose services, name or tags say it: the card lists what it brings,
and Apply installs it when needed, turns it and its plugins on, switches to its profile, runs what it
opens and opens Settings, Connections on its first connector. The first pack is `desk.pack-github`.

### Consequences

* Good, because a service is one sentence or one install away, and the market can carry a whole setup.
* Good, because removing a pack takes back what it brought and nothing else.
* Bad, because a pack's layout is a profile: applying it switches the desk's profile, which a person who
  wanted only the connector undoes by switching back.
* Bad, because services are matched by words in the pack, not by a registry of services; two packs that
  name the same word go to the first found (installed before market).

## More Information

`specs/plugin/v0/pack.schema.json`, `crates/desk-core/src/core_packs.rs`, `plugins/pack-github`,
`packages/runtime/src/propose/pack.ts`. ADR 0032, ADR 0073, ADR 0079, ADR 0087, ADR 0093, ADR 0106,
ADR 0107. Issue #476.
