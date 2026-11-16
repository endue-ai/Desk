/**
 * The agent bar's endue half while the desk is signed in (ADR 0129): the person's endue agents,
 * each with the face endue.ai shows (ADR 0232) or its initial until that is read, the ones that
 * work or wait for them first, and the spaces they can open. Choosing either opens its window. An agent's state is `data-presence` (the ring the stylesheet draws), and the bar's
 * tooltip names it with the conversation it works on (bar-tip.ts). Past six agents the last place
 * opens the rest in a popover, as the directory's does, and New agent and New space end the groups
 * (bar-new.ts). Unfolded, each is a row of the bar's list (bar-list.ts): an agent's says the
 * conversation it works on and for how long, or its presence in endue's own words.
 */
import type { StudioAgent, StudioSpace } from "@endue-ai/bridge";
import { endueText } from "../surface/endue/copy";
import { initialOf, presenceText } from "../surface/endue/model";
import {
  ENDUE_AGENT_VIEW,
  ENDUE_SPACE_VIEW,
  type EnduePresence,
  enduePresence,
  facePicture,
  hexColour,
  openEndueAgent,
  openEndueSpace,
} from "../system/endue";
import { type BarEntry, barCaption, barControl, oneLine } from "./bar-list";
import { barMore, barWord, newAgentControl, newSpaceControl } from "./bar-new";
import { workLine } from "./bar-tip";
import type { ShellCtx } from "./context";
import { type Child, h } from "./dom";
import { icon } from "./icons";
import type { DeskState } from "./state";

const VISIBLE = 6;
const ORDER: EnduePresence[] = ["working", "waiting", "online", "paused", "offline"];

/** The agents the bar lists: not archived, working and waiting first, then as endue listed them. */
export function barAgents(s: DeskState): { agent: StudioAgent; presence: EnduePresence }[] {
  return s.endue.agents
    .filter((agent) => agent.status === "active" || agent.status === "inactive")
    .map((agent) => ({ agent, presence: enduePresence(agent, s.endue.conversations) }))
    .map((row, i) => ({ row, i }))
    .sort((a, b) => ORDER.indexOf(a.row.presence) - ORDER.indexOf(b.row.presence) || a.i - b.i)
    .map(({ row }) => row);
}

/** The dot beside a working or waiting agent in the list of the rest. */
const DOT: Partial<Record<EnduePresence, string>> = {
  working: "dot-active",
  waiting: "dot-attention",
};

/** An agent's face as the core handed it over: an image only, never an address (ADR 0232). */
const faceImage = (picture: string) =>
  h("img", { class: "avatar-face", src: picture, alt: "", draggable: "false" });

/** An agent's face: its picture as the core handed it over, else the initial of its name. */
export function faceOf(s: DeskState, agent: StudioAgent): HTMLElement {
  const picture = facePicture(s.endue.pictures[agent.id]);
  if (!picture) return h("span", { "aria-hidden": "true" }, initialOf(agent.name || agent.slug));
  return faceImage(picture);
}

function agentEntry(
  ctx: ShellCtx,
  s: DeskState,
  agent: StudioAgent,
  presence: EnduePresence,
): BarEntry {
  const word = presenceText(s.lang, presence);
  const label = endueText(s.lang, "barAgent", { name: agent.name, presence: word });
  const open = s.focused === `${ENDUE_AGENT_VIEW}${agent.id}` || s.endue.agent === agent.id;
  const colour = hexColour(agent.personalColor);
  // The conversation that runs: its title, and the time since its last message.
  const running = () =>
    presence === "working"
      ? ctx.store
          .get()
          .endue.conversations.find((c) => c.agentId === agent.id && c.activity === "active")
      : undefined;
  const runs = running();
  const picture = facePicture(s.endue.pictures[agent.id]);
  return {
    face: "avatar",
    glyph: initialOf(agent.name || agent.slug),
    ...(picture ? { art: () => faceImage(picture) } : {}),
    attrs: {
      "data-key": `endue-agent-${agent.id}`,
      "data-endue-agent": agent.id,
      "data-presence": presence,
      "aria-label": label,
      "aria-pressed": String(open),
      ...(colour ? { style: { "--endue-accent": colour } } : {}),
    },
    selected: open,
    paused: presence === "paused",
    name: agent.name,
    note: (runs && oneLine(runs.title)) ?? word,
    since: runs?.lastMessageAt,
    tip: () => {
      const now = running();
      return now ? [label, workLine(now.title, now.lastMessageAt ?? "", ctx.wall())] : [label];
    },
    onClick: () => openEndueAgent(ctx, agent.id),
  };
}

function spaceEntry(ctx: ShellCtx, s: DeskState, sp: StudioSpace): BarEntry {
  const open = s.focused === `${ENDUE_SPACE_VIEW}${sp.id}` || s.endue.space === sp.id;
  const label = endueText(s.lang, "barSpace", { name: sp.name });
  const colour = hexColour(sp.avatarColor);
  return {
    face: "space",
    glyph: sp.avatarGlyph || initialOf(sp.name || sp.key),
    attrs: {
      "data-key": `endue-space-${sp.id}`,
      "data-endue-space": sp.id,
      "aria-label": label,
      "aria-pressed": String(open),
      ...(colour ? { style: { "--endue-accent": colour } } : {}),
    },
    selected: open,
    name: sp.name,
    space: true,
    tip: () => (sp.goal ? [label, sp.goal] : [label]),
    onClick: () => openEndueSpace(ctx, sp.id),
  };
}

/** The bar's endue groups, and the popover's items when the agents overflow. */
/** What the bar draws of one source: its groups, the popover's items, and the popover's name. */
export interface BarGroups {
  bar: Child[];
  more: Child;
  moreLabel: string;
}

export function endueGroups(ctx: ShellCtx, s: DeskState, unfolded: boolean): BarGroups {
  const now = ctx.wall();
  const agents = barAgents(s);
  const shown = agents.length > VISIBLE ? agents.slice(0, VISIBLE - 1) : agents;
  const hidden = agents.slice(shown.length);
  const moreLabel = endueText(s.lang, "moreAgents", { n: hidden.length });
  const rest: BarEntry = {
    face: "avatar avatar-more",
    glyph: `+${hidden.length}`,
    attrs: {
      "data-key": "endue-agents-more",
      "aria-label": moreLabel,
      "aria-expanded": String(s.popover === "agents-more"),
    },
    name: moreLabel,
    // Open, the list says it.
    tip: () => (s.popover === "agents-more" ? [] : [moreLabel]),
    onClick: () => ctx.store.set({ popover: s.popover === "agents-more" ? null : "agents-more" }),
  };
  const status =
    s.endue.state === "offline"
      ? h(
          "span",
          {
            class: "bar-offline",
            role: "img",
            "aria-label": endueText(s.lang, "barOffline"),
            title: endueText(s.lang, "barOffline"),
          },
          icon("link", 16),
        )
      : null;
  const bar: Child[] = [
    h(
      "div",
      {
        class: "bar-group",
        role: "group",
        "aria-label": ctx.tr("agents"),
        "aria-busy": String(s.endue.state === "loading"),
        "data-endue-agents": "",
      },
      barCaption(unfolded, ctx.tr("agents")),
      shown.map(({ agent, presence }) =>
        barControl(agentEntry(ctx, s, agent, presence), unfolded, now),
      ),
      hidden.length
        ? barMore(rest, {
            caption: barWord(s.lang, "moreEndue", hidden.length),
            faces: hidden.map(({ agent }) => ({ colour: hexColour(agent.personalColor) })),
            unfolded,
            now,
          })
        : null,
      status,
      newAgentControl(ctx, s.lang, unfolded),
    ),
    h("div", { class: "bar-divider", role: "separator" }),
    h(
      "div",
      {
        class: "bar-group",
        role: "group",
        "aria-label": ctx.tr("spaces"),
        "data-endue-spaces": "",
      },
      barCaption(unfolded, ctx.tr("spaces")),
      s.endue.spaces.map((sp) => barControl(spaceEntry(ctx, s, sp), unfolded, now)),
      newSpaceControl(ctx, s.lang, unfolded),
    ),
  ];
  const more =
    s.popover === "agents-more" && hidden.length
      ? hidden.map(({ agent, presence }) =>
          h(
            "button",
            {
              class: "menu-item agents-popover-item",
              type: "button",
              "data-endue-agent": agent.id,
              onClick: () => openEndueAgent(ctx, agent.id),
            },
            h("span", { class: "run-avatar", "aria-hidden": "true" }, faceOf(s, agent)),
            agent.name,
            DOT[presence] ? h("span", { class: `dot ${DOT[presence]}` }) : null,
          ),
        )
      : null;
  return { bar, more, moreLabel };
}
