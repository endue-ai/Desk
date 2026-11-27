/**
 * The agent bar (system layer, left): the agent programs on this computer first (Claude Code, Codex:
 * every one the core found registers itself, ADR 0110), each under its program's mark (ADR 0232),
 * then the current space's agents from the agent directory, the spaces below and a rule between the
 * groups. Signed in to endue, the person's endue agents and spaces take the directory's place and
 * open as windows (SideBarEndue.ts, ADR 0129). An agent's state is `data-presence`, which the
 * stylesheet draws as a ring around the avatar: working with a working A2A task or a run going on,
 * waiting while it is inactive or a task waits on it for an answer. The bar's tooltip names each
 * control, and says what a working agent does and for how long (bar-tip.ts). Past six agents, the
 * last place opens the rest in a popover. The bar unfolds into a list that says all of it at once,
 * each avatar a row under its group's caption (bar-unfold.ts, bar-list.ts). New agent ends the
 * agents and New space the spaces (bar-new.ts): folded, they and the place of the rest are the only
 * ones with their name under them; unfolded, they are rows of the list.
 */
import type { A2ATask, Agent, LocalAgent, Space } from "@endue-ai/bridge";
import { localText } from "../surface/local-agent/copy";
import { type Presence, presenceOf, selectAgent, selectSpace, spaceAgents } from "../system/agents";
import { hexColour } from "../system/endue-ids";
import {
  badgeOf,
  isRunning,
  LOCAL_VIEW,
  localPresence,
  selectLocalAgent,
} from "../system/local-agents";
import { type BarEntry, barCaption, barControl, oneLine, tickTimes } from "./bar-list";
import { barMore, barWord, newAgentControl, newSpaceControl } from "./bar-new";
import { mountBarTip, workLine } from "./bar-tip";
import { mountBarUnfold } from "./bar-unfold";
import type { ShellCtx } from "./context";
import { type Child, h, render } from "./dom";
import { icon } from "./icons";
import { localMark } from "./marks";
import { type BarGroups, endueGroups } from "./SideBarEndue";
import { type DeskState, initial } from "./state";

const VISIBLE = 6;

/**
 * An agent's state on the bar: working or inactive as the directory says (`presenceOf`), and
 * waiting too while a task handed to it has stopped for an answer (A2A `input_required`).
 */
function barPresence(agent: Agent, tasks: readonly A2ATask[]): Presence {
  const presence = presenceOf(agent, tasks);
  if (presence !== "idle") return presence;
  const asked = tasks.some((t) => t.targetAgentId === agent.id && t.status === "input_required");
  return asked ? "waiting" : "idle";
}

export function mountSideBar(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = h("aside", {
    class: "sidebar float-bar",
    "aria-label": `${ctx.tr("agents")} · ${ctx.tr("spaces")}`,
  });
  const more = h("div", { class: "agents-more-slot" });
  root.append(el, more);
  const tip = mountBarTip(root, el, { id: "agents-tooltip", edge: "left", controls: "button" });
  const unfold = mountBarUnfold(el, ctx, () => draw());

  const agent = (a: Agent, s: DeskState): BarEntry => {
    const presence = barPresence(a, s.tasks);
    const label = ctx.tr(
      presence === "working" ? "working" : presence === "waiting" ? "waiting" : "idleAgent",
      { name: a.name },
    );
    const working = () =>
      ctx.store.get().tasks.find((t) => t.targetAgentId === a.id && t.status === "working");
    const task = working();
    return {
      face: "avatar",
      glyph: initial(a.name),
      attrs: {
        "data-key": `agent-${a.id}`,
        "data-agent": a.id,
        "data-presence": presence,
        "aria-label": label,
        "aria-pressed": String(a.id === s.agentId),
      },
      selected: a.id === s.agentId,
      name: a.name,
      note: task
        ? (oneLine(task.goal) ?? ctx.tr("agentWorking"))
        : ctx.tr(presence === "waiting" ? "agentWaiting" : "agentIdle"),
      since: task?.insertedAt,
      tip: () => {
        const now = working();
        return now ? [label, workLine(now.goal, now.insertedAt, ctx.wall())] : [label];
      },
      onClick: () => {
        ctx.store.set({ popover: null });
        selectAgent(ctx, a.id);
      },
    };
  };

  const local = (a: LocalAgent, s: DeskState): BarEntry => {
    const working = localPresence(a.id, s.localRuns) === "working";
    const label = localText(s.lang, working ? "working" : "idle", { name: a.name });
    const open = s.focused === `${LOCAL_VIEW}${a.id}`;
    const going = () => ctx.store.get().localRuns.find((r) => r.agent === a.id && isRunning(r));
    const run = going();
    return {
      face: "avatar local-avatar",
      glyph: badgeOf(a.id),
      // The program's own mark in its avatar (ADR 0232); the badge's letters name it to no one.
      art: () => localMark(a.id),
      attrs: {
        "data-key": `local-${a.id}`,
        "data-local-agent": a.id,
        "data-presence": working ? "working" : "idle",
        "aria-label": label,
        "aria-pressed": String(open),
      },
      selected: open,
      name: a.name,
      note: run ? (oneLine(run.prompt) ?? ctx.tr("agentWorking")) : ctx.tr("agentIdle"),
      since: run?.startedAt,
      tip: () => {
        const now = going();
        return now ? [label, workLine(now.prompt, now.startedAt, ctx.wall())] : [label];
      },
      onClick: () => selectLocalAgent(ctx, a.id),
    };
  };

  const space = (sp: Space, s: DeskState): BarEntry => ({
    face: "space",
    glyph: initial(sp.name),
    attrs: {
      "data-key": `space-${sp.id}`,
      "data-space": sp.id,
      "aria-label": sp.name,
      "aria-pressed": String(sp.id === s.spaceId),
    },
    selected: sp.id === s.spaceId,
    name: sp.name,
    space: true,
    tip: () => (sp.description ? [sp.name, sp.description] : [sp.name]),
    onClick: () => void selectSpace(ctx, sp.id),
  });

  /** The agent directory's agents and spaces (specs/brain/v0): what the bar shows signed out. */
  const directoryGroups = (s: DeskState, unfolded: boolean): BarGroups => {
    const now = ctx.wall();
    const agents = spaceAgents(s);
    const shown = agents.length > VISIBLE ? agents.slice(0, VISIBLE - 1) : agents;
    const hidden = agents.slice(shown.length);
    const moreLabel = ctx.tr("moreAgents", { n: hidden.length });
    const rest: BarEntry = {
      face: "avatar avatar-more",
      glyph: `+${hidden.length}`,
      attrs: {
        "data-key": "agents-more",
        "aria-label": moreLabel,
        "aria-expanded": String(s.popover === "agents-more"),
      },
      name: moreLabel,
      // Open, the list says it.
      tip: () => (s.popover === "agents-more" ? [] : [moreLabel]),
      onClick: () => ctx.store.set({ popover: s.popover === "agents-more" ? null : "agents-more" }),
    };
    const bar: Child[] = [
      h(
        "div",
        {
          class: "bar-group",
          role: "group",
          "aria-label": ctx.tr("agents"),
          "aria-busy": String(s.directory === "loading"),
        },
        barCaption(unfolded, ctx.tr("agents")),
        shown.map((a) => barControl(agent(a, s), unfolded, now)),
        hidden.length
          ? barMore(rest, {
              caption: barWord(s.lang, "more", hidden.length),
              // Each agent's own colour; one with none takes the chart's, in turn (bar-new.css).
              faces: hidden.map((a) => ({ colour: hexColour(a.personalColor) })),
              unfolded,
              now,
            })
          : null,
        s.directory === "offline"
          ? h(
              "span",
              {
                class: "bar-offline",
                role: "img",
                "aria-label": ctx.tr("agentsOffline"),
                title: ctx.tr("agentsOffline"),
              },
              icon("link", 16),
            )
          : null,
        newAgentControl(ctx, s.lang, unfolded),
      ),
      h("div", { class: "bar-divider", role: "separator" }),
      h(
        "div",
        { class: "bar-group", role: "group", "aria-label": ctx.tr("spaces") },
        barCaption(unfolded, ctx.tr("spaces")),
        s.spaces.map((sp) => barControl(space(sp, s), unfolded, now)),
        newSpaceControl(ctx, s.lang, unfolded),
      ),
    ];
    const more =
      s.popover === "agents-more" && hidden.length
        ? hidden.map((a) =>
            h(
              "button",
              {
                class: "menu-item agents-popover-item",
                type: "button",
                "data-agent": a.id,
                onClick: () => {
                  ctx.store.set({ popover: null });
                  selectAgent(ctx, a.id);
                },
              },
              h("span", { class: "run-avatar", "aria-hidden": "true" }, initial(a.name)),
              a.name,
              presenceOf(a, s.tasks) === "working" ? h("span", { class: "dot dot-active" }) : null,
            ),
          )
        : null;
    return { bar, more, moreLabel };
  };

  const draw = () => {
    const s = ctx.store.get();
    const unfolded = unfold.unfolded();
    const now = ctx.wall();
    // Signed in, the person's endue agents and spaces take the directory's place (ADR 0129).
    const groups =
      s.endue.state === "off" ? directoryGroups(s, unfolded) : endueGroups(ctx, s, unfolded);
    render(el, () => [
      unfold.controls(),
      s.localAgents.length
        ? [
            h(
              "div",
              {
                class: "bar-group",
                role: "group",
                "aria-label": localText(s.lang, "groupLabel"),
                "data-local-agents": "",
              },
              barCaption(unfolded, ctx.tr("thisComputer")),
              s.localAgents.map((a) => barControl(local(a, s), unfolded, now)),
            ),
            h("div", { class: "bar-divider", role: "separator" }),
          ]
        : null,
      ...groups.bar,
    ]);
    render(more, () =>
      groups.more
        ? [
            h(
              "div",
              {
                class: "popover agents-popover",
                role: "dialog",
                "aria-label": groups.moreLabel,
                // Level with the bar's top as drawn: a transform centres it, or holds it under
                // the shortcut bar (system.css), which offsetTop leaves out.
                style: {
                  top: `${Math.round(el.getBoundingClientRect().top - root.getBoundingClientRect().top)}px`,
                },
              },
              groups.more,
            ),
          ]
        : [],
    );
    tip.refresh();
    unfold.settle();
    // A row that counts a time has its frames; otherwise the ticker sleeps again.
    ctx.ticker.wake();
  };
  draw();
  const offs = [
    tickTimes(el, ctx),
    ctx.store.watch(
      (s) => [
        s.spaceId,
        s.spaces,
        s.agents,
        s.spaceAgents,
        s.agentId,
        s.tasks,
        s.directory,
        s.popover === "agents-more",
        s.lang,
        s.localAgents,
        s.localRuns.filter(isRunning).map((r) => [r.agent, r.prompt]),
        s.focused?.startsWith(LOCAL_VIEW) || s.focused?.startsWith("endue-") ? s.focused : null,
        s.endue.state,
        s.endue.agents,
        s.endue.pictures,
        s.endue.spaces,
        s.endue.conversations.map((c) => [
          c.agentId,
          c.activity,
          c.activity === "active" && c.title,
        ]),
        s.endue.agent,
        s.endue.space,
      ],
      draw,
    ),
  ];
  return () => {
    for (const off of offs) off();
    unfold.dispose();
    tip.dispose();
    el.remove();
    more.remove();
  };
}
