---
status: accepted
date: 2026-11-16
decision-makers: Team endue
---

# A notice raised while endue is out of sight reaches the OS's notifications

## Context and Problem Statement

`desk-sys` posts native notifications on macOS (UserNotifications), Windows (toasts) and Linux
(freedesktop), but nothing turned its `notification` feature on: a notice raised while endue is
hidden, has no window, or sits behind another app showed only in the desk's status line or on the
island (ADR 0204), and was lost if neither was on screen. Who decides that a notice goes to the OS:
the page, which knows every notice and desk.notify's rules, or the shell, which knows the windows
and owns the OS? And what does a click on one do? (#306)

## Decision Drivers

* Every notice counts: a plugin's `ui.notified` and the runtime's own (an update's Restart), which
  never leave the page
* Do not disturb and its allowed levels apply as they do in the desk
* Never twice: not a notice the island already shows
* The OS asks for permission once, on the first notice that needs it, never at start
* Tests never post a real notification

## Considered Options

* The page decides which notices go and the shell decides whether now (`desk_notice_post`)
* The shell alone, hearing `ui.notified` from the core
* The page alone, with the shell posting whatever it is sent

## Decision Outcome

Chosen option: "the page decides which, the shell decides when", because only the page sees the
runtime's own notices and desk.notify's rules, and only the shell knows at the moment of posting
whether the desk is in front and whether the island shows.

* **The page** (`apps/desk/src/system-notices.ts`) hears every notice that shows (`notices.onShown`:
  not one do not disturb holds back) and, unless `desk.notify.system` is `never`, sends it with its
  title, body, first action's label, `when` (`background`, the default, or `always`) and whether it
  came as `ui.notified` (`island`).
* **The shell** (`apps/desk/shell/src/system_notices.rs`) posts it unless `when` is `background` and
  the desk is in front, or it came as `ui.notified` and the island is on screen. The notifier is made
  on the first post; the first post that needs it asks the OS, on a thread of its own, and a refusal
  is never asked again (desk-sys's rule).
* **A click** brings the desk forward and tells the page `notice://activated { id, action }`; the
  page runs the notice's first action (`action: true`, its button) or opens what it is about.
* **desk-sys**: a `Notification` carries at most one button label (`action`), and a `Click` says
  whether it was the button: a UNNotificationCategory per label on macOS, a toast `<action>` on
  Windows, a second freedesktop action on Linux.

### Consequences

* Good, because nothing a person should see is lost while endue is out of sight, and the island
  and the OS never show the same notice at once.
* Good, because the policy is tested in TypeScript and the wiring in Rust against desk-sys's fake.
* Bad, because a notice's second and later actions are not offered in the OS's notification.
* Bad, because a bare debug build (no app bundle on macOS) has no OS notifications; only the bundled
  desk does.

## More Information

Issue #306; ADR 0204 (the island); ADR 0113 (a plugin's notice opens what it is about);
`plugins/notify/README.md` (`desk.notify.system`).
