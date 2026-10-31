/**
 * The agent bar (system layer, left): the current space's agents from the agent directory above, the
 * spaces below. An agent with a working A2A task carries the working dot; an inactive one waits at
 * the edge, dashed and dimmed. Past six agents, the last place opens the rest in a popover.
 */
import type { Agent } from "@endue-ai/bridge";
import { presenceOf, selectAgent, selectSpace, spaceAgents } from "../system/agents";
import type { ShellCtx } from "./context";
import { h, render } from "./dom";
import { icon } from "./icons";
import { initial } from "./state";

const VISIBLE = 6;

export function mountSideBar(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = h("aside", {
    class: "sidebar float-bar",
    "aria-label": `${ctx.tr("agents")} · ${ctx.tr("spaces")}`,
  });
  const more = h("div", { class: "agents-more-slot" });
  root.append(el, more);

  const avatar = (a: Agent) => {
    const s = ctx.store.get();
    const presence = presenceOf(a, s.tasks);
    const label = ctx.tr(
      presence === "working" ? "working" : presence === "waiting" ? "waiting" : "idleAgent",
      {
        name: a.name,
      },
    );
    return h(
      "button",
      {
        class: `avatar${a.id === s.agentId ? " is-selected" : ""}${presence === "waiting" ? " is-waiting" : ""}`,
        type: "button",
        "data-key": `agent-${a.id}`,
        "data-agent": a.id,
        "data-presence": presence,
        "aria-label": label,
        "aria-pressed": String(a.id === s.agentId),
        title: label,
        onClick: () => {
          ctx.store.set({ popover: null });
          selectAgent(ctx, a.id);
        },
      },
      h("span", { "aria-hidden": "true" }, initial(a.name)),
      presence === "working" ? h("span", { class: "dot dot-active avatar-dot" }) : null,
    );
  };

  const draw = () => {
    const s = ctx.store.get();
    const agents = spaceAgents(s);
    const shown = agents.length > VISIBLE ? agents.slice(0, VISIBLE - 1) : agents;
    const hidden = agents.slice(shown.length);
    const moreLabel = ctx.tr("moreAgents", { n: hidden.length });
    render(el, () => [
      h("div", { class: "rail-label", "aria-hidden": "true" }, ctx.tr("agents")),
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
          ? h(
              "button",
              {
                class: "avatar avatar-more",
                type: "button",
                "data-key": "agents-more",
                "aria-label": moreLabel,
                "aria-expanded": String(s.popover === "agents-more"),
                title: moreLabel,
                onClick: () =>
                  ctx.store.set({ popover: s.popover === "agents-more" ? null : "agents-more" }),
              },
              `+${hidden.length}`,
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
      h("div", { class: "rail-label", "aria-hidden": "true" }, ctx.tr("spaces")),
      h(
        "div",
        { class: "bar-group", role: "group", "aria-label": ctx.tr("spaces") },
        s.spaces.map((sp) =>
          h(
            "button",
            {
              class: `space${sp.id === s.spaceId ? " is-selected" : ""}`,
              type: "button",
              "data-key": `space-${sp.id}`,
              "data-space": sp.id,
              "aria-label": sp.name,
              "aria-pressed": String(sp.id === s.spaceId),
              title: sp.description ? `${sp.name} · ${sp.description}` : sp.name,
              onClick: () => void selectSpace(ctx, sp.id),
            },
            h("span", { "aria-hidden": "true" }, initial(sp.name)),
          ),
        ),
      ),
    ]);
    render(more, () =>
      s.popover === "agents-more" && hidden.length
        ? [
            h(
              "div",
              {
                class: "popover agents-popover",
                role: "dialog",
                "aria-label": moreLabel,
                style: { top: `${el.offsetTop - el.offsetHeight / 2}px` },
              },
              hidden.map((a) =>
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
                  presenceOf(a, s.tasks) === "working"
                    ? h("span", { class: "dot dot-active" })
                    : null,
                ),
              ),
            ),
          ]
        : [],
    );
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
    ],
    draw,
  );
  return () => {
    off();
    el.remove();
    more.remove();
  };
}
