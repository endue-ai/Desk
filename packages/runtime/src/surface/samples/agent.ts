/**
 * An agent's screen: who it is, its A2A card (what it offers other agents) and the A2A tasks it is
 * doing. Reads the card once and redraws when the card or the tasks change.
 */
import type { A2ATask } from "@endue-ai/bridge";
import type { ShellCtx } from "../../shell/context";
import type { CopyKey } from "../../shell/copy";
import { h, render } from "../../shell/dom";
import { initial } from "../../shell/state";
import { loadCard, presenceOf } from "../../system/agents";
import type { Mounted } from "../views";

const STATUS: Record<A2ATask["status"], CopyKey> = {
  submitted: "statusSubmitted",
  working: "statusWorking",
  input_required: "statusInputRequired",
  completed: "statusCompleted",
  failed: "statusFailed",
  canceled: "statusCanceled",
};

export function agentBody(ctx: ShellCtx, id: string): Mounted {
  const el = h("div", { class: "agent-view", "data-agent-view": id });
  const draw = () => {
    const s = ctx.store.get();
    const agent = s.agents.find((a) => a.id === id);
    const card = s.cards[id];
    const tasks = s.tasks.filter((t) => t.targetAgentId === id);
    const presence = agent ? presenceOf(agent, s.tasks) : "idle";
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
      card === undefined
        ? h("p", { class: "agent-desc pop-muted" }, ctx.tr("agentLoading"))
        : card === "missing"
          ? h("p", { class: "agent-desc pop-muted" }, ctx.tr("agentNoCard"))
          : h(
              "div",
              { class: "agent-card" },
              card.description ? h("p", { class: "agent-desc" }, card.description) : null,
              h("div", { class: "section-title" }, ctx.tr("agentSkills")),
              h(
                "ul",
                { class: "skill-list" },
                card.skills.map((skill) =>
                  h(
                    "li",
                    { class: "skill" },
                    h("span", {}, skill.name),
                    h("span", { class: "tag" }, skill.inputModes.join(" · ")),
                  ),
                ),
              ),
              h(
                "div",
                { class: "agent-caps" },
                h(
                  "span",
                  { class: "tag" },
                  ctx.tr("agentCapacity", { n: card.capabilities.maxConcurrentTasks }),
                ),
                card.capabilities.streaming
                  ? h("span", { class: "tag" }, ctx.tr("agentStreaming"))
                  : null,
                card.enabled ? null : h("span", { class: "tag" }, ctx.tr("a2aOff")),
              ),
            ),
      h("div", { class: "section-title" }, ctx.tr("agentTasks")),
      tasks.length
        ? h(
            "ul",
            { class: "task-list" },
            tasks.map((t) =>
              h(
                "li",
                { class: "pop-row" },
                h("span", { class: `dot ${t.status === "working" ? "dot-active" : "dot-idle"}` }),
                h("span", { class: "pop-text" }, t.goal ?? t.id),
                h(
                  "span",
                  { class: "pop-muted" },
                  ctx.tr(STATUS[t.status]),
                  t.progress === undefined ? "" : ` · ${Math.round(t.progress * 100)}%`,
                ),
              ),
            ),
          )
        : h("p", { class: "pop-muted agent-empty" }, ctx.tr("agentNoTasks")),
    ]);
  };
  draw();
  void loadCard(ctx, id);
  const off = ctx.store.watch((s) => [s.cards[id], s.tasks, s.agents, s.lang], draw);
  return { el, off };
}
