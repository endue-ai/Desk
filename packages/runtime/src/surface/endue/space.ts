/**
 * An endue space's window (ADR 0129): a card after endue.ai's space list (its look, goal, front
 * desk, agents and what is open) that Studio turns over to the space's status: counts, the agents
 * with their seats, the work going on, the newest results and its rooms. One of the person's own
 * agents opens its window from here.
 */
import type { ShellCtx } from "../../shell/context";
import { type Child, h, render } from "../../shell/dom";
import { ENDUE_SPACE_VIEW, openEndueAgent, readSpace, spacePage } from "../../system/endue";
import type { Mounted } from "../views";
import { flipCard } from "./flip";
import { type SpaceMember, spaceFront, spaceStudio } from "./model";
import { actions, avatar, facts, flipButton, lines, notice, readLine, text } from "./parts";

/** Faces shown on the front before the rest count as more. */
const FACES = 3;

function member(ctx: ShellCtx, m: SpaceMember, detailed: boolean): HTMLElement {
  const label = [m.name, m.seat, m.role].filter(Boolean).join(" · ");
  const body: Child[] = [
    avatar(m.initial, m.colour),
    detailed ? h("span", { class: "endue-member-name" }, m.name) : null,
    detailed
      ? h("span", { class: "endue-line-meta" }, [m.seat, m.role].filter(Boolean).join(" · "))
      : null,
  ];
  // The front's faces are a glance; the back's list opens the person's own agents.
  if (!m.own || !detailed)
    return h("span", { class: "endue-member", title: label, "aria-label": label }, ...body);
  return h(
    "button",
    {
      class: "menu-item endue-member is-own",
      type: "button",
      title: label,
      "aria-label": label,
      "data-member": m.agentId,
      onClick: () => openEndueAgent(ctx, m.agentId),
    },
    ...body,
  );
}

export function endueSpaceBody(ctx: ShellCtx, id: string): Mounted {
  const view = `${ENDUE_SPACE_VIEW}${id}`;
  const el = h("div", { class: "endue-view", "data-endue-space-view": id });
  const again = () => void readSpace(ctx, id, true);
  let was: boolean | undefined;
  const draw = () => {
    const s = ctx.store.get();
    const space = s.endue.spaces.find((sp) => sp.id === id);
    if (!space) {
      was = undefined;
      render(el, () => [notice(ctx, s.endue, again)]);
      return;
    }
    const read = s.endue.details[id];
    const flipped = s.endue.flipped.includes(view);
    const turned = was !== undefined && was !== flipped;
    was = flipped;
    const now = ctx.wall();
    const front = spaceFront(s.lang, space, read, s.endue.agents, now);
    const studio = spaceStudio(s.lang, space, read, s.endue.agents, now);
    const page = spacePage(id);
    const shown = front.members.slice(0, FACES);
    const more = front.members.length - shown.length;
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
            avatar(front.glyph, front.colour, true),
            h(
              "div",
              { class: "endue-who" },
              h(
                "h2",
                { class: "endue-name" },
                h("span", { class: "endue-title" }, front.name),
                h("span", { class: "endue-badge" }, text(ctx, "spaceBadge")),
              ),
              front.frontDesk ? h("p", { class: "endue-handle" }, front.frontDesk) : null,
            ),
            flipButton(ctx, "front", view),
          ),
          readLine(ctx, read, again),
          h(
            "p",
            { class: `endue-desc${front.goal ? "" : " is-empty"}` },
            front.goal || text(ctx, "noGoal"),
          ),
          shown.length
            ? h(
                "div",
                { class: "endue-members", "aria-label": text(ctx, "agents") },
                shown.map((m) => member(ctx, m, false)),
                more ? h("span", { class: "endue-more" }, `+${more}`) : null,
              )
            : null,
          front.chips.length
            ? h(
                "ul",
                { class: "endue-chips" },
                front.chips.map((chip) =>
                  h(
                    "li",
                    { class: "tag", ...(chip.tone ? { "data-tone": chip.tone } : {}) },
                    chip.text,
                  ),
                ),
              )
            : null,
          front.latest ? h("p", { class: "endue-latest" }, front.latest) : null,
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
          studio.problems.map((p) => h("p", { class: "endue-read is-failed", role: "alert" }, p)),
          facts(studio.facts),
          studio.members.length
            ? [
                h("h3", { class: "endue-section" }, text(ctx, "agents")),
                h(
                  "div",
                  { class: "endue-members is-list", "data-list": "agents" },
                  studio.members.map((m) => member(ctx, m, true)),
                ),
              ]
            : null,
          lines(text(ctx, "goingOn"), studio.work, "work"),
          lines(text(ctx, "newest"), studio.results, "results"),
          lines(text(ctx, "roomsList"), studio.rooms, "rooms"),
          actions(ctx, "back", page, again),
        ],
      }),
    ]);
  };
  draw();
  void readSpace(ctx, id);
  const off = ctx.store.watch(
    (s) => [
      s.endue.state,
      s.endue.spaces.find((sp) => sp.id === id),
      s.endue.details[id],
      s.endue.agents,
      s.endue.flipped.includes(view),
      s.lang,
    ],
    draw,
  );
  return { el, off };
}
