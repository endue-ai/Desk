// desk.palette: the command palette (M-x) and the place commands ask the person to pick one of many
// (completing-read). It lists and runs the core's command registry (cmd.list, cmd.invoke) under its
// cmd:invoke grant, exactly as any plugin could; its own commands come to it as cmd.invoked. Typing
// also asks the palette providers (desk.palette.providers), its own item search among them, whose
// results follow the commands in one group each. The first row is the selected one until the
// person moves the selection; the first list is what they used last, the plugins, then the commands.
import { CommandFailed, defineUiPlugin } from "@endue-ai/plugin-sdk";
import { keyHint } from "./keys.js";
import { commandEntries, filter, rank, remember } from "./match.js";
import { actionOf, createAsker, rows, searchItems } from "./providers.js";
import { createSearch, openSearchHit, searchEntry } from "./search.js";

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
    /** The person moved the selection with the arrows: it stays on its row as results arrive. */
    let moved = false;
    let lastInput = "";
    let history = [];
    let max = 50;
    let pluginHits = [];
    let systemHits = [];
    let choosing = false;
    const native = ctx.pluginId === "palette";
    const status = $("status");
    const search = createSearch(
      ctx.bridge,
      (source, hits) => {
        const entries = hits.map((hit) => ({ ...searchEntry(hit), source }));
        if (source === "plugins") pluginHits = entries;
        else systemHits = entries;
        render();
      },
      (text) => {
        status.textContent = text;
      },
      () => {
        if (mode?.kind === "commands") render();
      },
    );
    if (native) document.body.classList.add("native");
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
      const keys = entry?.keys ?? [];
      const side = keys.length
        ? element("span", { class: "keys" })
        : element("span", { class: "detail" }, (result ?? entry).detail || "");
      // A sequence shows chord by chord: ⌘K ⌘S.
      side.append(...keyHint(keys, element));
      item.append(element("span", { class: "label" }, result ? result.title : entry.label), side);
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

    const identity = (row) => {
      if (!row) return null;
      if (row.type === "result") return JSON.stringify(["provider", row.provider, row.result.id]);
      const entry = row.entry;
      return entry.hit
        ? JSON.stringify(["search", entry.source, entry.hit.plugin ?? entry.hit.kind, entry.id])
        : JSON.stringify(["command", entry.provider ?? "", entry.id]);
    };

    const render = () => {
      const previous = identity(shown[selected]);
      const commands = mode?.kind === "commands";
      const entries = commands
        ? rank(input.value, mode.entries, pluginHits, history)
        : filter(input.value, mode?.entries ?? []);
      // A pick that takes free text offers what was typed as its first answer.
      const typed = input.value.trim();
      if (mode?.free && typed && !entries.some((entry) => entry.id === typed)) {
        entries.unshift({ id: typed, label: `Use “${typed}”`, detail: "typed" });
      }
      shown = rows(entries, commands ? asker.groups() : []);
      if (commands && typed) shown = [...shown, ...rows(systemHits, [])];
      // The first row is the selected one, whatever arrives ahead of it, until the person moves it.
      const kept = moved ? shown.findIndex((row) => identity(row) === previous) : -1;
      if (kept < 0) moved = false;
      selected = Math.max(0, kept);
      const children = [];
      /** The group the last row went into: a provider's results, or a section of the first list. */
      let group = null;
      shown.forEach((row, index) => {
        const item = option(row, index);
        const title = row.type === "result" ? row.group : row.entry.section;
        if (!title) {
          group = null;
          children.push(item);
          return;
        }
        const key = row.type === "result" ? row.provider : title;
        if (group?.key !== key) {
          const box = element("li", { role: "group", "aria-label": title });
          if (row.type === "result") box.dataset.provider = row.provider;
          const inner = element("ul", { role: "none" });
          box.append(element("span", { class: "group", "aria-hidden": "true" }, title), inner);
          children.push(box);
          group = { key, inner };
        }
        group.inner.append(item);
      });
      list.replaceChildren(...children);
      // A question that takes typed text has nothing to match before something is typed.
      if (shown.length === 0 && !(mode?.free && !typed)) {
        const pending = mode?.kind === "commands" && (search.pending() || asker.pending());
        list.append(
          element(
            "li",
            { class: "empty", role: "option", "aria-disabled": "true" },
            pending ? "Searching…" : "No match",
          ),
        );
      }
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
      moved = false;
      shown = [];
      lastInput = input.value;
      pluginHits = [];
      systemHits = [];
      status.textContent = "";
      search.cancel();
      if (next.kind === "commands") {
        search.query(input.value);
        asker.ask(input.value);
      }
      render();
      ctx.surface.show();
      input.focus();
    };

    const close = () => {
      const was = mode;
      mode = null;
      asker.reset([]);
      search.cancel();
      ctx.surface.hide();
      return was;
    };

    /**
     * A command run from here that failed is reported on the status line: its title, then why. A
     * cancelled one (the person backed out of a pick) is not.
     * @param {string} what
     * @param {unknown} error
     */
    const report = (what, error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/^[^:]+: cancelled: /.test(message)) return;
      void ctx.bridge
        .call("ui.notify", {
          title: `${what} failed`,
          body: message.replace(/^[^:]+: (?:failed|unknown_command): /, ""),
          level: "error",
          scope: { permission: "ui:notify" },
        })
        .catch(() => {});
    };

    /** What was run or opened from here comes first in the next first list. */
    const keep = (/** @type {string} */ id) => {
      history = remember(history, id, max);
      void ctx.bridge.call("store.set", { key: "history", value: history }).catch(() => {});
    };

    /** Run a command, published document, OS hit, or provider action. */
    const choose = async (mod = false) => {
      const row = shown[selected];
      if (!row || choosing || !mode) return;
      const entry = row.entry;
      if (mode.kind === "pick") {
        close()?.resolve(entry.id);
        return;
      }
      choosing = true;
      const was = mode;
      const action = row.type === "result" ? actionOf(row.result, mod) : null;
      const label = action?.title ?? entry?.label ?? "Search result";
      try {
        if (entry?.hit) {
          await openSearchHit(ctx, entry.hit);
          if (entry.hit.kind === "plugin") keep(entry.id);
          if (native && entry.hit.plugin)
            window.parent.postMessage({ type: "desk:palette-activated" }, "*");
          if (mode === was) close();
        } else {
          if (!native) close();
          else window.parent.postMessage({ type: "desk:palette-command" }, "*");
          await ctx.commands.run(action?.command ?? entry.id, action?.args ?? {});
          if (native && mode === was) close();
          if (!action) keep(entry.id);
        }
      } catch (error) {
        if (native || entry?.hit) {
          if (!mode) show(was);
          status.textContent = error instanceof Error ? error.message : String(error);
        } else report(label, error);
      } finally {
        choosing = false;
      }
    };

    const cancel = () => close()?.cancel?.();

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        search.cancel();
        asker.reset([]);
      } else if (mode?.kind === "commands") {
        asker.reset(mode.providers ?? []);
        search.query(input.value);
        asker.ask(input.value);
        render();
      }
    });
    input.addEventListener("input", () => {
      if (input.value !== lastInput) {
        selected = 0;
        moved = false;
        shown = [];
        lastInput = input.value;
      }
      if (mode?.kind === "commands") {
        search.query(input.value);
        asker.ask(input.value);
      }
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const moves = { ArrowDown: 1, ArrowUp: -1 };
      if (event.key in moves && shown.length > 0) {
        selected = (selected + moves[event.key] + shown.length) % shown.length;
        moved = true;
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
      // Its key again while the desk's palette is open closes it, as Escape does.
      if (!native && mode?.kind === "commands" && !document.hidden && args?.query === undefined)
        return cancel();
      const [listed, bindings, init, providers] = await Promise.all([
        // The registry itself, for each command's argsSchema: one that needs args is not listed.
        ctx.bridge.call("cmd.list", { scope: { permission: "cmd:invoke", ids: ["*"] } }),
        ctx.commands.run("desk.keys.list").catch(() => []),
        ctx.bridge.call("init.get", {}).catch(() => ({ settings: {} })),
        ctx.commands.run("desk.palette.providers").catch(() => []),
      ]);
      max = init.settings["desk.palette.history"] ?? max;
      const asked = Array.isArray(providers) ? providers : [];
      // A provider's command needs a query: the palette asks it, the person does not run it.
      const hidden = new Set([...OWN, ...asked.map((p) => p.command)]);
      show({
        kind: "commands",
        title: "Search Desk",
        placeholder: "Search plugins, data, files and applications",
        query: args?.query ?? "",
        providers: asked,
        entries: commandEntries(listed.commands, Array.isArray(bindings) ? bindings : [], hidden),
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
            // The text the input starts with, as for desk.palette.open: a rename's old name.
            query: typeof args?.query === "string" ? args.query : "",
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
