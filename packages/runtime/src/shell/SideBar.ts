/** Left floating bar: the space's agents above, the spaces below. */
import { selectAgent, selectSpace } from "./actions";
import type { ShellCtx } from "./context";
import { h, render } from "./dom";
import { icon } from "./icons";
import { initial } from "./state";

export function mountSideBar(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = h("aside", {
    class: "sidebar float-bar",
    "aria-label": `${ctx.tr("agents")} · ${ctx.tr("spaces")}`,
  });
  root.append(el);
  const draw = () => {
    const s = ctx.store.get();
    const space = s.spaces.find((sp) => sp.id === s.spaceId) ?? s.spaces[0];
    render(el, () => [
      h("div", { class: "rail-label", "aria-hidden": "true" }, ctx.tr("agents")),
      h(
        "div",
        { class: "bar-group", role: "group", "aria-label": ctx.tr("agents") },
        (space?.agents ?? []).map((a) => {
          const label = ctx.tr(a.working ? "working" : a.waiting ? "waiting" : "idleAgent", {
            name: a.name,
          });
          return h(
            "button",
            {
              class: `avatar${a.id === s.agentId ? " is-selected" : ""}${a.waiting ? " is-waiting" : ""}`,
              type: "button",
              "data-key": `agent-${a.id}`,
              "data-agent": a.id,
              "aria-label": label,
              "aria-pressed": String(a.id === s.agentId),
              title: label,
              onClick: () => selectAgent(ctx, a.id),
            },
            h("span", { "aria-hidden": "true" }, initial(a.name)),
            a.working ? h("span", { class: "dot dot-active avatar-dot" }) : null,
          );
        }),
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
              title: sp.name,
              onClick: () => selectSpace(ctx, sp.id),
            },
            h("span", { "aria-hidden": "true" }, initial(sp.name)),
          ),
        ),
        h(
          "button",
          {
            class: "add-button space-add",
            type: "button",
            "data-key": "space-add",
            "aria-label": ctx.tr("addSpace"),
            title: ctx.tr("addSpace"),
          },
          icon("plus", 16),
        ),
      ),
    ]);
  };
  draw();
  const off = ctx.store.watch((s) => [s.spaceId, s.agentId, s.spaces, s.lang], draw);
  return () => {
    off();
    el.remove();
  };
}
