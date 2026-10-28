/**
 * An agent's screen: who it is as endue AI's API gateway describes it (name, handle, description,
 * whether it answers in this space, endue.live, catalog origin) and the tasks it is doing.
 * Redraws when the agents, the space or the tasks change.
 */
import type { ShellCtx } from "../../shell/context";
import { h, render } from "../../shell/dom";
import { initial } from "../../shell/state";
import { presenceOf } from "../../system/agents";
import type { Mounted } from "../views";

export function agentBody(ctx: ShellCtx, id: string): Mounted {
  const el = h("div", { class: "agent-view", "data-agent-view": id });
  const draw = () => {
    const s = ctx.store.get();
    const agent = s.agents.find((a) => a.id === id);
    const space = s.spaces.find((sp) => sp.id === s.spaceId);
    const tasks = s.tasks.filter((t) => t.agent === id);
    const presence = agent ? presenceOf(agent, s.tasks) : "idle";
    const tags = [
      space?.front_agent_id === id ? ctx.tr("agentFront") : null,
      agent?.live_enabled ? ctx.tr("agentLive") : null,
      agent?.source_catalog ? ctx.tr("agentCatalog", { v: agent.source_catalog.version }) : null,
      agent?.region ?? null,
    ].filter((t): t is string => t !== null);
    render(el, () => [
      h(
        "div",
        { class: "agent-head" },
        h(
          "span",
          { class: "avatar agent-avatar", "aria-hidden": "true" },
          initial(agent?.name ?? "?"),
        ),
        h(
          "div",
          { class: "agent-who" },
          h("div", { class: "agent-name" }, agent?.name ?? id),
          h(
            "div",
            { class: "agent-meta" },
            presence === "working" ? h("span", { class: "dot dot-active" }) : null,
            ctx.tr(
              presence === "working"
                ? "statusWorking"
                : presence === "waiting"
                  ? "statusSubmitted"
                  : "idle",
            ),
            agent ? ` · ${agent.slug}` : "",
          ),
        ),
      ),
      agent?.description ? h("p", { class: "agent-desc" }, agent.description) : null,
      tags.length
        ? h(
            "div",
            { class: "agent-caps" },
            tags.map((t) => h("span", { class: "tag" }, t)),
          )
        : null,
      h("div", { class: "section-title" }, ctx.tr("agentTasks")),
      tasks.length
        ? h(
            "ul",
            { class: "task-list" },
            tasks.map((t) =>
              h(
                "li",
                { class: "pop-row" },
                h("span", { class: `dot ${t.running ? "dot-active" : "dot-idle"}` }),
                h("span", { class: "pop-text" }, t.title),
                h(
                  "span",
                  { class: "pop-muted" },
                  t.running
                    ? `${ctx.tr("statusWorking")} · ${Math.round(t.progress * 100)}%`
                    : ctx.tr("statusSubmitted"),
                ),
              ),
            ),
          )
        : h("p", { class: "pop-muted agent-empty" }, ctx.tr("agentNoTasks")),
    ]);
  };
  draw();
  const off = ctx.store.watch((s) => [s.agents, s.spaces, s.spaceId, s.tasks, s.lang], draw);
  return { el, off };
}
