// desk.palette: the command palette (M-x) and the place commands ask the person to pick one of many
// (completing-read). It lists and runs the core's command registry (cmd.list, cmd.invoke) under its
// cmd:invoke grant, exactly as any plugin could; its own commands come to it as cmd.invoked.
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { filter, remember } from "./match.js";
import { createSearch, openSearchHit, searchEntry } from "./search.js";

const OWN = new Set(["desk.palette.open", "desk.palette.pick", "desk.palette.cancel"]);

defineUiPlugin({
  async mount(ctx) {
    const $ = (id) => document.querySelector(`[data-testid=${id}]`);
    const input = $("query");
    const list = $("results");
    const title = $("title");

    /** What the palette shows now: commands to run, or items a command asked to pick from. */
    let mode = null;
    let shown = [];
    let selected = 0;
    let history = [];
    let max = 50;
    let pluginHits = [];
    let systemHits = [];
    let choosing = false;
    const status = $("status");
    const search = createSearch(
      ctx.bridge,
      (source, hits) => {
        if (source === "plugins") pluginHits = hits.map(searchEntry);
        else systemHits = hits.map(searchEntry);
        render();
      },
      (text) => {
        status.textContent = text;
      },
    );
    if (new URLSearchParams(location.search).has("native")) document.body.classList.add("native");

    const loaded = await ctx.bridge.call("store.get", { key: "history" }).catch(() => ({}));
    if (Array.isArray(loaded.value)) history = loaded.value;

    const render = () => {
      shown = filter(input.value, mode?.entries ?? [], mode?.kind === "commands" ? history : []);
      if (mode?.kind === "commands") {
        shown = input.value.trim()
          ? [...pluginHits, ...shown, ...systemHits]
          : [...shown, ...pluginHits];
      }
      // A pick that takes free text offers what was typed as its first answer.
      const typed = input.value.trim();
      if (mode?.free && typed && !shown.some((entry) => entry.id === typed)) {
        shown = [{ id: typed, label: `Use “${typed}”`, detail: "typed" }, ...shown];
      }
      selected = Math.min(selected, Math.max(0, shown.length - 1));
      list.replaceChildren(
        ...shown.map((entry, index) => {
          const item = document.createElement("li");
          item.id = `option-${index}`;
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(index === selected));
          item.dataset.id = entry.id;
          const label = document.createElement("span");
          label.className = "label";
          label.textContent = entry.label;
          const side = document.createElement("span");
          side.className = entry.keys?.length ? "keys" : "detail";
          side.textContent = entry.keys?.join(", ") || entry.detail || "";
          item.append(label, side);
          item.addEventListener("mousedown", (event) => {
            event.preventDefault();
            selected = index;
            choose();
          });
          return item;
        }),
      );
      if (shown.length === 0) {
        const none = document.createElement("li");
        none.className = "empty";
        none.textContent = "No match";
        list.append(none);
      }
      input.setAttribute("aria-activedescendant", shown.length ? `option-${selected}` : "");
      list.children[selected]?.scrollIntoView?.({ block: "nearest" });
    };

    const show = (next) => {
      mode?.cancel?.();
      mode = next;
      title.textContent = next.title;
      input.placeholder = next.placeholder ?? "";
      input.value = next.query ?? "";
      selected = 0;
      pluginHits = [];
      systemHits = [];
      status.textContent = "";
      search.cancel();
      render();
      if (next.kind === "commands") search.query(input.value);
      ctx.surface.show();
      input.focus();
    };

    const close = () => {
      const was = mode;
      mode = null;
      search.cancel();
      ctx.surface.hide();
      return was;
    };

    const choose = async () => {
      const entry = shown[selected];
      if (!entry || choosing || !mode) return;
      if (mode.kind === "pick") {
        close()?.resolve(entry.id);
        return;
      }
      choosing = true;
      const was = mode;
      try {
        if (entry.hit) {
          await openSearchHit(ctx, entry.hit);
          if (ctx.pluginId === "palette" && entry.hit.plugin)
            window.parent.postMessage({ type: "desk:palette-activated" }, "*");
          if (mode === was) close();
        } else {
          // The native window stays visible until an action succeeds, so it can display failures.
          const native = ctx.pluginId === "palette";
          if (!native) close();
          else window.parent.postMessage({ type: "desk:palette-command" }, "*");
          await ctx.commands.run(entry.id);
          if (native && mode === was) close();
          history = remember(history, entry.id, max);
          void ctx.bridge.call("store.set", { key: "history", value: history }).catch(() => {});
        }
      } catch (error) {
        if (!mode) show(was);
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        choosing = false;
      }
    };

    const cancel = () => close()?.cancel?.();
    // Native blur and hotkey-toggle hides also invalidate in-flight results.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) search.cancel();
    });

    input.addEventListener("input", () => {
      selected = 0;
      render();
      if (mode?.kind === "commands") search.query(input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const moves = { ArrowDown: 1, ArrowUp: -1 };
      if (event.key in moves && shown.length > 0) {
        selected = (selected + moves[event.key] + shown.length) % shown.length;
        render();
      } else if (event.key === "Enter") {
        choose();
      } else if (event.key === "Escape") {
        cancel();
      } else {
        return;
      }
      // Handled here, so the desk's keymap does not see it too.
      event.preventDefault();
    });
    $("scrim").addEventListener("mousedown", cancel);
    // The surface becomes visible after show() reaches the desk, which then focuses this frame.
    window.addEventListener("focus", () => {
      if (mode) input.focus();
    });

    ctx.commands.on("desk.palette.open", async (args) => {
      const [commands, bindings, init] = await Promise.all([
        ctx.commands.list(),
        ctx.commands.run("desk.keys.list").catch(() => []),
        ctx.bridge.call("init.get", {}).catch(() => ({ settings: {} })),
      ]);
      max = init.settings["desk.palette.history"] ?? max;
      const keysOf = (id) => bindings.filter((b) => b.command === id).map((b) => b.key);
      show({
        kind: "commands",
        title: "Search Desk",
        placeholder: "Search plugins, data, files and applications",
        query: args?.query ?? "",
        entries: commands
          .filter((c) => !OWN.has(c.id))
          .map((c) => ({ id: c.id, label: c.title, keywords: c.keywords, keys: keysOf(c.id) })),
      });
    });

    ctx.commands.on(
      "desk.palette.pick",
      (args) =>
        new Promise((resolve, reject) => {
          const items = Array.isArray(args?.items) ? args.items : [];
          show({
            kind: "pick",
            title: args?.title ?? "Pick one",
            placeholder: args?.placeholder ?? "",
            free: args?.free === true,
            entries: items.map((item) => ({
              id: String(item.id),
              label: item.label ?? String(item.id),
              detail: item.detail,
            })),
            resolve,
            cancel: () =>
              reject(new CommandFailed("desk.palette.pick", "cancelled", "nothing was picked")),
          });
        }),
    );

    ctx.commands.on("desk.palette.cancel", () => {
      cancel();
    });
  },
});
