---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0129 (a card's "Open in endue.ai" opens the system browser).
Amended by ADR 0232: the back of an agent's card is its Studio board, built on the desk; each of
its rows opens that part of endue.ai's Studio as this ADR shows a page.

# endue.ai's own pages show in a desk window

## Context and Problem Statement

An endue agent opens on the desk as a card that turns over to its status (ADR 0129). The card and
its Studio face are the desk's own: built here, after endue.ai's, from the few fields the bridge
lets through. endue.ai has the real things: the agent's page with its rooms, and Studio with its
canvas. The person asked for those to be used as they are, rather than built a second time, and
pointed at the web's code.

The web's code is closed. This repository is public and Apache-2.0, and its boundary says closed
services stay outside it and are reached only through their public contracts and clients. Its
HTML, scripts and styles cannot be copied here; copied, they would also drift from the web at once
and need its private API, its session and its build. Since ADR 0216 the desk can show a live web
page in a window: a web view, a browser of its own that reads nothing of the desk.

## Decision Drivers

* The agent's page and Studio are endue.ai's own, exactly as the web has them, and stay so as the
  web changes
* Nothing closed enters this repository
* No second implementation of Studio to keep in step
* The card stays for what it is good at: who the agent is and how it is, at a glance, from what
  the bridge may show
* Works today, with the web as it is

## Considered Options

* The card's actions show endue.ai's pages live in a desk window (the Browser's web view)
* Copy the web's agent and Studio pages into the desk
* The agent's window is the web page itself, no card
* The system browser, as it was

## Decision Outcome

Chosen option: "The card's actions show endue.ai's pages live in a desk window", because it is the
web's own page with nothing copied, and it needs nothing of the web that the web does not have yet.

* **The pages** (`packages/runtime/src/system/endue-ids.ts`): an agent's own page,
  `https://endue.ai/agent/<id>`, and its Studio, `https://endue.ai/agent/<id>/studio`; a space's,
  `https://endue.ai/spaces/<id>`. Ids are one encoded path segment and nothing but endue.ai's
  origin is ever shown, as before.
* **The card** (`surface/endue/agent.ts`, `parts.ts`): an agent's card has "Agent page" and
  "Studio page" at its foot, on both faces; a space's keeps "Open in endue.ai". Each shows its
  page in a desk window.
* **Showing one** (`system/endue-web.ts`, `showOnDesk`): the desk opens the Browser
  (`desk.plugins.open`, `endue.browser`) and sends it to the page (`endue.browser.go`), asking
  again for up to three seconds while its window loads. Where there is no Browser (a host without
  it, the plugin disabled) or it never hears, the page opens in the system browser, as it did.
* **Signing in**: the web view is a browser of its own and keeps its cookies to itself (ADR 0216).
  The desk's endue ID session is the core's and is not handed to it, so the person signs in to
  endue.ai in that window once.

### Consequences

* Good, because Studio in the desk is the web's Studio: its canvas, its rooms, every feature the
  day the web ships it
* Good, because no closed code and no private API enter the repository
* Bad, because it is one more sign-in: the desk is signed in and the page in its window is not,
  until the person signs in there
* Bad, because the page comes with the web's own frame (its navigation, its account menu) inside
  the desk's window: the web has no layout made for being shown inside another app
* Bad, because the Browser is one window: a second agent's page replaces the first
* Neutral: the card's own Studio face stays, for the status the bridge may show without a sign-in
  to the web

## More Information

What would make the web page the agent's window itself, with no card and no second sign-in, is not
the desk's to build: a layout of the web's for being embedded (no navigation of its own), and a
way for endue ID to sign the web view in from the desk's session. Both belong to the closed web and
platform. With them, the agent bar could open the page directly, one window per agent.

`packages/runtime/src/system/endue-web.test.ts`, `surface/endue/windows.test.ts`,
`packages/runtime/e2e/endue-windows.spec.ts`.

## Pros and Cons of the Options

### Copy the web's pages into the desk

* Good, because the look is the web's at the moment of the copy, with no second sign-in
* Bad, because it publishes closed code under Apache-2.0 and cannot be taken back
* Bad, because the copy needs the web's private API and session, and falls behind the web from the
  first change

### The agent's window is the web page itself

* Good, because it is what the person sees on endue.ai, with nothing in between
* Bad, because today that page asks for a sign-in and carries the web's whole frame; the card,
  which needs neither, would be lost for it

### The system browser

* Good, because the person is signed in there already
* Bad, because it leaves the desk, which is what the request is about
