---
status: proposed
date: 2026-11-08
decision-makers: Team endue
---

# The Docker plugin opens on an overview, with a detail pane beside its lists

## Context and Problem Statement

`endue.docker` (ADR 0039) opened on a tree of containers and showed a container's detail or its logs
in place of the list, with six lists on `1`–`6`, the engine's versions and disk use the last of them.
Resource use was a `docker stats --no-stream` sample every few seconds (about two seconds each), shown
as two numbers per row. Daily use asked for more: what state the engine and its stacks are in at a
glance, live resource use with its recent shape, acting on several containers at once, a container's
logs, files and JSON without losing the list, image history, pulls and builds with progress, and a
look that follows the design system (issue #539). Which layout, which numbers on which keys, and where
resource use comes from, are hard to change once people's hands and saved state depend on them.

## Decision Drivers

* The first screen answers "is it running, what is failing, what takes space" before any list
* Keyboard first: one key per action, the same key in every list, Mod chords left to the desk and Tab
  left to move between regions (it used to fold, which trapped the focus)
* Resource use that moves as it happens without a process every few seconds
* Bulk actions that report what failed instead of stopping at the first failure
* No new bridge method; the permissions grow only where a new action needs it
* Every action stays a command (DOCK-17), so agents and the palette keep up with the keys

## Considered Options

* An overview as the first tab, a detail pane beside the list, one `docker stats` stream
* Keep the containers tree as the first screen and add a dashboard command
* A separate window per container (detail and logs as their own desk surfaces)

## Decision Outcome

Chosen option: "an overview as the first tab, a detail pane beside the list, one `docker stats`
stream", because it answers the first question on opening, keeps the list in view while reading one
object, and makes live resource use cheaper than the samples it replaces.

* **Tabs.** `1 Overview · 2 Containers · 3 Compose · 4 Images · 5 Volumes · 6 Networks`. The Engine list
  folds into the Overview (versions, context, disk use, clean-up); `endue.docker.system` still answers
  with the versions, contexts and disk use. A saved `system` view, and `endue.docker.open` with
  `view: "system"`, read as the Overview.
* **The overview** is cards whose lines are one roving cursor: the engine (with Try again when docker is
  missing, not running or not allowed), containers by state, Compose stacks with a dot per service, the
  busiest containers, disk use per kind with what is reclaimable, and images, volumes and networks.
  Every line opens a list filtered (`is:unhealthy`, `project:shop`) or runs its action.
* **Lists** share a toolbar: a search field (`/`) with words and terms (`state:`, `is:`, `project:`,
  `image:`, `port:`, a leading `-` negates), state chips and a sort; each list's query and sort are kept
  in the plugin's state. `Space` marks, `M` marks all shown, `Esc` clears; with marks, the lifecycle
  and remove keys act on all of them: one docker call per object, four at a time, one sentence naming
  each failure, one refresh, the failed ones left marked. Commands take `containers: [...]` and answer
  `{ done, failed }`.
* **The detail pane** sits beside the list (over it below 760 px) with tabs `Info · Logs · Stats · Env
  · Ports · Inspect · Files` for a container, `Info · History` for an image, the logs for a stack, and the
  output of a pull or a build with its progress. `[` and `]` switch tabs, `q` closes it. The logs and
  detail stay desk buffers (`desk.buffers.*`), as before.
* **Resource use** is one `docker stats --no-trunc --format '{{json .}}'` stream while containers are
  on screen (the overview, Containers, Compose or a container's pane), stopped otherwise and started
  again after the engine comes back. Each container keeps 60 points spaced `stats-interval` seconds
  (now 2 by default; 0 still turns it off); the rows' cells are patched in place. `endue.docker.stats`
  keeps answering agents with one `--no-stream` sample.
* **Permissions.** Published TCP ports open in the browser through `shell.open`, so the manifest gains
  `shell:open` for `http` and `https` only. `build`, `copy-out` and `copy-in` are irreversible commands:
  an agent's call waits for the person (ADR 0078), as `run` does.

### Consequences

* Good, because the first screen shows trouble (unhealthy, exited stacks, reclaimable space) and leads
  to it in one key.
* Good, because live resource use costs one long-running process instead of one every few seconds, and
  the sparklines show the last minutes, not a single number.
* Good, because bulk actions finish what they can and say what they could not.
* Bad, because the number keys moved by one (Containers was `1`, now `2`) and `Tab` no longer folds
  (`←` and `→` do). People who learned the first version relearn two habits.
* Bad, because the Files tab lists with the container's own `ls`: a distroless or scratch image has
  none, and only copying out reads it. A stopped container lists nothing until it starts.
* Neutral, because `docker stats` redraws with ANSI cursor codes; the plugin strips them per line and
  keeps one point per spacing, which a change in the CLI's frame format could need adjusting.

## More Information

`plugins/docker/README.md`, `docs/ko/docker-plugin-requirements.md` (DOCK-19 to 22, NF-05); ADR 0039
(the CLI, not the socket), ADR 0047 (links through `shell.open`), ADR 0078 (irreversible commands wait
for the person), ADR 0088 (agents' tools). Drop targets (drop a file on the Files tab to copy it in)
come with the drag and drop task; `ui/drop.js` is the seam it calls.
