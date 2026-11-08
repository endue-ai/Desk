// The right status panel: a list of drawers, one open at a time. It uses only the public bridge
// API (plugin.list and plugin.changed), exactly as a community plugin with plugin:manage would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { drawers } from "./drawers.js";

const scope = { permission: "plugin:manage" };

defineUiPlugin({
  async mount({ bridge, state }) {
    const list = document.getElementById("drawers");
    /** The open drawer's id; kept by the runtime, so a reload keeps it open. */
    let open = state.get()?.open ?? null;
    let shown = [];

    const span = (className, text) => {
      const el = document.createElement("span");
      el.className = className;
      el.textContent = text;
      return el;
    };

    const body = (drawer) => {
      const region = document.createElement("div");
      region.id = `drawer-${drawer.id}-body`;
      region.className = "body";
      region.setAttribute("role", "region");
      region.setAttribute("aria-labelledby", `drawer-${drawer.id}`);
      region.hidden = drawer.id !== open;
      if (drawer.note) {
        const note = document.createElement("p");
        note.className = "note";
        note.textContent = drawer.note;
        region.append(note);
      }
      if (drawer.rows.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = drawer.empty;
        region.append(empty);
        return region;
      }
      const rows = document.createElement("ul");
      rows.className = "rows";
      for (const row of drawer.rows) {
        const item = document.createElement("li");
        if (row.warning) item.className = "warning";
        item.append(span("label", row.label), " ", span("detail", row.detail));
        rows.append(item);
      }
      region.append(rows);
      return region;
    };

    const entry = (drawer) => {
      const item = document.createElement("li");
      item.className = "drawer";
      const heading = document.createElement("h2");
      const head = document.createElement("button");
      head.type = "button";
      head.id = `drawer-${drawer.id}`;
      head.className = drawer.warning ? "head warning" : "head";
      head.setAttribute("aria-expanded", String(drawer.id === open));
      head.setAttribute("aria-controls", `drawer-${drawer.id}-body`);
      const chevron = span("chevron", "›");
      chevron.setAttribute("aria-hidden", "true");
      head.append(span("title", drawer.title), " ", span("summary", drawer.summary), chevron);
      head.addEventListener("click", () => {
        open = open === drawer.id ? null : drawer.id;
        state.set({ open });
        render();
      });
      heading.append(head);
      item.append(heading, body(drawer));
      return item;
    };

    const render = () => {
      const focused = list.contains(document.activeElement) ? document.activeElement.id : "";
      list.replaceChildren(...shown.map(entry));
      if (focused) document.getElementById(focused)?.focus();
    };

    const refresh = async () => {
      const { plugins } = await bridge.call("plugin.list", { scope });
      shown = drawers(plugins);
      render();
    };

    bridge.onEvent((event) => {
      if (event.event === "plugin.changed") void refresh();
    });
    await refresh();
  },
});
