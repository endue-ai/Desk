// The mail plugin without its DOM: the mailboxes, the page of threads on screen, the message that
// is open, and the flow between them. Messages come from the desk's index (actions.js: data.query
// with one ask on a refusal, data.subscribe for changes, sync.js); acting on one runs the
// connector's command; writing is writing.js; the commands are commands.js. It talks only to
// ctx.bridge, ctx.commands, ctx.settings, ctx.surface and a view, so the SDK's test host runs it.

import { createActions } from "./actions.js";
import { registerCommands } from "./commands.js";
import { NO_ACCOUNT } from "./compose.js";
import {
  MAILBOXES,
  mailboxOf,
  merged,
  messageOf,
  move,
  queryFor,
  sourceKey,
  threadQuery,
  threadsOf,
} from "./model.js";
import { emptyText, navOf, readerOf, rowsOf } from "./present.js";
import { addressList, asArgs, asString, DEFAULTS, initialState } from "./state.js";
import { createSync } from "./sync.js";
import { createWriting } from "./writing.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("./model.js").Message} Message
 * @typedef {import("./compose.js").Draft} Draft
 * @typedef {import("./present.js").Row} Row
 * @typedef {import("./present.js").Nav} Nav
 * @typedef {import("./present.js").ReaderModel} ReaderModel
 * @typedef {{
 *   nav(nav: Nav): void,
 *   list(rows: Row[], selected: string | null, state: { more: boolean, loading: boolean, empty: string }): void,
 *   reader(model: ReaderModel | null): void,
 *   composer(draft: Draft | null, problems: string[]): void,
 *   status(text: string): void,
 *   focus(where: "list" | "reader" | "composer"): void,
 * }} View
 */

const VIEW_KEY = "view";
const DRAFTS_KEY = "drafts";
const ANSWERS_KEY = "answers";

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings" | "surface">} ctx
 * @param {View} view
 * @param {{ now?: () => number, recountMs?: number }} [options]
 */
export function createMail({ bridge, commands, settings, surface }, view, options = {}) {
  const now = options.now ?? (() => Date.now());
  const s = initialState(now());
  const actions = createActions({ bridge, commands });
  let said = "";
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let recount;

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const store = (/** @type {string} */ key, /** @type {unknown} */ value) =>
    bridge.call("store.set", { key, value }).catch(() => {});
  const saveView = () =>
    store(VIEW_KEY, { mailbox: s.mailboxId, account: s.account, selected: s.selected });
  const mailbox = () => mailboxOf(s.mailboxId) ?? MAILBOXES[0];

  const nav = () => view.nav(navOf(s));
  const render = () => {
    const rows = rowsOf(s);
    if (s.selected !== null && !rows.some((row) => row.id === s.selected)) s.selected = null;
    view.list(rows, s.selected, {
      more: s.cursor !== undefined,
      loading: s.loading,
      empty: emptyText(s),
    });
  };
  const showReader = () => view.reader(readerOf(s, now));
  const changed = () => {
    render();
    showReader();
    clearTimeout(recount);
    recount = setTimeout(() => void countUnread(), options.recountMs ?? 250);
  };

  /** Fill the mailbox from the index: the first page, or the next one with `more`. */
  const load = async (more = false) => {
    if (!mailbox().live) {
      s.messages = [];
      s.cursor = undefined;
      s.threads = [];
      render();
      return true;
    }
    s.loading = true;
    render();
    try {
      const query = queryFor(mailbox(), {
        text: s.search,
        account: s.account ?? undefined,
        page: s.page,
        ...(more && s.cursor ? { cursor: s.cursor } : {}),
      });
      const result = await actions.query(query);
      const items = /** @type {MessageItem[]} */ (result.items.filter((i) => i.kind === "message"));
      s.messages = merged(more ? s.messages : [], items);
      s.cursor = result.cursor;
      s.threads = threadsOf(s.messages);
      say("");
      return true;
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      s.loading = false;
      render();
    }
  };

  /** How many unread messages the inbox holds, as the navigation shows it ("500+" past a page). */
  const countUnread = async () => {
    const inbox = mailboxOf("inbox") ?? MAILBOXES[0];
    try {
      const result = await actions.query({
        kinds: ["message"],
        ...(s.account ? { sources: [s.account] } : {}),
        where: [{ field: "unread", op: "eq", value: true }, ...inbox.where],
        limit: 500,
      });
      const n = result.items.length;
      s.unread = n === 0 ? "" : result.cursor ? "500+" : String(n);
    } catch {
      s.unread = "";
    }
    nav();
  };

  const sync = createSync({ state: s, actions, bridge, say, changed });

  /** Show one message: the thread's earlier messages, the connector's actions, the invitation. */
  const show = async (/** @type {Message} */ message) => {
    s.open = message;
    s.earlier = s.messages.filter((m) => m.thread === message.thread && m.key !== message.key);
    s.available = [];
    showReader();
    const [available, rest] = await Promise.all([
      actions.available(message.source.connector).catch(() => []),
      actions
        .query(threadQuery(message.thread, sourceKey(message.source)))
        .then((r) => /** @type {MessageItem[]} */ (r.items.filter((i) => i.kind === "message")))
        .catch(() => []),
    ]);
    if (s.open?.key !== message.key) return;
    s.available = available;
    s.earlier = merged(s.earlier, rest).filter((m) => m.key !== message.key);
    showReader();
    if (message.unread && s.conf.markRead === "open")
      await sync.setFlags(message, { unread: false }).catch(() => {});
  };

  const select = (/** @type {string | null} */ id) => {
    s.selected = id;
    render();
    void saveView();
  };
  /** Enter or a click: a thread opens its latest message, a draft opens in the composer. */
  const activate = async (/** @type {string} */ id) => {
    if (id.startsWith("draft:")) {
      writing.openDraft(id.slice("draft:".length));
      view.focus("composer");
      return;
    }
    const thread = s.threads.find((t) => t.id === id);
    if (!thread) return;
    await show(thread.latest);
    view.focus("reader");
  };
  /** A key pressed on the list; resolves whether the list used it. */
  const key = async (/** @type {string} */ name) => {
    if (name === "Enter") {
      if (s.selected !== null) await activate(s.selected);
      return s.selected !== null;
    }
    const next = move(
      rowsOf(s).map((r) => ({ id: r.id })),
      s.selected,
      name,
    );
    if (next === undefined) return false;
    select(next);
    return true;
  };

  const setMailbox = async (/** @type {string} */ id) => {
    const box = mailboxOf(id);
    if (!box) throw new Error(`${id} is not a mailbox.`);
    s.mailboxId = box.id;
    s.selected = null;
    nav();
    void saveView();
    await load();
    return s.mailboxId;
  };
  const setAccount = async (/** @type {string | null} */ account) => {
    if (account !== null && !s.accounts.includes(account))
      throw new Error(`${account} is not a connected account.`);
    s.account = account;
    nav();
    void saveView();
    await Promise.all([load(), countUnread()]);
  };
  const setSearch = async (/** @type {string} */ text) => {
    s.search = text.trim();
    nav();
    await load();
    return s.search;
  };
  const refresh = async () => {
    s.accounts = await actions.accounts();
    nav();
    await Promise.all([load(), countUnread()]);
    if (s.open) await show(s.open);
    if (s.accounts.length === 0) say(NO_ACCOUNT);
  };
  /** The message a command names (`{ source, id }`, from an agent), or the open one. */
  const named = async (/** @type {Record<string, unknown>} */ a) => {
    const source = /** @type {{ connector?: unknown, instance?: unknown }} */ (a.source ?? {});
    const id = asString(a.id);
    if (!id || typeof source.connector !== "string" || typeof source.instance !== "string") {
      if (!s.open) throw new Error("Open a message first.");
      return s.open;
    }
    const key = `${source.connector}/${source.instance}#${id}`;
    const here =
      s.messages.find((m) => m.key === key) ?? (s.open?.key === key ? s.open : undefined);
    if (here) return here;
    const item = await actions.get({ connector: source.connector, instance: source.instance }, id);
    if (item?.kind !== "message") throw new Error(`There is no message ${id}.`);
    return messageOf(item);
  };

  const writing = createWriting({
    actions,
    view,
    say,
    conf: () => ({ signature: s.conf.signature, addresses: s.conf.addresses }),
    current: () => s.open,
    account: () => s.account ?? s.accounts[0],
    drafts: {
      all: () => s.drafts,
      put: (draft) => {
        s.drafts = [...s.drafts.filter((d) => d.id !== draft.id), draft];
        void store(DRAFTS_KEY, s.drafts);
      },
      remove: (id) => {
        s.drafts = s.drafts.filter((d) => d.id !== id);
        void store(DRAFTS_KEY, s.drafts);
      },
    },
    answers: {
      get: (k) => s.answers[k],
      set: (k, answer) => {
        s.answers = { ...s.answers, [k]: answer };
        void store(ANSWERS_KEY, s.answers);
      },
    },
    changed: () => {
      nav();
      render();
      showReader();
    },
    now,
  });

  const { command } = registerCommands({
    commands,
    surface,
    view,
    say,
    writing,
    app: {
      mailboxId: () => s.mailboxId,
      search: () => s.search,
      open: () => s.open,
      show,
      named,
      setMailbox,
      setSearch,
      refresh,
      pick: actions.pick,
      setFlags: sync.setFlags,
      moveTo: sync.moveTo,
    },
  });

  settings.onChange(({ key: name, value }) => {
    if (name === "notify" && typeof value === "boolean") s.conf.notify = value;
    if (name === "mark-read" && typeof value === "string") s.conf.markRead = value;
    if (name === "signature" && typeof value === "string") s.conf.signature = value;
    if (name === "addresses") s.conf.addresses = addressList(value);
    if (name === "page" && Number.isInteger(value) && Number(value) > 0) s.page = Number(value);
  });

  /** Read the settings and the saved state, show the mailbox, and follow the index. */
  const start = async () => {
    s.startedAt = now();
    const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
    const setting = async (/** @type {keyof typeof DEFAULTS} */ name) =>
      (await settings.get(name).catch(() => undefined)) ??
      /** @type {Record<string, unknown> | undefined} */ (init.settings)?.[`endue.mail.${name}`] ??
      DEFAULTS[name];
    const size = Number(await setting("page"));
    s.page = Number.isInteger(size) && size > 0 && size <= 500 ? size : DEFAULTS.page;
    s.conf = {
      notify: (await setting("notify")) !== false,
      markRead: asString(await setting("mark-read")) ?? DEFAULTS["mark-read"],
      signature: asString(await setting("signature")) ?? "",
      addresses: addressList(await setting("addresses")),
    };
    const read = async (/** @type {string} */ key) =>
      /** @type {{ value?: unknown }} */ (await bridge.call("store.get", { key }).catch(() => ({})))
        .value;
    const saved = asArgs(await read(VIEW_KEY));
    const drafts = await read(DRAFTS_KEY);
    s.drafts = /** @type {Draft[]} */ (
      (Array.isArray(drafts) ? drafts : []).filter(
        (d) => d && typeof d === "object" && typeof d.id === "string",
      )
    );
    s.answers = /** @type {typeof s.answers} */ (asArgs(await read(ANSWERS_KEY)));
    const box = mailboxOf(asString(saved.mailbox) ?? "");
    if (box) s.mailboxId = box.id;
    s.accounts = await actions.accounts();
    const chosen = asString(saved.account);
    s.account = chosen && s.accounts.includes(chosen) ? chosen : null;
    s.selected = asString(saved.selected) ?? null;
    nav();
    render();
    await Promise.all([load(), countUnread(), sync.follow()]);
    render();
  };

  return {
    start,
    select,
    activate,
    key,
    more: () => load(true),
    command,
    setMailbox,
    setAccount,
    setSearch,
    refresh,
    show,
    writing,
    /** The message the reader shows, for tests. */
    current: () => s.open,
  };
}
