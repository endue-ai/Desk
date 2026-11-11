// The chat plugin without its DOM: every chat account's conversations in one place, the layout the
// person picked (Conversation, Inbox, Timeline, Columns), the conversation and thread open, and the
// flow between them. Messages come from the desk's index (load.js, sync.js); writing and acting on
// them runs the connector's commands (writing.js); the commands are commands.js. It talks only to
// ctx.bridge, ctx.commands, ctx.settings, ctx.surface and a view, so the SDK's test host runs it.
import { createActions } from "./actions.js";
import { registerCommands } from "./commands.js";
import { quickReactions } from "./emoji.js";
import { createLoad } from "./load.js";
import { createLookup } from "./lookup.js";
import { move } from "./model.js";
import { platformOf } from "./platforms.js";
import { chromeOf, mainOf, sidebarOf, threadOf, visible } from "./present.js";
import { filterOf, layoutOf } from "./query.js";
import {
  asArgs,
  asString,
  asStrings,
  DEFAULTS,
  DENSITIES,
  emptyStream,
  initialState,
  NOTIFY,
  pageOf,
  SAVED_MAX,
} from "./state.js";
import { createSync } from "./sync.js";
import { MAX_COLUMNS } from "./timeline.js";
import { createWriting, DRAFTS_KEY } from "./writing.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {import("./present.js").Chrome} Chrome
 * @typedef {import("./present.js").Main} Main
 * @typedef {import("./present.js").ThreadModel} ThreadModel
 * @typedef {ReturnType<typeof import("./present.js").sidebarOf>} Sidebar
 * @typedef {{
 *   chrome(model: Chrome): void, sidebar(model: Sidebar): void, main(model: Main): void,
 *   thread(model: ThreadModel | null): void, status(text: string): void, focus(where: string): void,
 * }} View
 */

const VIEW_KEY = "view";
const SAVED_KEY = "saved";

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings" | "surface">} ctx
 * @param {View} view
 * @param {{ now?: () => number, zone?: string, locale?: string, saveMs?: number }} [options]
 */
export function createChat({ bridge, commands, settings, surface }, view, options = {}) {
  const now = options.now ?? (() => Date.now());
  const s = initialState(now());
  const actions = createActions({ bridge, commands });
  let said = "";
  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const store = (/** @type {string} */ key, /** @type {unknown} */ value) =>
    void bridge.call("store.set", { key, value }).catch(() => {});
  const saveView = () =>
    store(VIEW_KEY, {
      layout: s.layout,
      filter: s.filter,
      platform: s.platform,
      current: s.current,
      pinned: s.pinned,
    });
  const clock = () => ({
    now: now(),
    ...(options.zone ? { zone: options.zone } : {}),
    ...(options.locale ? { locale: options.locale } : {}),
  });

  const render = () => {
    if (!s.ready) return;
    const c = clock();
    view.chrome(chromeOf(s));
    view.sidebar(sidebarOf(s, c));
    view.main(mainOf(s, c));
    view.thread(s.layout === "conversation" ? threadOf(s, c) : null);
  };

  const load = createLoad({ state: s, actions, say, render });
  const sync = createSync({ state: s, actions, load, bridge, say, render });
  const writing = createWriting({
    state: s,
    actions,
    sync,
    load,
    say,
    render,
    store,
    now,
    ...(options.saveMs === undefined ? {} : { saveMs: options.saveMs }),
  });
  const { message, lastOwn, find, keysOnScreen } = createLookup({ state: s, actions });

  /** Open a conversation, with one of its messages selected. @param {string} key @param {string} [select] */
  const openConversation = async (key, select) => {
    if (!load.refOf(key)) throw new Error(`${key} is not a conversation.`);
    const changed = s.current !== key;
    s.current = key;
    if (changed) s.thread = null;
    s.selected = select ?? null;
    if (s.layout !== "conversation") s.layout = "conversation";
    saveView();
    if (changed || !s.open) {
      s.open = null;
      await load.conversation(key);
    } else render();
    if (s.conf.markRead === "open") await writing.markRead(key, true).catch(() => 0);
    return key;
  };
  const openThread = async (/** @type {ChatMessage} */ root) => {
    if (s.current !== root.conversation) await openConversation(root.conversation, root.key);
    s.selected = root.key;
    await load.thread(root);
  };

  const setLayout = async (/** @type {string} */ id) => {
    const layout = layoutOf(id);
    if (!layout)
      throw new Error(`${id} is not a layout: conversation, inbox, timeline or columns.`);
    s.layout = layout.id;
    saveView();
    await load.layout();
    return s.layout;
  };
  const setFilter = async (/** @type {string} */ id) => {
    const filter = filterOf(id);
    if (!filter) throw new Error(`${id} is not a filter: all, unread, mentions, direct or saved.`);
    s.filter = filter.id;
    saveView();
    if (s.layout === "timeline") await load.timeline();
    else render();
    return s.filter;
  };
  const setPlatform = async (/** @type {string | null} */ id) => {
    s.platform = id === null ? null : platformOf(id).id;
    saveView();
    if (s.layout === "timeline") await load.timeline();
    else if (s.layout === "columns") await load.columns();
    else render();
    return s.platform ?? "all";
  };
  const setSearch = async (/** @type {string} */ text) => {
    s.search = text.trim();
    if (s.search && s.layout !== "timeline") s.layout = "timeline";
    saveView();
    await load.timeline();
    return s.search;
  };
  const refresh = async () => {
    [s.accounts, s.installed] = await Promise.all([actions.accounts(), actions.installed()]);
    s.available = await actions.available();
    s.sending = s.sending.filter((p) => p.state !== "sent");
    await load.lists();
    if (s.current && s.layout === "conversation") await load.conversation(s.current);
    if (s.thread) await load.thread(s.thread.root);
    if (s.layout === "timeline") await load.timeline();
    if (s.layout === "columns") await load.columns(true);
  };
  const nextUnread = async () => {
    const order = sidebarOf(s).groups.flatMap((g) => g.rows.map((r) => r.key));
    const unread = order.filter((key) => (s.byKey.get(key)?.unread ?? 0) > 0);
    if (unread.length === 0) throw new Error("Nothing unread.");
    const at = s.current ? order.indexOf(s.current) : -1;
    const next = unread.find((key) => order.indexOf(key) > at) ?? unread[0];
    return openConversation(/** @type {string} */ (next));
  };
  const toggleSave = (/** @type {ChatMessage} */ m) => {
    const saved = !s.saved.includes(m.key);
    s.saved = saved ? [m.key, ...s.saved].slice(0, SAVED_MAX) : s.saved.filter((k) => k !== m.key);
    store(SAVED_KEY, s.saved);
    if (s.layout === "timeline" && s.filter === "saved") void load.timeline();
    else render();
    return saved;
  };
  const togglePin = (/** @type {string} */ key) => {
    if (!load.refOf(key)) throw new Error(`${key} is not a conversation.`);
    const pinned = !s.pinned.includes(key);
    if (pinned && s.pinned.length >= MAX_COLUMNS)
      throw new Error(`At most ${MAX_COLUMNS} columns can be pinned.`);
    s.pinned = pinned ? [...s.pinned, key] : s.pinned.filter((k) => k !== key);
    saveView();
    if (s.layout === "columns") void load.columns();
    else render();
    return pinned;
  };
  const { command } = registerCommands({
    commands,
    surface,
    view,
    say,
    pick: actions.pick,
    writing,
    app: {
      layout: () => s.layout,
      current: () => s.current,
      conversations: () => visible(s),
      message,
      lastOwn,
      openConversation,
      openThread,
      setLayout,
      setFilter,
      setPlatform,
      setSearch,
      refresh,
      nextUnread,
      toggleSave,
      togglePin,
      find,
      connect: actions.connect,
    },
  });

  settings.onChange(({ key: name, value }) => {
    if (name === "page") s.conf.page = pageOf(value);
    if (name === "notify" && NOTIFY.includes(String(value))) s.conf.notify = String(value);
    if (name === "mark-read" && typeof value === "string") s.conf.markRead = value;
    if (name === "enter-sends" && typeof value === "boolean") s.conf.enterSends = value;
    if (name === "density" && DENSITIES.includes(String(value))) s.conf.density = String(value);
    if (name === "quick-reactions") s.conf.quick = quickReactions(value);
    render();
  });

  /** Read the settings and the saved state, show the chats, and follow the index. */
  const start = async () => {
    s.startedAt = now();
    const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
    const setting = async (/** @type {keyof typeof DEFAULTS} */ name) =>
      (await settings.get(name).catch(() => undefined)) ??
      /** @type {Record<string, unknown> | undefined} */ (init.settings)?.[`endue.chat.${name}`] ??
      DEFAULTS[name];
    const notify = String(await setting("notify"));
    const density = String(await setting("density"));
    s.conf = {
      page: pageOf(await setting("page")),
      notify: NOTIFY.includes(notify) ? notify : DEFAULTS.notify,
      markRead: asString(await setting("mark-read")) ?? DEFAULTS["mark-read"],
      enterSends: (await setting("enter-sends")) !== false,
      density: DENSITIES.includes(density) ? density : DEFAULTS.density,
      quick: quickReactions(await setting("quick-reactions")),
    };
    const read = async (/** @type {string} */ key) =>
      /** @type {{ value?: unknown }} */ (await bridge.call("store.get", { key }).catch(() => ({})))
        .value;
    const saved = asArgs(await read(VIEW_KEY));
    s.layout = layoutOf(saved.layout)?.id ?? "conversation";
    s.filter = filterOf(saved.filter)?.id ?? "all";
    s.platform = asString(saved.platform) ?? null;
    s.pinned = asStrings(saved.pinned).slice(0, MAX_COLUMNS);
    const drafts = asArgs(await read(DRAFTS_KEY));
    s.drafts = Object.fromEntries(
      Object.entries(drafts).filter(([, v]) => typeof v === "string" && v !== ""),
    );
    s.saved = asStrings(await read(SAVED_KEY)).slice(0, SAVED_MAX);
    [s.accounts, s.available, s.installed] = await Promise.all([
      actions.accounts(),
      actions.available(),
      actions.installed(),
    ]);
    s.ready = true;
    await Promise.all([load.lists(), sync.follow()]);
    const current = asString(saved.current);
    s.current = current && load.refOf(current) ? current : null;
    s.timeline = emptyStream();
    if (s.current && s.layout === "conversation") await openConversation(s.current);
    else await load.layout();
  };

  return {
    start,
    command,
    select(/** @type {string | null} */ key) {
      s.selected = key;
      render();
    },
    /** A key pressed on the messages or the thread; resolves whether it was used. */
    async key(/** @type {string} */ name, where = "messages") {
      if (name === "Enter") {
        if (!s.selected) return false;
        await this.activate(s.selected);
        return true;
      }
      const next = move(keysOnScreen(where), s.selected, name);
      if (next === undefined) return false;
      s.selected = next;
      render();
      return true;
    },
    /** A message clicked or entered: in a conversation its thread opens, elsewhere its conversation. */
    async activate(/** @type {string} */ key) {
      const m = await message(key);
      s.selected = key;
      if (s.layout === "conversation" && s.current === m.conversation) {
        if (m.replyCount > 0 || m.thread)
          await openThread(
            m.isReply ? await message(`${m.source.connector}/${m.source.instance}#${m.thread}`) : m,
          );
        else render();
        return;
      }
      await command("endue.chat.show", { key });
    },
    openConversation,
    closeThread() {
      if (!s.thread) return false;
      s.thread = null;
      render();
      return true;
    },
    more: (/** @type {string} */ where) =>
      where === "timeline"
        ? load.timeline(true)
        : s.current
          ? load.conversation(s.current, true)
          : Promise.resolve(),
    type: (/** @type {string} */ target, /** @type {string} */ text) => writing.type(target, text),
    retry: (/** @type {string} */ key) => writing.retry(key).catch(() => {}),
    discard: (/** @type {string} */ key) => writing.discard(key),
    cancelEdit: () => writing.cancelEdit(),
    link: (/** @type {string} */ url) => actions.open(url).catch((error) => say(error.message)),
    /** For tests: the plugin's state. */
    state: () => s,
  };
}
