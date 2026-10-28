/**
 * Bottom right: what is happening now. One chip per running task: the agent doing it, the title,
 * the time since it started and its progress. Nothing at all when nothing runs.
 */
import { agentName, selectAgent } from "../system/agents";
import type { ShellCtx } from "./context";
import { h, render } from "./dom";
import { initial } from "./state";

export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function mountRunning(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = h("ul", { class: "running", "aria-label": ctx.tr("running") });
  root.append(el);
  const draw = () => {
    const s = ctx.store.get();
    const tasks = s.tasks.filter((t) => t.running);
    el.hidden = tasks.length === 0;
    render(el, () =>
      tasks.map((t) => {
        const who = agentName(s, t.agent);
        const title = t.title;
        return h(
          "li",
          {},
          h(
            "button",
            {
              class: "run-chip",
              type: "button",
              "data-key": `run-${t.id}`,
              "data-task": t.id,
              "aria-label": `${who} · ${title}`,
              onClick: () => selectAgent(ctx, t.agent),
            },
            h("span", { class: "run-avatar", "aria-hidden": "true" }, initial(who)),
            h("span", { class: "run-title" }, title),
            h(
              "span",
              { class: "run-time", "data-started": t.startedAt },
              elapsed(ctx.ticker.now() - t.startedAt),
            ),
            t.progress === undefined
              ? null
              : h(
                  "span",
                  { class: "run-progress", "aria-hidden": "true" },
                  h("span", {
                    class: "run-bar",
                    style: { width: `${Math.round(t.progress * 100)}%` },
                  }),
                ),
          ),
        );
      }),
    );
  };
  draw();
  let second = -1;
  const offs = [
    ctx.store.watch((s) => [s.tasks, s.agents], draw),
    ctx.ticker.add(() => {
      const now = ctx.ticker.now();
      const sec = Math.floor(now / 1000);
      if (sec === second) return;
      second = sec;
      for (const span of el.querySelectorAll<HTMLElement>(".run-time")) {
        span.textContent = elapsed(now - Number(span.dataset.started));
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
    el.remove();
  };
}
