/**
 * An endue agent's window (ADR 0129): a card after endue.ai's agent card (who it is, with its face,
 * its role, what it is like now, its skills and model) that Studio turns over to the agent's
 * Studio board (ADR 0232): where requests come in, the agent's sheet, and what it reaches. It reads
 * the agent's facets on the way in and redraws as they, the agents, the faces or the conversations
 * change.
 */
import type { ShellCtx } from "../../shell/context";
import { h, render } from "../../shell/dom";
import { ENDUE_AGENT_VIEW, readFacets } from "../../system/endue";
import { openAgentStudio } from "../../system/endue-studio";
import type { Mounted } from "../views";
import { lineSpecs, studioBoardView } from "./board";
import { boardLines } from "./board-lines";
import { studioBoard } from "./board-model";
import { flipCard } from "./flip";
import { agentFront, dotOf } from "./model";
import { actions, avatar, flipButton, notice, type Page, readLine, text } from "./parts";

export { dotOf } from "./model";

export function endueAgentBody(ctx: ShellCtx, id: string): Mounted {
  const view = `${ENDUE_AGENT_VIEW}${id}`;
  const el = h("div", { class: "endue-view", "data-endue-agent-view": id });
  const again = () => void readFacets(ctx, id, true);
  const lines = boardLines();
  let was: boolean | undefined;
  /** The row of the board that is unfolded: this window's own, gone with it. */
  let expanded: string | null = null;
  const draw = () => {
    const s = ctx.store.get();
    const agent = s.endue.agents.find((a) => a.id === id);
    if (!agent) {
      was = undefined;
      lines.dispose();
      render(el, () => [notice(ctx, s.endue, again)]);
      return;
    }
    const read = s.endue.facets[id];
    const picture = s.endue.pictures[id];
    const flipped = s.endue.flipped.includes(view);
    const turned = was !== undefined && was !== flipped;
    was = flipped;
    const front = agentFront(s.lang, agent, read, s.endue.conversations);
    const board = studioBoard(s.lang, agent, read, s.endue.conversations);
    // The agent's Studio in the Agents plugin, inside the desk: never endue.ai's pages.
    const pages: Page[] = [
      ["open-studio", "editInStudio", () => void openAgentStudio(ctx, id).catch(() => undefined)],
    ];
    render(el, () => [
      flipCard({
        view,
        flipped,
        turned,
        frontLabel: front.name,
        backLabel: text(ctx, "studio"),
        ...(front.colour ? { colour: front.colour } : {}),
        front: [
          h(
            "header",
            { class: "endue-head" },
            avatar(front.initial, front.colour, true, picture),
            h(
              "div",
              { class: "endue-who" },
              h(
                "h2",
                { class: "endue-name" },
                h("span", { class: "endue-title" }, front.name),
                h("span", { class: "endue-badge" }, text(ctx, "badge")),
              ),
              h(
                "p",
                { class: "endue-handle" },
                [front.handle, front.role].filter(Boolean).join(" · "),
              ),
            ),
            flipButton(ctx, "front", view),
          ),
          h(
            "p",
            { class: "endue-presence", "data-presence": front.presence },
            h("span", { class: `dot ${dotOf(front.presence)}`, "aria-hidden": "true" }),
            front.presenceLabel,
          ),
          readLine(ctx, read, again),
          h(
            "p",
            { class: `endue-desc${front.description ? "" : " is-empty"}` },
            front.description || text(ctx, "noDescription"),
          ),
          front.chips.length
            ? h(
                "ul",
                { class: "endue-chips" },
                front.chips.map((chip) => h("li", { class: "tag" }, chip)),
              )
            : null,
          actions(ctx, "front", pages, again),
        ],
        back: [
          h(
            "header",
            { class: "endue-head" },
            h(
              "div",
              { class: "endue-who" },
              h("h2", { class: "endue-name" }, text(ctx, "studio")),
              h("p", { class: "endue-handle" }, front.name),
            ),
            flipButton(ctx, "back", view),
          ),
          readLine(ctx, read, again),
          studioBoardView(ctx, board, {
            agentId: id,
            ...(picture ? { picture } : {}),
            expanded,
            toggle: (row) => {
              expanded = expanded === row ? null : row;
              draw();
            },
          }),
          actions(ctx, "back", pages, again),
        ],
      }),
    ]);
    const drawn = el.querySelector<HTMLElement>("[data-studio-board]");
    if (drawn) lines.attach(drawn, lineSpecs(board, expanded));
  };
  draw();
  void readFacets(ctx, id);
  const unwatch = ctx.store.watch(
    (s) => [
      s.endue.state,
      s.endue.agents.find((a) => a.id === id),
      s.endue.facets[id],
      s.endue.pictures[id],
      s.endue.conversations,
      s.endue.flipped.includes(view),
      s.lang,
    ],
    draw,
  );
  const off = () => {
    unwatch();
    lines.dispose();
  };
  return { el, off };
}
