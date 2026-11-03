/** Presentation around the existing composer; sending, IME and command matching stay in Composer. */
import { DENSITIES, generateMesh, position, VIEW_IDLE } from "../eris/mesh";
import { selectAgent, spaceAgents } from "../system/agents";
import type { ShellCtx } from "./context";
import { h, listen, render } from "./dom";
import { icon } from "./icons";

function orb(): SVGSVGElement {
  const mesh = generateMesh({ ...DENSITIES.airy, view: VIEW_IDLE, goldToward: [1, 0] });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "talk-orb");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute(
    "d",
    mesh.faces
      .filter((f) => f.n[2] > 0)
      .map((f) => {
        const points = f.v.map((v) => {
          const vertex = mesh.vertices[v];
          const p = vertex ? position(mesh, vertex) : [0, 0];
          return `${(12 + (p[0] ?? 0) * 10).toFixed(2)},${(12 - (p[1] ?? 0) * 10).toFixed(2)}`;
        });
        return `M${points.join("L")}Z`;
      })
      .join(""),
  );
  svg.append(path);
  return svg;
}

export function mountTalkChrome(root: HTMLElement, ctx: ShellCtx): () => void {
  const el = root.querySelector<HTMLElement>(".composer");
  const input = el?.querySelector<HTMLInputElement>(".composer-input");
  if (!el || !input) return () => {};
  el.classList.add("talk-pill");
  let hovered = false;
  let picking = false;
  const label = () => ctx.tr("composerLabel");
  const show = () => {
    ctx.store.set((s) => ({ composer: { ...s.composer, open: true } }));
    input.focus();
  };
  const launchText = h("span", {});
  const launch = h(
    "button",
    {
      class: "talk-launch",
      type: "button",
      "aria-controls": "composer-input",
      onClick: show,
    },
    orb(),
    launchText,
  );
  const preview = h("span", { class: "talk-preview" });
  const shortcut = h(
    "kbd",
    { class: "talk-shortcut", "aria-hidden": "true" },
    ctx.platform === "mac" ? "⌥Space" : "Alt+Space",
  );
  const grip = h("span", { class: "talk-grip", "aria-hidden": "true" }, "⠿");
  const agents = h("div", {
    class: "popover talk-agent-list",
    id: "talk-agent-list",
    role: "group",
    hidden: true,
  });
  const agentButton = h(
    "button",
    {
      class: "talk-agent-button icon-button",
      type: "button",
      "aria-controls": "talk-agent-list",
      onClick: () => {
        picking = !picking;
        draw();
        if (picking) agents.querySelector("button")?.focus();
      },
    },
    icon("plus", 16),
  );
  el.append(launch, grip, agentButton, preview, shortcut, agents);
  const draw = () => {
    const s = ctx.store.get();
    const open = s.composer.open;
    el.dataset.state = open ? "edit" : hovered ? "hover" : "idle";
    launchText.textContent = label();
    launch.setAttribute("aria-label", label());
    launch.setAttribute("aria-expanded", String(open));
    launch.hidden = open;
    input.tabIndex = open ? 0 : -1;
    input.setAttribute("aria-label", label());
    input.placeholder = s.lang === "ko" ? "Eris에게 계속 말해 보세요" : "Keep talking with Eris";
    const available = spaceAgents(s);
    const names = available.map((a) => a.name).join(", ");
    preview.textContent =
      names || (s.lang === "ko" ? "오늘 호출할 수 있는 에이전트들…" : "Agents you can call today…");
    preview.title = names;
    agentButton.hidden = !open;
    agentButton.setAttribute("aria-label", ctx.tr("agents"));
    agentButton.setAttribute("aria-expanded", String(picking));
    agents.setAttribute("aria-label", ctx.tr("agents"));
    agents.hidden = !picking || !open;
    render(agents, () =>
      available.length
        ? available.map((agent) =>
            h(
              "button",
              {
                class: "menu-item",
                type: "button",
                "data-key": `talk-${agent.id}`,
                onClick: () => {
                  picking = false;
                  selectAgent(ctx, agent.id);
                  draw();
                  input.focus();
                },
              },
              agent.name,
            ),
          )
        : [h("p", { class: "pop-row" }, ctx.tr("empty"))],
    );
  };
  const offs = [
    // Moving from the empty input into its agent picker is still editing the same composer.
    listen(
      input,
      "blur",
      (e) => {
        if (el.contains((e as FocusEvent).relatedTarget as Node | null))
          e.stopImmediatePropagation();
      },
      { capture: true },
    ),
    ctx.store.watch(
      (s) => [s.composer.open, s.agents, s.spaceAgents, s.lang],
      () => {
        if (!ctx.store.get().composer.open) picking = false;
        draw();
      },
    ),
    listen(el, "pointerenter", () => {
      hovered = true;
      draw();
    }),
    listen(el, "pointerleave", () => {
      hovered = false;
      draw();
    }),
    listen(el, "click", (e) => {
      if ((e.target as Element).closest("button, input, .composer-list, .talk-agent-list")) return;
      show();
    }),
    listen(agents, "keydown", (e) => {
      if ((e as KeyboardEvent).key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      picking = false;
      draw();
      input.focus();
    }),
    listen(document, "pointerdown", (e) => {
      if (picking && !el.contains(e.target as Node)) {
        picking = false;
        draw();
      }
    }),
    listen(window, "keydown", (e) => {
      const key = e as KeyboardEvent;
      if (
        !key.defaultPrevented &&
        !key.isComposing &&
        key.altKey &&
        !key.metaKey &&
        !key.ctrlKey &&
        !key.shiftKey &&
        key.code !== "AltRight" &&
        key.key === " " &&
        !document.querySelector("dialog[open]")
      ) {
        key.preventDefault();
        show();
      }
    }),
  ];
  draw();
  return () => {
    for (const off of offs) off();
    for (const part of [launch, grip, agentButton, preview, shortcut, agents]) part.remove();
    el.classList.remove("talk-pill");
    delete el.dataset.state;
  };
}
