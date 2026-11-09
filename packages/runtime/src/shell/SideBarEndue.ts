/**
 * The agent bar's endue half while the desk is signed in (ADR 0129): the person's endue agents,
 * the ones that work or wait for them first, and the spaces they can open. Choosing either opens
 * its window. Past six agents the last place opens the rest in a popover, as the directory's does.
 */
import type { StudioAgent } from "@endue-ai/bridge";
import { endueText } from "../surface/endue/copy";
import { initialOf, presenceText } from "../surface/endue/model";
import {
  ENDUE_AGENT_VIEW,
  ENDUE_SPACE_VIEW,
  type EnduePresence,
  enduePresence,
  hexColour,
  openEndueAgent,
  openEndueSpace,
} from "../system/endue";
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

const DOT: Partial<Record<EnduePresence, string>> = {
  working: "dot-active",
  waiting: "dot-attention",
};

function avatarButton(ctx: ShellCtx, s: DeskState, agent: StudioAgent, presence: EnduePresence) {
  const label = endueText(s.lang, "barAgent", {
    name: agent.name,
    presence: presenceText(s.lang, presence),
  });
  const open = s.focused === `${ENDUE_AGENT_VIEW}${agent.id}` || s.endue.agent === agent.id;
  const colour = hexColour(agent.personalColor);
  return h(
    "button",
    {
      class: `icon-button avatar${open ? " is-selected" : ""}${presence === "paused" ? " is-paused" : ""}`,
      type: "button",
      "data-key": `endue-agent-${agent.id}`,
      "data-endue-agent": agent.id,
      "data-presence": presence,
      "aria-label": label,
      "aria-pressed": String(open),
      title: label,
      ...(colour ? { style: { "--endue-accent": colour } } : {}),
      onClick: () => openEndueAgent(ctx, agent.id),
    },
    h("span", { "aria-hidden": "true" }, initialOf(agent.name || agent.slug)),
    DOT[presence] ? h("span", { class: `dot ${DOT[presence]} avatar-dot` }) : null,
  );
}

/** The bar's endue groups, and the popover's items when the agents overflow. */
/** What the bar draws of one source: its groups, the popover's items, and the popover's name. */
export interface BarGroups {
  bar: Child[];
  more: Child;
  moreLabel: string;
}

export function endueGroups(ctx: ShellCtx, s: DeskState): BarGroups {
  const agents = barAgents(s);
  const shown = agents.length > VISIBLE ? agents.slice(0, VISIBLE - 1) : agents;
  const hidden = agents.slice(shown.length);
  const moreLabel = endueText(s.lang, "moreAgents", { n: hidden.length });
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
    h("div", { class: "rail-label", "aria-hidden": "true" }, ctx.tr("agents")),
    h(
      "div",
      {
        class: "bar-group",
        role: "group",
        "aria-label": ctx.tr("agents"),
        "aria-busy": String(s.endue.state === "loading"),
        "data-endue-agents": "",
      },
      shown.map(({ agent, presence }) => avatarButton(ctx, s, agent, presence)),
      hidden.length
        ? h(
            "button",
            {
              class: "icon-button avatar avatar-more",
              type: "button",
              "data-key": "endue-agents-more",
              "aria-label": moreLabel,
              "aria-expanded": String(s.popover === "agents-more"),
              title: moreLabel,
              onClick: () =>
                ctx.store.set({ popover: s.popover === "agents-more" ? null : "agents-more" }),
            },
            `+${hidden.length}`,
          )
        : null,
      status,
    ),
    h("div", { class: "bar-divider", role: "separator" }),
    h("div", { class: "rail-label", "aria-hidden": "true" }, ctx.tr("spaces")),
    h(
      "div",
      {
        class: "bar-group",
        role: "group",
        "aria-label": ctx.tr("spaces"),
        "data-endue-spaces": "",
      },
      s.endue.spaces.map((sp) => {
        const open = s.focused === `${ENDUE_SPACE_VIEW}${sp.id}` || s.endue.space === sp.id;
        const label = endueText(s.lang, "barSpace", { name: sp.name });
        const colour = hexColour(sp.avatarColor);
        return h(
          "button",
          {
            class: `icon-button space${open ? " is-selected" : ""}`,
            type: "button",
            "data-key": `endue-space-${sp.id}`,
            "data-endue-space": sp.id,
            "aria-label": label,
            "aria-pressed": String(open),
            title: sp.goal ? `${sp.name} · ${sp.goal}` : sp.name,
            ...(colour ? { style: { "--endue-accent": colour } } : {}),
            onClick: () => openEndueSpace(ctx, sp.id),
          },
          h("span", { "aria-hidden": "true" }, sp.avatarGlyph || initialOf(sp.name || sp.key)),
        );
      }),
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
            h(
              "span",
              { class: "run-avatar", "aria-hidden": "true" },
              initialOf(agent.name || agent.slug),
            ),
            agent.name,
            DOT[presence] ? h("span", { class: `dot ${DOT[presence]}` }) : null,
          ),
        )
      : null;
  return { bar, more, moreLabel };
}
