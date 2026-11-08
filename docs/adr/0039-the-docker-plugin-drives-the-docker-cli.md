---
status: accepted
date: 2026-10-31
decision-makers: Team endue
---

# The Docker plugin drives the docker CLI, not the Engine API socket

## Context and Problem Statement

`endue.docker` manages containers, Compose projects, images, volumes and networks. The Docker Engine
speaks an HTTP API (the Engine API) over a Unix socket, a Windows named pipe, TCP with TLS or SSH, and
the `docker` CLI is a client of that API that also resolves contexts, credential helpers and the Compose
plugin. A UI plugin reaches the world only through the bridge (ADR 0012): `proc.*` for programs and
`net.fetch` for HTTP hosts its manifest names. Which does the plugin talk to?

## Decision Drivers

* Work with every engine people run: Docker Desktop, Colima, OrbStack, Rancher Desktop, a remote host
  over SSH, rootless Docker, and whatever context the person already set up
* Compose: up, down and pull read Compose files, which only the Compose implementation understands
* The narrowest grant: one program, no socket that hands out root-equivalent access to anything else
* No new bridge method and no change to the core for one plugin
* Output that does not change shape between versions

## Considered Options

* The docker CLI through `proc.spawn`, with Go templates that print JSON
* The Engine API over the socket, through a new bridge method for Unix sockets and named pipes
* The Engine API over TCP through `net.fetch`

## Decision Outcome

Chosen option: "the docker CLI", because it already knows how to reach every kind of engine (contexts,
SSH, TLS, named pipes), it is the only complete Compose, and the grant it needs is the existing
`proc:spawn { commands: ["docker"] }`.

* **Reads use templates of our own.** Lists ask for `--format '{"id":{{json .ID}},…}'`, one JSON object
  per line with the fields the views need, so field names are the plugin's and `.Size` (which makes
  docker measure every container) is never asked for. Details use `container inspect`, which is the
  Engine API's own ContainerJSON.
* **Every value is checked and positional values follow `--`.** Names, OCI image references, ports,
  environment and volumes are checked before docker sees them; nothing that starts with a dash reaches
  docker as a value. `docker run` offers no option that widens what a container may do (privileged,
  capabilities, the host's network or PID namespace).
* **The context is a flag, never global state.** A context picked in the plugin is passed as
  `--context` on every call; `docker context use` would change every terminal's docker too.
* **Liveness comes from `docker events`,** one long-running process per plugin, restarted with a
  backoff, instead of polling.

### Consequences

* Good, because whatever works in the person's terminal works in the plugin, including remote engines.
* Good, because the plugin needs no new bridge method, no socket grant and nothing in the core.
* Bad, because each read is a process: a list costs tens of milliseconds more than an HTTP call, and
  resource use is sampled with `docker stats --no-stream` (about two seconds per sample).
* Bad, because an app started from the Finder has the system's PATH, which often misses docker: the
  plugin tries the usual install folders once and offers `endue.docker.path`. Resolving the login
  shell's PATH belongs in the app, for every plugin.
* Bad, because bridge v0 cannot close a process's stdin, so `docker login --password-stdin`,
  `compose -f -` and `docker load` wait for that bridge change.

## More Information

`plugins/docker/README.md`, `docs/ko/docker-plugin-requirements.md`; ADR 0012 (UI plugins), ADR 0037
(the terminal, which the plugin's shell opens in).
