/**
 * An endue agent's window (ADR 0129): a card after endue.ai's agent card (who it is, its role, what
 * it is like now, its skills and model) that Studio turns over to the agent's status. It reads the
 * agent's facets on the way in and redraws as they, the agents or the conversations change.
 */
import type { ShellCtx } from "../../shell/context";
import { h, render } from "../../shell/dom";
import { agentPage, ENDUE_AGENT_VIEW, readFacets } from "../../system/endue";
import type { Mounted } from "../views";
import { flipCard } from "./flip";
import { agentFront, agentStudio } from "./model";
import { actions, avatar, facts, flipButton, notice, readLine, text } from "./parts";

export function endueAgentBody(ctx: ShellCtx, id: string): Mounted {
  const view = `${ENDUE_AGENT_VIEW}${id}`;
  const el = h("div", { class: "endue-view", "data-endue-agent-view": id });
  const again = () => void readFacets(ctx, id, true);
  let was: boolean | undefined;
  const draw = () => {
    const s = ctx.store.get();
    const agent = s.endue.agents.find((a) => a.id === id);
    if (!agent) {
      was = undefined;
      render(el, () => [notice(ctx, s.endue, again)]);
      return;
    }
    const read = s.endue.facets[id];
    const flipped = s.endue.flipped.includes(view);
    const turned = was !== undefined && was !== flipped;
    was = flipped;
    const front = agentFront(s.lang, agent, read, s.endue.conversations);
    const studio = agentStudio(s.lang, agent, read, s.endue.conversations, ctx.wall());
    const page = agentPage(id);
    render(el, () => [
      flipCard({
        view,
        flipped,
        turned,
        frontLabel: front.name,
        backLabel: text(ctx, "studioTitle"),
        ...(front.colour ? { colour: front.colour } : {}),
        front: [
          h(
            "header",
            { class: "endue-head" },
            avatar(front.initial, front.colour, true),
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
          actions(ctx, "front", page, again),
        ],
        back: [
          h(
            "header",
            { class: "endue-head" },
            h(
              "div",
              { class: "endue-who" },
              h("h2", { class: "endue-name" }, text(ctx, "studioTitle")),
              h("p", { class: "endue-handle" }, front.name),
            ),
            flipButton(ctx, "back", view),
          ),
          readLine(ctx, read, again),
          facts(studio),
          actions(ctx, "back", page, again),
        ],
      }),
    ]);
  };
  draw();
  void readFacets(ctx, id);
  const off = ctx.store.watch(
    (s) => [
      s.endue.state,
      s.endue.agents.find((a) => a.id === id),
      s.endue.facets[id],
      s.endue.conversations,
      s.endue.flipped.includes(view),
      s.lang,
    ],
    draw,
  );
  return { el, off };
}

/** The shell's dot for a presence: working and waiting stand out, the rest are quiet. */
export function dotOf(presence: string): string {
  if (presence === "working") return "dot-active";
  if (presence === "waiting") return "dot-attention";
  if (presence === "online") return "dot-success";
  return "dot-idle";
}
