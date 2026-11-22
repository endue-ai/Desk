---
status: accepted
date: 2026-11-23
decision-makers: Team endue
---

# A PostgreSQL session goes through an SSH tunnel the core opens

## Context and Problem Statement

Many PostgreSQL servers are reachable only from a bastion host. The database plugin's sessions run on
the core (`db.open`, ADR 0281), which connects over TCP to the host and port `db:connect` covers. How does
a session reach a server behind an SSH host (#447), where does the tunnel live, how is the SSH host's key
trusted, and where do keys and passphrases come from, without widening what a plugin or an agent can
reach?

## Decision Drivers

* No port opened on this computer that another program could use
* The grant covers every host the desk connects to, the SSH hosts included
* A key file's content and any secret stay out of the plugin, the store and the logs
* An SSH host's key is checked, and a changed one is not accepted silently
* An error says which hop failed: the jump host, the SSH host, its sign-in or its host key, the
  forward, or the database
* No new program the plugin must spawn, and nothing that only works where OpenSSH is installed

## Considered Options

* The core opens the tunnel in-process (a pure-Rust SSH client), one per session, and hands the
  database stream to desk-pg; each stream is a `direct-tcpip` channel
* The plugin spawns `ssh -L` and points the session at the local port
* The core spawns `ssh -L` (or `ssh -W`) itself

and, for host keys:

* Trust on first use: the fingerprint is shown, kept per plugin by the core after the person's yes,
  and a changed key refused until the person forgets it
* Read and write the person's `~/.ssh/known_hosts`
* Accept any key

## Decision Outcome

Chosen options: "the core opens the tunnel in-process" and "trust on first use".

**The tunnel.** `db.open` takes `ssh`: host, port, user, exactly one way to sign in (`keyFile` and its
`keyPassword`, `agent`, `password`, or `passwordRef`, a password kept with `db.passwords.*`), the
`hostKey` fingerprint the person accepted, and an optional `jump` hop of the same shape. The core checks
`db:connect` for the database and every hop before anything connects, opens the SSH connection on
`crates/desk-ssh` (`russh`, pinned, ring), and gives desk-pg a `Dial`: each database stream, a cancel
request's too, is a `direct-tcpip` channel on that connection. Nothing listens, so no other program on
the computer can use the tunnel; a local forward would have opened a port any local process could reach
while it lives. The tunnel closes with its session. Spawning `ssh` would need a program the manifest does
not name, would depend on OpenSSH and its configuration on each system, and would answer failures as
text on standard error, where the hop is hard to tell.

**Keys and secrets.** The core reads the key file (a full path or `~/`, at most 64 KiB); the plugin
keeps its path only. An encrypted key answers `keyPassword: needed` or `wrong`, a refused or missing
password the hop's `auth` stage; the plugin asks with its password prompt and holds what was typed in
memory for the desk's session. The SSH agent is the system's (`SSH_AUTH_SOCK`, the OpenSSH agent's pipe
on Windows).

**Host keys.** An unknown key answers `ssh.hostKey` (`unknown`, the algorithm and `SHA256:` fingerprint)
and opens nothing; the plugin shows the fingerprint, and after a yes opens again with `hostKey` set. The
core keeps it in `db-ssh-hosts.json` by plugin and `host:port`. A different key later is refused with both
fingerprints until `db.hostKeys.delete` forgets it (the command **Database: forget the SSH host key**).
`known_hosts` would mix the desk's trust with every other program's and is parsed differently across
systems; accepting any key would let anyone on the path read the database's traffic and password.

**Agents.** Agents reach databases through the plugin, as before (ADR 0281): they use a tunnel only as
a connection already defines it, are refused `db.hostKeys.delete`, and are never asked to trust a key or
type a secret.

### Consequences

* Good, because no local port exists and every host the desk reaches is in the grant.
* Good, because each failure is answered with its hop and stage in words.
* Bad, because a second SSH client lives in the core (a dependency to keep current), and features of
  OpenSSH's configuration (ProxyCommand, `~/.ssh/config` aliases, certificates) are not read.
* Bad, because pg_dump and pg_restore still connect directly: backups of a tunnelled connection need
  the database reachable from this computer until they go through the core too.
* Neutral, because a key trusted by another program on this computer is asked for once more here.

### Confirmation

`crates/desk-ssh/tests/tunnel.rs` against an in-process SSH server, `crates/desk-core/tests/db_ssh.rs`
(grants, trust on first use, changed keys, every hop's failures),
`plugins/database/tests/tunnel-*.test.ts`, and the live tests `crates/desk-core/tests/db_ssh_live.rs` and
`plugins/database/tests/tunnel-live.test.ts` against a real SSH server with a database only it reaches.
