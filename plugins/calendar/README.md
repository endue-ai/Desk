# plugins/calendar

`endue.calendar`, iCalendar files (RFC 5545) in month, week, day and agenda views, in the community folder
format and on the public SDK only. `contributes.files` opens `*.ics`, `*.ical` and `*.ifb`; `Mod+Shift+C`
(Open my calendar) opens `~/Calendar/calendar.ics`, made empty when missing. ADR 0035 says why it keeps
its own iCalendar engine and what it reads.

It reads every RRULE (all FREQs, BYxxx expand and limit, BYSETPOS, WKST, COUNT, UNTIL), RDATE, EXDATE and
RECURRENCE-ID overrides; TZIDs that are IANA names, Windows names or the file's VTIMEZONE; DATE, floating
and UTC times; VALARM reminders. A save writes back everything it read: an unchanged file byte for byte,
an edit only the properties it changed, plus a VTIMEZONE for each TZID it writes. A series asks whether
a change or a deletion is for this event, this and following events, or all of them.

It answers the desk's `desk.files.visit`, `.save`, `.revert`, `desk.buffers.show` and `.closed`, as
`plugins/notes` does, with the same one ask on a refused read or write. Its commands for agents take an
argument schema: `endue.calendar.events` and `.conflicts` answer `specs/item/v0` event items and the busy
events that overlap; `.add` adds an event, unsaved until the person saves.

| Permission | Why |
| --- | --- |
| `fs:read`, `fs:write` (`${home}/Calendar/**`) | Read, watch and save calendars |
| `cmd:invoke` (`desk.files.changed`, `.open`, `desk.buffers.update`, `desk.palette.pick`) | Changes on disk, the unsaved mark, Open my calendar, Go to a date |
| `ui:notify` | Reminders, while the calendar is open |

| Folder | Purpose |
| --- | --- |
| `ui/ical/` | RFC 5545: content lines, components, values, RRULE and its expansion, time zones, VTIMEZONE |
| `ui/calendar/` | Events and occurrences, edits by scope, items, conflicts, alarms, view layouts |
| `ui/*.js` | The controller (`calendar.js`), files, editing, agent commands, reminders, the DOM |

Keys when no field has the focus: `t` today, `j`/`k` next and previous, `m` `w` `d` `a` views, `c` new
event, `g` go to a date; arrow keys move between days in the month grid. Settings start with
`endue.calendar.` (file, view, week-start, time-zone, event-minutes, reminder-minutes, day-start,
reminders).

```bash
pnpm exec vitest run plugins/calendar
cargo run -p desk-cli -- plugin validate plugins/calendar
```
