// desk.palette: the command palette (M-x) and the place commands ask the person to pick one of many
// (completing-read). It lists and runs the core's command registry (cmd.list, cmd.invoke) under its
// cmd:invoke grant, exactly as any plugin could; its own commands come to it as cmd.invoked. Typing
// also asks the palette providers (desk.palette.providers), its own item search among them, whose
// results follow the commands in one group each.
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { filter, remember } from "./match.js";
import { actionOf, createAsker, rows, searchItems } from "./providers.js";

const OWN = new Set([
  "desk.palette.open",
  "desk.palette.pick",
  "desk.palette.cancel",
  "desk.palette.items",
  "desk.palette.providers",
]);
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const KEYS = ["Enter", MAC ? "⌘Enter" : "Ctrl+Enter"];

defineUiPlugin({
  async mount(ctx) {
    const $ = (id) => document.querySelector(`[data-testid=${id}]`);
    const input = $("query");
    const list = $("results");
    const title = $("title");
    const footer = $("actions");

    /** What the palette shows now: commands to run, or items a command asked to pick from. */
    let mode = null;
    let shown = [];
    let selected = 0;
    let history = [];
    let max = 50;
    const asker = createAsker(
      (command, query) => ctx.commands.run(command, query),
      () => {
        if (mode?.kind === "commands") render();
      },
    );

    const loaded = await ctx.bridge.call("store.get", { key: "history" }).catch(() => ({}));
    if (Array.isArray(loaded.value)) history = loaded.value;

    const element = (tag, attributes = {}, text) => {
      const el = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
      if (text !== undefined) el.textContent = text;
      return el;
    };

    /** One row as an option: a command with its keys, or a provider's result with its detail. */
    const option = (row, index) => {
      const item = element("li", {
        id: `option-${index}`,
        role: "option",
        "aria-selected": String(index === selected),
      });
      const result = row.type === "result" ? row.result : null;
      const entry = row.type === "command" ? row.entry : null;
      item.dataset.id = result ? result.id : entry.id;
      if (result) {
        item.dataset.provider = row.provider;
        if (result.kind) item.dataset.kind = result.kind;
      }
      const side = entry?.keys?.length ? "keys" : "detail";
      item.append(
        element("span", { class: "label" }, result ? result.title : entry.label),
        element("span", { class: side }, entry?.keys?.join(", ") || (result ?? entry).detail || ""),
      );
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selected = index;
        choose(event.metaKey || event.ctrlKey);
      });
      return item;
    };

    /** The selected result's actions, in order, under the list; nothing for a command. */
    const showActions = () => {
      const row = shown[selected];
      const actions = row?.type === "result" ? row.result.actions : [];
      footer.hidden = actions.length === 0;
      footer.replaceChildren(
        ...actions.map((action, i) => {
          const span = element("span", { class: "action" });
          if (KEYS[i]) span.append(element("kbd", {}, KEYS[i]), " ");
          span.append(action.title);
          return span;
        }),
      );
    };

    const render = () => {
      const entries = filter(
        input.value,
        mode?.entries ?? [],
        mode?.kind === "commands" ? history : [],
      );
      // A pick that takes free text offers what was typed as its first answer.
      const typed = input.value.trim();
      if (mode?.free && typed && !entries.some((entry) => entry.id === typed)) {
        entries.unshift({ id: typed, label: `Use “${typed}”`, detail: "typed" });
      }
      shown = rows(entries, mode?.kind === "commands" ? asker.groups() : []);
      selected = Math.min(selected, Math.max(0, shown.length - 1));
      const children = [];
      /** The group the last result went into, by provider. */
      let group = null;
      shown.forEach((row, index) => {
        const item = option(row, index);
        if (row.type === "command") {
          group = null;
          children.push(item);
          return;
        }
        if (group?.provider !== row.provider) {
          const box = element("li", {
            role: "group",
            "aria-label": row.group,
            "data-provider": row.provider,
          });
          const inner = element("ul", { role: "none" });
          box.append(element("span", { class: "group", "aria-hidden": "true" }, row.group), inner);
          children.push(box);
          group = { provider: row.provider, inner };
        }
        group.inner.append(item);
      });
      list.replaceChildren(...children);
      if (shown.length === 0) list.append(element("li", { class: "empty" }, "No match"));
      input.setAttribute("aria-activedescendant", shown.length ? `option-${selected}` : "");
      document.getElementById(`option-${selected}`)?.scrollIntoView?.({ block: "nearest" });
      showActions();
    };

    const show = (next) => {
      mode?.cancel?.();
      mode = next;
      asker.reset(next.providers ?? []);
      title.textContent = next.title;
      input.placeholder = next.placeholder ?? "";
      input.value = next.query ?? "";
      selected = 0;
      render();
      if (next.kind === "commands") asker.ask(input.value);
      ctx.surface.show();
      input.focus();
    };

    const close = () => {
      const was = mode;
      mode = null;
      asker.reset([]);
      ctx.surface.hide();
      return was;
    };

    /** Run the selected row: a command, a pick, or a result's first action (its second with mod). */
    const choose = (mod = false) => {
      const row = shown[selected];
      if (!row) return;
      const was = close();
      if (row.type === "result") {
        const action = actionOf(row.result, mod);
        if (action) void ctx.commands.run(action.command, action.args ?? {}).catch(() => {});
        return;
      }
      const { entry } = row;
      if (was?.kind === "pick") was.resolve(entry.id);
      if (was?.kind === "commands") {
        history = remember(history, entry.id, max);
        void ctx.bridge.call("store.set", { key: "history", value: history }).catch(() => {});
        void ctx.commands.run(entry.id).catch(() => {});
      }
    };

    const cancel = () => close()?.cancel?.();

    input.addEventListener("input", () => {
      selected = 0;
      if (mode?.kind === "commands") asker.ask(input.value);
      render();
    });
    input.addEventListener("keydown", (event) => {
      const moves = { ArrowDown: 1, ArrowUp: -1 };
      if (event.key in moves && shown.length > 0) {
        selected = (selected + moves[event.key] + shown.length) % shown.length;
        render();
      } else if (event.key === "Enter") {
        choose(event.metaKey || event.ctrlKey);
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
      const [commands, bindings, init, providers] = await Promise.all([
        ctx.commands.list(),
        ctx.commands.run("desk.keys.list").catch(() => []),
        ctx.bridge.call("init.get", {}).catch(() => ({ settings: {} })),
        ctx.commands.run("desk.palette.providers").catch(() => []),
      ]);
      max = init.settings["desk.palette.history"] ?? max;
      const keysOf = (id) => bindings.filter((b) => b.command === id).map((b) => b.key);
      const asked = Array.isArray(providers) ? providers : [];
      // A provider's command needs a query: the palette asks it, the person does not run it.
      const hidden = new Set([...OWN, ...asked.map((p) => p.command)]);
      show({
        kind: "commands",
        title: "Run a command",
        placeholder: "Type a command or search",
        query: args?.query ?? "",
        providers: asked,
        entries: commands
          .filter((c) => !hidden.has(c.id))
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

    // The palette's own provider: items whose text matches, from the index (data:read).
    ctx.commands.on("desk.palette.items", (args) =>
      searchItems(args, (query) => ctx.data.query(query)),
    );
  },
});
