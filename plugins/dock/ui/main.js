// The bottom dock. It uses only the public bridge API (plugin.list, plugin.setEnabled,
// plugin.changed, and cmd.invoke of desk.windows.list and desk.plugins.open), exactly as a
// community plugin granted plugin:manage and those two commands would.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { bringsForward } from "./front.js";
import { intoSight, sideways } from "./scroll.js";
import { tiles } from "./tiles.js";

const scope = { permission: "plugin:manage" };
const NEXT = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

defineUiPlugin({
  async mount({ bridge, commands }) {
    const root = document.getElementById("root");
    const bar = document.getElementById("tiles");
    const empty = document.getElementById("empty");
    const status = document.getElementById("status");
    /** The tile that takes Tab into the dock (roving tabindex), by plugin id. */
    let current;

    /** Whether the plugin's window waits behind; a desk that cannot say gets the plain toggle. */
    const behind = (plugin) =>
      commands.run("desk.windows.list").then(
        (desk) => bringsForward(desk, plugin),
        () => false,
      );

    const toggle = async (tile) => {
      if (!tile.available) {
        status.textContent = `${tile.name}: ${tile.reason}`;
        return;
      }
      try {
        // A window under others, in the drawer or on another desktop comes forward; the one in
        // front, or a plugin with no window, is put away.
        if (tile.open && (await behind(tile.id))) {
          await commands.run("desk.plugins.open", { plugin: tile.id });
          status.textContent = `${tile.name} brought forward`;
          return;
        }
        await bridge.call("plugin.setEnabled", { plugin: tile.id, enabled: !tile.open, scope });
        status.textContent = `${tile.name} ${tile.open ? "put away" : "opened"}`;
      } catch (error) {
        status.textContent = `${tile.name}: ${error.code ?? "error"}`;
      }
    };

    const button = (tile) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "desk-btn tile";
      if (!tile.available) item.classList.add("unavailable");
      item.dataset.plugin = tile.id;
      item.tabIndex = tile.id === current ? 0 : -1;
      item.setAttribute("aria-pressed", String(tile.open));
      if (!tile.available) item.setAttribute("aria-disabled", "true");
      item.title = tile.available ? tile.name : `${tile.name}: ${tile.reason}`;
      const initial = document.createElement("span");
      initial.className = "initial";
      initial.setAttribute("aria-hidden", "true");
      initial.textContent = tile.initial;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = tile.name;
      item.append(initial, name);
      item.addEventListener("click", () => {
        current = tile.id;
        void toggle(tile);
      });
      return item;
    };

    const refresh = async () => {
      const { plugins } = await bridge.call("plugin.list", { scope });
      const list = tiles(plugins);
      if (!list.some((tile) => tile.id === current)) current = list[0]?.id;
      const focused = bar.contains(document.activeElement);
      bar.replaceChildren(...list.map(button));
      empty.hidden = list.length > 0;
      if (focused) bar.querySelector('[tabindex="0"]')?.focus();
    };

    /** Scroll a tile wholly into the part of the row inside the dock's padding. */
    const reveal = (tile) => {
      const box = root.getBoundingClientRect();
      const pad = Number.parseFloat(getComputedStyle(root).paddingLeft) || 0;
      const shown = { left: box.left + pad, right: box.left + root.clientWidth - pad };
      root.scrollLeft += intoSight(tile.getBoundingClientRect(), shown);
    };

    bar.addEventListener("keydown", (event) => {
      const items = [...bar.querySelectorAll(".tile")];
      const at = items.indexOf(document.activeElement);
      if (at < 0) return;
      const step = NEXT[event.key];
      const to =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : step === undefined
              ? -1
              : (at + step + items.length) % items.length;
      if (to < 0) return;
      event.preventDefault();
      items[at].tabIndex = -1;
      items[to].tabIndex = 0;
      items[to].focus();
      reveal(items[to]);
      current = items[to].dataset.plugin;
    });

    // The row runs sideways only: a vertical wheel scrolls it too.
    root.addEventListener(
      "wheel",
      (event) => {
        const by = sideways(event, root.clientWidth);
        if (by === 0 || root.scrollWidth <= root.clientWidth) return;
        event.preventDefault();
        root.scrollLeft += by;
      },
      { passive: false },
    );

    bridge.onEvent((event) => {
      if (event.event === "plugin.changed") void refresh();
    });
    await refresh();
  },
});
