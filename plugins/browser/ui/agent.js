// What the desk's assistant does in the Browser (ADR 0270): read the page, scroll it, click,
// type, press a key, choose from a list, and step through the history. Each is a command of the
// manifest's; each answers the page as it reads afterwards, so one call both acts and shows what
// came of it. The page is read and acted in through web.read and web.act under web:control,
// asked for once: showing a page (web:browse) does not let this plugin see it.

const SCOPE = { permission: "web:control" };
const WHY = "To read and operate the web page for you";

/** How many characters of a page one answer holds: what the desk's brains take in one result. */
export const CHARS = 4000;
const MOST_CHARS = 20000;

/** The bridge's error code of a failed call. */
const codeOf = (error) => (error && typeof error === "object" ? error.code : undefined);

/**
 * @typedef {{ x: number, y: number, width: number, height: number, pageWidth: number,
 *   pageHeight: number }} Scrolled
 * @typedef {{ url: string, title: string, text: string, from: number, length: number,
 *   scroll: Scrolled }} Page
 * @typedef {{
 *   call(method: string, params: object): Promise<any>,
 *   ask(permission: object, reason: string): Promise<{ granted: boolean }>,
 * }} Desk
 * @typedef {{
 *   view(): string | undefined,
 *   shown(): { url: string, title: string },
 *   settled(quiet?: number, most?: number): Promise<void>,
 *   go(typed: string): Promise<void>,
 *   back(): void, forward(): void, reload(): void, stop(): void,
 * }} Browser
 */

/**
 * @param {Desk} desk
 * @param {Browser} browser
 * @param {{ quiet: number, most: number }} [rest] how long a page is given to settle, in ms
 */
export function createAgent(desk, browser, rest = { quiet: 500, most: 10000 }) {
  const settled = () => browser.settled(rest.quiet, rest.most);

  /** A call that needs web:control: asked for once when the plugin does not hold it yet. */
  async function allowed(method, params, ask = true) {
    try {
      return await desk.call(method, params);
    } catch (error) {
      if (codeOf(error) !== "permission_denied" || !ask) throw error;
      const asked = await desk.ask(SCOPE, WHY);
      if (!asked.granted)
        throw new Error("The person did not allow the Browser to read and operate web pages.");
      return desk.call(method, params);
    }
  }

  function viewId() {
    const view = browser.view();
    if (view === undefined)
      throw new Error("The Browser shows no page. Go to an address first (endue.browser.go).");
    return view;
  }

  /**
   * The page as the assistant reads it; `more` is where to read on when the text goes on.
   * @param {{ from?: number, chars?: number }} [args]
   */
  async function read(args, ask = true) {
    const max = Math.min(Math.max(Math.trunc(args?.chars ?? CHARS), 1), MOST_CHARS);
    const from = Math.max(Math.trunc(args?.from ?? 0), 0);
    /** @type {Page & { more?: number, moved?: boolean }} */
    const page = await allowed("web.read", { viewId: viewId(), from, max, scope: SCOPE }, ask);
    const end = page.from + Array.from(page.text).length;
    return end < page.length ? { ...page, more: end } : page;
  }

  /** Do `action` in the page, let it settle, and answer the page as it reads now. */
  async function act(action) {
    const done = await allowed("web.act", { viewId: viewId(), action, scope: SCOPE });
    await settled();
    const page = await read();
    return done?.moved === undefined ? page : { ...page, moved: done.moved };
  }

  /**
   * The page a load or a step of the history led to. These are the person's commands too, and
   * theirs asks for nothing: a plugin that may not read pages yet answers the page's address
   * and title, and endue.browser.read asks.
   */
  async function arrived() {
    await settled();
    try {
      return await read(undefined, false);
    } catch (error) {
      if (browser.view() !== undefined && codeOf(error) !== "permission_denied") throw error;
      return browser.shown();
    }
  }

  const step = (to) => {
    to();
    return arrived();
  };

  /** Only what `args` names: an absent argument is left out, not sent as nothing. */
  const named = (args, keys) =>
    Object.fromEntries(keys.filter((k) => args?.[k] != null).map((k) => [k, args[k]]));

  return {
    async go(args) {
      await browser.go(args?.url);
      return arrived();
    },
    read,
    back: () => step(browser.back),
    forward: () => step(browser.forward),
    reload: () => step(browser.reload),
    scroll: (args) =>
      act(
        args?.ref
          ? { do: "show", ref: args.ref }
          : { do: "scroll", to: args?.to ?? "down", ...named(args, ["pages"]) },
      ),
    click: (args) => act({ do: "press", ref: args?.ref }),
    type: (args) =>
      act({
        do: "type",
        text: String(args?.text ?? ""),
        ...named(args, ["ref", "replace", "submit"]),
      }),
    key: (args) => act({ do: "key", key: args?.key, ...named(args, ["ref"]) }),
    select: (args) => act({ do: "choose", ref: args?.ref, option: args?.option }),
  };
}
