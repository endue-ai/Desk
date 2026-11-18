---
status: accepted
date: 2026-11-18
decision-makers: Team endue
---

# A web view's page is read and operated under a grant of its own

## Context and Problem Statement

A person asked Eris to scroll the Browser and was told it could not: the Browser offered two commands,
go to an address and load again, and nothing on the desk scrolls a page. A web view (ADR 0216) is
shown and stepped by its plugin and by nothing else: the plugin places it, loads an address and hears
its title, and the page is deliberately out of its reach. For the assistant to use the web as the
person does it has to see what a page says and scroll, press, type and choose in it. How does a plugin,
and through its commands the assistant, read and operate a page without the page getting anything of
the desk, without a grant to show pages turning into a grant to see them, and without taking the keys
from the person who is typing somewhere else?

## Decision Drivers

* The page still gets nothing of the desk: no bridge, no desk script it can see or change (ADR 0216)
* Deny by default (ADR 0012): seeing a page the person is signed in to is not what `web:browse` asked
* A page takes the acts as a person's: sites that tell a script's click from a press keep working
* The person's keys stay where they are while the assistant works in a page
* What the assistant gets is text it can read and act on, small enough for one tool result
* An act that may send something off waits for the person, as other agents' acts do (ADR 0078)

## Considered Options

* Two bridge methods, `web.read` and `web.act`, under a new `web:control`, done by the shell in the page
* `web.eval`: the plugin sends script to run in the page
* The accessibility tree of the view, read and acted on through `a11y.*`
* The assistant drives the page through `computer.*` (screenshots, the OS pointer and keyboard)
* Reading and acting under `web:browse` itself

## Decision Outcome

Chosen option: "`web.read` and `web.act` under `web:control`", because it is the only one that keeps
what runs in a page the desk's own, fixed and small, gives the assistant words and not pixels, and
leaves the person a grant that says what it gives.

* **Bridge** (`specs/bridge/v0/web.schema.json`). `web.read` answers the page of one of the caller's
  views: its address, title, where it is scrolled to, and its text in reading order, a part at a time
  (`from`, `max`, `length`). Every element that can be acted on is written in the text as
  `[ref kind "name"]`, a field with what it holds, a box or a choice with its state; a password is
  never in it, what the page hides is left out, a frame is named and not read, and a bracket of the
  page's own words is written wide, so a page cannot write an element of its own making. `web.act` does one
  thing, named by `do`: `scroll`, `show`, `press`, `type`, `key`, `choose`, on a `ref` the read gave.
  A ref holds while its element is in the page.
* **Permission.** `web:control`, with optional `hosts`, apart from `web:browse`. The core checks it
  against the address the shell last reported for the view (`core_web_control.rs`) and tells the
  shell that address; the page script refuses a page of another site (`moved`), so a page that went
  elsewhere between the check and the act is left alone.
* **The shell** (`web_host/web_page.rs`, `compositor_window/web_control.rs`). The page script
  (`web_page.js`, `web_page_text.js`) runs through the view's own DevTools agent in a world of the
  desk's (`Page.createIsolatedWorld`): the page's scripts neither see it nor change what it reads
  with, and it holds no desk object. A press is the pointer's own at the element's middle
  (`input::deliver`), typed text is `Input.insertText`, a key `Input.dispatchKeyEvent`, so the page's
  events are trusted ones; an element something lies over is clicked by the script instead, and a
  date or a colour is set whole. The view does not take the desk's keys:
  `Emulation.setFocusEmulationEnabled` lets its page keep a caret without them.
* **The Browser** (`plugins/browser`, `ui/agent.js`). Agent commands `go`, `reload`, `back`,
  `forward`, `read`, `scroll`, `click`, `type`, `key` and `select`; each acts, waits for the page to
  rest (no load for half a second, ten at most) and answers the page as it reads then, 4000
  characters a part. `read` is `readOnly`; `click`, `type`, `key` and `select` are `irreversible`, so
  an agent's call shows the person a card first (ADR 0078), once for a task if they say so.

### Consequences

* Good, because the assistant can use a page as a person does: read it, scroll it, follow links, fill
  in and send forms, and see what came of each act in the same answer
* Good, because a plugin that only shows pages still cannot see them, and a hosts grant cannot be
  walked to another site by a page that navigates
* Good, because nothing the plugin or the assistant writes runs in the page: the script is the shell's
* Bad, because a page's text can carry instructions meant for the assistant; the card before an act
  that may send something off is the guard, and it names the ref, not the element's words
* Bad, because only the main document is read: a frame, a canvas and a picture's content are not, and
  a page that needs a pointer held over something, a drag or a file gets none
* Bad, because the page believes it has the keys from the first typed text until the view ends

## More Information

Issue #404. Tests: `docs/qa/TESTING.md`. Checked on the running desk (`e2e/specs/browser-control.spec.ts`,
a page served on this machine): the page read as text with its elements named, the same refs on a
second read, a scroll to each end and to an element, text typed into a field with the page's own
`input` handler hearing it (Korean among it), Enter sending it, Backspace taking a letter, a press
the page saw as trusted (`isTrusted`), an option chosen, a link followed and the way back; the
surface the desk's keys went to was the same before and after. `web.eval` was left out because script a plugin sends
reads cookies and sessions of every site its views show and cannot be reviewed; the accessibility
tree because a view is not in it yet (ADR 0216) and its nodes carry no reading order of text; and
`computer.*` because it moves the person's own pointer and needs their screen.
