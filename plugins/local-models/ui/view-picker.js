// The model picker (Mod+L): every chat model of every server, grouped by server, filtered as the
// person types, with what each is (size, quantization, context) and what it can do. Arrow keys and
// Enter choose.
import { fill, h, icon } from "./dom.js";
import { formatBytes, formatContext, modelKey, prettyName, splitKey } from "./models.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./models.js").Model} Model
 */

/** A name for a model key whose model is not listed now. @param {string} key */
export const modelLabel = (key) => prettyName(splitKey(key).id);

/** @type {Record<string, { icon: import("./dom.js").IconName, label: string }>} */
export const CAPS = {
  vision: { icon: "eye", label: "Vision" },
  tools: { icon: "wrench", label: "Tools" },
  reasoning: { icon: "lightbulb", label: "Reasoning" },
  code: { icon: "code", label: "Code" },
  embedding: { icon: "link", label: "Embedding" },
};

/** Badges for what a model can do. @param {Model} m */
export function capBadges(m) {
  return m.caps
    .filter((c) => CAPS[c])
    .map((c) =>
      h("span.lm-cap", { title: CAPS[c].label, dataset: { cap: c } }, icon(CAPS[c].icon)),
    );
}

/** @param {App} app */
export function pickerView(app) {
  const { S } = app;
  const input = /** @type {HTMLInputElement} */ (
    h("input.desk-field.lm-picker-input", {
      type: "search",
      placeholder: "Search models",
      "aria-label": "Search models",
    })
  );
  const list = h("div.lm-picker-list", { role: "listbox" });
  const panel = h(
    "div.desk-dialog.lm-picker",
    { role: "dialog", "aria-label": "Choose a model" },
    h("div.lm-picker-head", null, icon("search"), input, h("kbd.lm-kbd", null, "Esc")),
    list,
    h(
      "div.lm-picker-foot",
      null,
      h(
        "span",
        null,
        h("kbd.lm-kbd", null, "↑↓"),
        " to move, ",
        h("kbd.lm-kbd", null, "Enter"),
        " to choose",
      ),
      h(
        "button.desk-btn.desk-btn-quiet",
        {
          type: "button",
          onClick: () => {
            S.set({ picker: false, view: "models" });
          },
        },
        icon("cube"),
        "Manage models",
      ),
    ),
  );
  const el = h(
    "div.lm-scrim",
    {
      hidden: true,
      onMousedown: (/** @type {MouseEvent} */ e) => e.target === el && S.set({ picker: false }),
    },
    panel,
  );
  let active = 0;
  /** @type {Model[]} */
  let rows = [];

  function draw() {
    const { models, servers, selected, thread } = S.get();
    const current = thread?.model ?? selected;
    const q = input.value.trim().toLowerCase();
    const chat = models.filter((m) => !m.caps.includes("embedding"));
    rows = chat.filter(
      (m) => !q || `${m.name} ${m.id} ${m.family ?? ""}`.toLowerCase().includes(q),
    );
    active = Math.max(0, Math.min(active, rows.length - 1));
    if (!rows.length) {
      fill(
        list,
        h(
          "div.lm-picker-empty",
          null,
          chat.length
            ? `No model matches “${input.value.trim()}”.`
            : "No chat model found on the servers answering.",
        ),
      );
      return;
    }
    /** @type {HTMLElement[]} */
    const out = [];
    for (const server of servers) {
      const mine = rows.filter((m) => m.serverId === server.id);
      if (!mine.length) continue;
      out.push(
        h(
          "div.lm-picker-group",
          null,
          h("span.lm-server-dot", { dataset: { state: server.status } }),
          server.label,
          server.version ? h("span.lm-muted", null, ` · ${server.version}`) : null,
        ),
      );
      for (const m of mine) {
        const index = rows.indexOf(m);
        const key = modelKey(m);
        out.push(
          h(
            "button.desk-row.lm-picker-row",
            {
              type: "button",
              role: "option",
              "aria-selected": index === active ? "true" : "false",
              dataset: { current: key === current ? "1" : undefined },
              onMouseenter: (/** @type {MouseEvent} */ e) => {
                active = index;
                for (const r of list.querySelectorAll(".lm-picker-row"))
                  r.setAttribute("aria-selected", r === e.currentTarget ? "true" : "false");
              },
              onClick: () => app.choose(key),
            },
            h("span.lm-pill-dot", {
              dataset: { state: m.loaded ? "loaded" : "ready" },
              title: m.loaded ? "In memory" : "On disk",
            }),
            h(
              "span.lm-picker-main",
              null,
              h("span.lm-picker-name", null, m.name),
              h("span.lm-picker-id", null, m.id),
            ),
            h("span.lm-picker-caps", null, capBadges(m)),
            h(
              "span.lm-picker-meta",
              null,
              [m.params, m.quant, formatBytes(m.size), m.ctx ? `${formatContext(m.ctx)} ctx` : ""]
                .filter(Boolean)
                .map((t) => h("span", null, t)),
            ),
            key === current ? icon("check", "lm-picker-check") : h("span.lm-picker-check"),
          ),
        );
      }
    }
    fill(list, out);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", () => {
    active = 0;
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      S.set({ picker: false });
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % Math.max(1, rows.length);
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = rows[active];
      if (m) app.choose(modelKey(m));
    }
  });

  S.on(["picker", "models", "servers"], (s, changed) => {
    el.hidden = !s.picker;
    if (changed.has("picker") && s.picker) {
      input.value = "";
      const current = s.thread?.model ?? s.selected;
      const chat = s.models.filter((m) => !m.caps.includes("embedding"));
      active = Math.max(
        0,
        chat.findIndex((m) => modelKey(m) === current),
      );
      draw();
      requestAnimationFrame(() => input.focus());
    } else if (s.picker) draw();
  });
  return { el };
}
