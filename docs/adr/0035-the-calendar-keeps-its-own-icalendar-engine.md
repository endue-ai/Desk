---
status: accepted
date: 2026-10-31
decision-makers: Team endue
---

# The calendar plugin keeps its own iCalendar engine and writes back everything it read

## Context and Problem Statement

`endue.calendar` is the base plugin the requirements list for calendars (`docs/ko/desk-requirements.md`,
BASE, stage 3) and the surface of first-run scenes 6 to 8 ("two of tomorrow's meetings overlap"). It must
read the files other apps write (Google Calendar, Outlook and Exchange, Apple Calendar), show their
repeating events where those apps show them, and save without losing anything they wrote. A plugin folder
is served as plain ES modules with no bundler (ADR 0010, ADR 0012), and the item, view and connector
layer (ADR 0032) is still being built, so the plugin works on `.ics` files through the bridge it has today.

## Decision Drivers

* Standards: RFC 5545 in full for reading (every RRULE part, RDATE, EXDATE, RECURRENCE-ID, VTIMEZONE,
  VALARM), RFC 6868 parameter values, RFC 7986 calendar names and colours, RFC 9074 ACKNOWLEDGED, and the
  RFC 5546 habits other apps rely on (UID, DTSTAMP, SEQUENCE)
* Fidelity: an unchanged file saves byte for byte; an edit changes only the properties it touches;
  properties, parameters and components the plugin does not know are kept
* Time zones the way the apps mean them: IANA names, Windows names, prefixed TZIDs, the file's own
  VTIMEZONE; a local time a change skips or repeats read as §3.3.5 says
* Plain modules, no new dependency in the lockfile, files of at most 400 lines (AGENTS.md rule 4)
* The same events reach agents and views as `specs/item/v0` items, through commands (ADR 0032 AX-01)

## Considered Options

* Our own engine in `plugins/calendar/ui/ical/`, conformance-tested against the RFC's examples
* A library vendored into the plugin (ical.js, MPL-2.0; rrule.js): proven, but large, with its own
  time-zone tables, and a second licence and update stream inside a plugin folder
* Reading through the item index and the OS calendar connector (#94, #98): no files, no RRULE editing,
  and not available yet

## Decision Outcome

Chosen option: "our own engine", because the plugin needs exactly the RFC's semantics plus round-trip
fidelity, and a small engine tested against every recurrence example of RFC 5545 §3.8.5.3 does both
without a dependency.

* **Parsing never throws.** A line that does not parse is kept verbatim and named as a problem; a file
  with text but no VCALENDAR opens read-only, so a save cannot overwrite it.
* **Values stay as written.** A property keeps its name, parameters and raw value, and the text before
  its value; it is decoded when read and re-encoded only when changed.
* **Recurrence is computed in wall time** in the zone of DTSTART, with DTSTART always the first instance,
  then turned into instants; instances meet EXDATE and RECURRENCE-ID by their UTC instant, so a value
  written in another zone or in UTC (as Google writes it) still matches.
* **A TZID is resolved in this order:** an IANA name through the platform's tz database (Intl), a
  Windows name (CLDR's table), the file's VTIMEZONE, an IANA name at the end of a prefixed TZID, else
  floating, said as a problem. Floating times use the calendar's X-WR-TIMEZONE when it names a zone.
* **Edits are scoped.** One instance becomes an override (RECURRENCE-ID written as DTSTART is) or an
  EXDATE; "this and following" ends the series with UNTIL (COUNT is split) and starts a new UID; "all"
  moves EXDATE, RDATE and overrides with the series. DTSTAMP and LAST-MODIFIED change on every edit,
  SEQUENCE when times or rules change; a VTIMEZONE is added for every IANA TZID the file names.

### Consequences

* Good, because files from the three big apps read as those apps show them and come back unchanged;
  the conformance tests say what the engine does, line by line from the RFC.
* Good, because agents get the same events as items (`endue.calendar.events`, `.conflicts`, `.add`),
  ready for the index and views when ADR 0032's layer lands.
* Bad, because the engine is ours to keep: RSCALE and SKIP (RFC 7529) are refused rather than guessed,
  RANGE=THISANDFUTURE applies to one instance, and VTODO, VJOURNAL and VFREEBUSY are kept but not shown.
* Bad, because Intl knows offsets, not rules: generated VTIMEZONEs use a yearly rule only when the next
  years follow it, and list the changes year by year otherwise.
* Bad, because CalDAV (RFC 4791) and subscriptions by URL wait for `net.fetch` in the core (#77) and
  belong in a connector (ADR 0032), not in this plugin.

## More Information

`plugins/calendar/README.md`; tests in `plugins/calendar/tests` (`recur.test.ts` holds the RFC examples,
`interop.test.ts` the three apps' files). ADR 0010 and 0012 (plain modules, UI plugins), ADR 0032
(items, views, connectors). Issues #94, #95, #98 (index, views, the OS calendar connector) and #77
(`net.fetch`).
