---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0129 (no remote picture; the back of an agent's card lists its status; the endue half
of the agent bar). Amends ADR 0223: an agent's Studio is also drawn on the desk, as a board; its
pages still open live.

# An endue agent shows its face, and its card turns over to its Studio board

## Context and Problem Statement

Signed in, the agent bar listed the person's endue agents as initials, the agent programs on this
computer above them as two letters (CC, Cx), and an agent's card turned over to a list of facts.
The person asked for three things: the agents' own profiles in the bar, from endue's server; the
programs on this computer each under its own mark; and the back of the card laid out as endue.ai's
Studio is, so that choosing an agent and turning its card is where it is set up. (They had also
asked for the programs to stand under the spaces; the bar's design, #291 and #292, keeps them
first, and that stands.) The desk's page loads no remote image (its CSP), ADR 0129 let no picture across the bridge, and
ADR 0223 chose to show endue.ai's Studio only as a live page, because the web's code is closed.

## Decision Drivers

* The face endue.ai shows for an agent, without the page loading anything remote and without the
  token leaving the core
* Studio's board where the person already is: on the card they chose, one turn away
* Nothing of the web's code in this repository; what is built here is the desk's own
* The desk never says something about an agent it did not read

## Considered Options

* The core reads the face and hands it over as a data: URL; the board is built here from `studio.*`
* Loosen the page's CSP to load pictures from endue's hosts
* Put endue.ai's live Studio page on the back of the card (a web view inside a card that turns)

## Decision Outcome

Chosen option: "the core reads the face, and the board is built here", because the CSP stays as it
is, a web view cannot turn with a card, and the board is the part of Studio the person reads first.

* **Face.** `studio.agents.picture` answers an agent's face as a data: URL. The core reads the
  agent and takes the address from that answer alone, in endue.ai's order: the still of the
  character that is on (`character_image_url`), else the picture the person set (`avatar_url`),
  else the one endue.ai draws from the slug (DiceBear, the same seed). It reads https only, sends
  no token, allows no host but the picture's own, keeps PNG, JPEG, GIF, WebP and SVG up to 512 KB,
  and remembers 128 faces by address. A face that cannot be read leaves the initial.
* **Agent bar.** The endue agents show their faces, in the bar and in its unfolded list; the shell
  reads them four at a time after the list. The programs on this computer keep their place (first,
  before a rule, #292) and their avatar (#291), with Claude's and OpenAI's marks (Simple Icons' path
  data, CC0) drawn inside in the text's colour instead of two letters.
* **Board.** The back of an agent's card is the Studio board: where requests come in (console
  chat, channel, Live, API, MCP), the agent's sheet (face, name, state, what it does in a sentence,
  prompt, memory, traits, model, wallpaper, skills, built-in tools), and what it reaches
  (connectors, devices, outputs), with a line from each row to the agent. A line is solid while on,
  dashed while off, red for a problem. The agent's answer now carries `description`, `liveEnabled`
  and `mcpEnabled`.
* **Every row read.** `studio.agents.facets` also reads what the rest of the board shows, through
  the same gateway and token: the channel pairings, the API keys made for this agent alone (keys
  for every agent are the account's, not the board's), the endue OS devices attached to it and its
  workspaces (a workspace's own device counted once, workspaces turned off read as none), how many
  of its newest 200 memories are live and how many of those are rules, how many artifacts it made
  and when the newest changed, and its chat's wallpaper by name. Only what a row shows crosses the
  bridge: no secret, key prefix or scope, memory, wallpaper manifest or artifact name. A row whose
  facet endue AI did not answer is drawn as not read, says to look on endue.ai, and counts nothing;
  the board decides on and off as endue.ai's does (a channel while one is active, the API while a
  key has not expired).
* **Setting up.** The board only reads. Every row, every line of the sheet and every action opens
  that part of endue.ai's Studio (`/agent/<id>/studio/<section>`) in a desk window (ADR 0223).
* **Built here.** The board's layout, its words and the order of its rows follow endue.ai's Studio.
  The code is written for the desk (its DOM builder, its tokens, its icons); no file of the web's is
  copied. The maintainers, who own both, decided to show this much of Studio's look here.

### Consequences

* Good, because the bar and the cards show the agents as endue.ai does, and the page still loads
  nothing remote.
* Good, because the card the person chose is where Studio starts, and a narrow window stacks the
  board instead of cutting it.
* Bad, because there are now two drawings of Studio's board to keep in step by hand, which ADR 0223
  set out to avoid; when endue.ai's board changes, this one follows late.
* Bad, because for an agent without a picture the core asks api.dicebear.com with the agent's slug,
  as endue.ai's web does for everyone who sees the agent.
* Bad, because turning a card asks endue AI fourteen things at once after the agent itself (each
  on its own thread, 15 s at most), where Studio's page asks for them as its panels need them.
* Bad, because nothing is changed on the board itself: every change is made on endue.ai.
* Bad, because the marks are Anthropic's and OpenAI's: they name whose program a button opens, and
  a fork that may not show them replaces `packages/runtime/src/shell/marks.ts`.

## More Information

Spec: `specs/bridge/v0/studio.schema.json` (`studio.agents.picture`, `StudioAgent`, the board's
facets), `specs/platform/v0/openapi.yaml` (`AgentGetResponse` and the seven reads of the board).
Client: `crates/desk-platform/src/pictures.rs`, `board.rs`, `wire_board.rs`. Core:
`crates/desk-core/src/studio/picture.rs`, `rows.rs`. Runtime: `packages/runtime/src/system/endue.ts`
(`readPictures`), `shell/SideBar.ts`, `shell/SideBarEndue.ts`, `shell/marks.ts`,
`surface/endue/board*.ts` (the columns in `board-rows.ts`) and `board.css`. Builds on ADR 0110, 0122, 0129 and 0223.
