---
status: accepted
date: 2026-11-17
decision-makers: Team endue
---

# The Network plugin looks only at the private network it is on, with macOS's own programs, after the person says they run it

## Context and Problem Statement

People want to know who is on their home network, whether it is safe and why it is slow, in words they
can act on rather than a list of addresses. Answering takes looking at the network: the ARP table, a
ping to each address, each device's name, a try at its common ports, the Wi-Fi channels around. The
same look pointed at a network the person does not run, or at the internet, is a scan of someone else's
machines. The plugin needs rules for what it may look at, with what, and when.

## Decision Drivers

* The value is the meaning and the next step, not a port scanner
* Never probe beyond the network this computer is on, or one the person does not run
* No tool to install, no shell, nothing that leaves the machine
* What reaches the brain never names the person's devices or the networks around

## Considered Options

* Bundle a scanner (nmap, Npcap) and scan what the person types
* macOS's own programs (`arp`, `ping`, `route`, `ifconfig`, `dig`, `system_profiler`) and the core's
  `net.connect`, limited in code to the current private network
* Read only what the OS already knows (the ARP table), never ping or connect

## Decision Outcome

Chosen option: macOS's own programs and `net.connect`, limited in code, because they ship with every
Mac, run under the bridge's `proc:spawn` and `net:connect` checks without a shell, and show enough to
explain a network; a bundled scanner would reach any address and need installing, and the ARP table
alone misses sleeping devices and every port.

* Only RFC 1918 addresses of the network the default route leaves by; public, link-local, CGNAT and other
  ranges are refused before any program or socket is asked (`ipv4.js`).
* Before the first sweep of a network the person is asked, once per network (keyed by the router's MAC
  address), whether they administer it; a no keeps the plugin to the ARP table and one ping to the router.
* A network wider than /24 is never swept: its ARP table is all that is read.
* Ports: a fixed list of 38, each connected to and closed at once, nothing sent, and asked for with
  `perm.request` per device, the way Screen Sharing asks per computer (ADR 0133).
* Wi-Fi is only listened to (`system_profiler`); SSIDs macOS hides without Location Services stay hidden.
* "Explain simply" sends a device's kind, manufacturer and open ports and the score's items; names and
  SSIDs stay on the machine.

### Consequences

* Good, because nothing beyond the person's own network can be touched, whatever an agent asks
* Good, because there is nothing to install, and every probe is a program the person can read about
* Bad, because a sweep of a /24 is 253 `ping` processes, about twenty seconds, where a scanner takes one
* Bad, because macOS alone for now: Windows and Linux need their own programs and words
* Bad, because without Location Services the Wi-Fi tab draws channels without names

## More Information

`plugins/network/README.md`; `docs/ko/network-plugin-requirements.md` (NET-01–19, NF-01–08). ADR 0039
(programs through the CLI without a shell), ADR 0087 (universal views), ADR 0088 (commands as agents'
tools), ADR 0133 (TCP sockets cross the bridge), ADR 0250 (message catalogs).
