/**
 * The agent bar (system layer, left): the agent programs on this computer first (Claude Code, Codex:
 * every one the core found registers itself, ADR 0110), then the current space's agents from the
 * agent directory, the spaces below, a rule between the groups and no caption. Signed in to endue,
 * the person's endue agents and spaces take the directory's place and open as windows
 * (SideBarEndue.ts, ADR 0129). An agent's state is `data-presence`, which the stylesheet draws as a
 * ring around the avatar: working with a working A2A task or a run going on, waiting while it is
 * inactive or a task waits on it for an answer. The bar's tooltip names each control, and says
 * what a working agent does and for how long (bar-tip.ts). Past six agents, the last place opens
 * the rest in a popover.
 */
import type { A2ATask, Agent, LocalAgent } from "@endue-ai/bridge";
import { localText } from "../surface/local-agent/copy";
import { type Presence, presenceOf, selectAgent, selectSpace, spaceAgents } from "../system/agents";
import {
  badgeOf,
  isRunning,
  LOCAL_VIEW,
  localPresence,
  selectLocalAgent,
} from "../system/local-agents";
import { mountBarTip, withTip, workLine } from "./bar-tip";
import type { ShellCtx } from "./context";
import { type Child, h, render } from "./dom";
import { icon } from "./icons";
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

  const avatar = (a: Agent) => {
    const s = ctx.store.get();
    const presence = barPresence(a, s.tasks);
    const label = ctx.tr(
      presence === "working" ? "working" : presence === "waiting" ? "waiting" : "idleAgent",
      {
        name: a.name,
      },
    );
    const button = h(
      "button",
      {
        class: `icon-button avatar${a.id === s.agentId ? " is-selected" : ""}`,
        type: "button",
        "data-key": `agent-${a.id}`,
        "data-agent": a.id,
        "data-presence": presence,
        "aria-label": label,
        "aria-pressed": String(a.id === s.agentId),
        onClick: () => {
          ctx.store.set({ popover: null });
          selectAgent(ctx, a.id);
        },
      },
      h("span", { "aria-hidden": "true" }, initial(a.name)),
    );
    return withTip(button, () => {
      const task = ctx.store
        .get()
        .tasks.find((t) => t.targetAgentId === a.id && t.status === "working");
      return task ? [label, workLine(task.goal, task.insertedAt, ctx.wall())] : [label];
    });
  };

  const local = (a: LocalAgent) => {
    const s = ctx.store.get();
    const working = localPresence(a.id, s.localRuns) === "working";
    const label = localText(s.lang, working ? "working" : "idle", { name: a.name });
    const open = s.focused === `${LOCAL_VIEW}${a.id}`;
    const button = h(
      "button",
      {
        class: `icon-button avatar local-avatar${open ? " is-selected" : ""}`,
        type: "button",
        "data-key": `local-${a.id}`,
        "data-local-agent": a.id,
        "data-presence": working ? "working" : "idle",
        "aria-label": label,
        "aria-pressed": String(open),
        onClick: () => selectLocalAgent(ctx, a.id),
      },
      h("span", { "aria-hidden": "true" }, badgeOf(a.id)),
    );
    return withTip(button, () => {
      const run = ctx.store.get().localRuns.find((r) => r.agent === a.id && isRunning(r));
      return run ? [label, workLine(run.prompt, run.startedAt, ctx.wall())] : [label];
    });
  };

  /** The agent directory's agents and spaces (specs/brain/v0): what the bar shows signed out. */
  const directoryGroups = (s: DeskState): BarGroups => {
    const agents = spaceAgents(s);
    const shown = agents.length > VISIBLE ? agents.slice(0, VISIBLE - 1) : agents;
    const hidden = agents.slice(shown.length);
    const moreLabel = ctx.tr("moreAgents", { n: hidden.length });
    const bar: Child[] = [
      h(
        "div",
        {
          class: "bar-group",
          role: "group",
          "aria-label": ctx.tr("agents"),
          "aria-busy": String(s.directory === "loading"),
        },
        shown.map(avatar),
        hidden.length
          ? withTip(
              h(
                "button",
                {
                  class: "icon-button avatar avatar-more",
                  type: "button",
                  "data-key": "agents-more",
                  "aria-label": moreLabel,
                  "aria-expanded": String(s.popover === "agents-more"),
                  onClick: () =>
                    ctx.store.set({ popover: s.popover === "agents-more" ? null : "agents-more" }),
                },
                `+${hidden.length}`,
              ),
              // Open, the list says it.
              () => (s.popover === "agents-more" ? [] : [moreLabel]),
            )
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
      ),
      h("div", { class: "bar-divider", role: "separator" }),
      h(
        "div",
        { class: "bar-group", role: "group", "aria-label": ctx.tr("spaces") },
        s.spaces.map((sp) =>
          withTip(
            h(
              "button",
              {
                class: `icon-button space${sp.id === s.spaceId ? " is-selected" : ""}`,
                type: "button",
                "data-key": `space-${sp.id}`,
                "data-space": sp.id,
                "aria-label": sp.name,
                "aria-pressed": String(sp.id === s.spaceId),
                onClick: () => void selectSpace(ctx, sp.id),
              },
              h("span", { "aria-hidden": "true" }, initial(sp.name)),
            ),
            () => (sp.description ? [sp.name, sp.description] : [sp.name]),
          ),
        ),
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
    // Signed in, the person's endue agents and spaces take the directory's place (ADR 0129).
    const groups = s.endue.state === "off" ? directoryGroups(s) : endueGroups(ctx, s);
    render(el, () => [
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
              s.localAgents.map(local),
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
                style: { top: `${el.offsetTop - el.offsetHeight / 2}px` },
              },
              groups.more,
            ),
          ]
        : [],
    );
    tip.refresh();
  };
  draw();
  const off = ctx.store.watch(
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
      s.endue.spaces,
      s.endue.conversations.map((c) => [c.agentId, c.activity, c.activity === "active" && c.title]),
      s.endue.agent,
      s.endue.space,
    ],
    draw,
  );
  return () => {
    off();
    tip.dispose();
    el.remove();
    more.remove();
  };
}
