// The Browser's behaviour: one web view under the toolbar (web.*, ADR 0216), which the desk draws
// over this page's #page at the box the view reports. This page never sees the web page: it asks
// for an address and hears what the view shows. view.js holds the DOM, main.js the SDK.
import { addressOf, SEARCH } from "./address.js";

/** The manifest's defaults, for a setting nobody set. */
const DEFAULTS = { home: "https://endue.ai/", search: SEARCH };

const SCOPE = { permission: "web:browse" };
const WHY = "To show web pages";

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Box
 * @typedef {{ url: string, title: string, loading: boolean, canGoBack: boolean, canGoForward: boolean,
 *   viewId: string, refused?: string, closed?: boolean }} Shown
 * @typedef {{
 *   call(method: string, params: object): Promise<any>,
 *   onEvent(listener: (event: { event: string, data: any }) => void): () => void,
 *   ask(permission: object, reason: string): Promise<{ granted: boolean }>,
 *   setting(key: string): Promise<unknown>,
 *   restored: unknown,
 * }} Desk
 * @typedef {{
 *   shows(state: { url: string, loading: boolean, canGoBack: boolean, canGoForward: boolean }): void,
 *   note(text: string): void,
 *   box(): Box,
 * }} View
 */

/** The bridge's error code of a failed call. */
const codeOf = (error) => (error && typeof error === "object" ? error.code : undefined);

/**
 * @param {Desk} desk
 * @param {View} view
 */
export function createBrowser(desk, view) {
  /** @type {string | undefined} */
  let viewId;
  /** The address the window shows, kept over a sleep. */
  let url = "";
  let search;
  /** The box last told to the desk, so a look that changed nothing asks nothing. */
  let placed = "";

  const idle = { url: "", loading: false, canGoBack: false, canGoForward: false };

  /** A call that needs web:browse: asked for once when the plugin does not hold it yet. */
  async function allowed(method, params) {
    try {
      return await desk.call(method, params);
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw error;
      const asked = await desk.ask(SCOPE, WHY);
      if (!asked.granted) throw error;
      return desk.call(method, params);
    }
  }

  function failed(error) {
    const code = codeOf(error);
    if (code === "permission_denied")
      view.note("The Browser may not show web pages. Allow it to try again.");
    else if (code === "unsupported")
      view.note("A web page shows in the desk only. Dock this window to browse here.");
    else {
      const why = error instanceof Error ? error.message : String(code ?? error);
      view.note(`The page could not be opened (${why}).`);
    }
  }

  /** Tell the desk where the page lies, when that changed. */
  async function place() {
    if (viewId === undefined) return;
    const box = view.box();
    const told = `${viewId} ${box.x} ${box.y} ${box.width} ${box.height}`;
    if (told === placed) return;
    placed = told;
    await desk.call("web.place", { viewId, ...box }).catch(() => {});
  }

  /** Loads run one at a time: a second one waits for the view the first one opens. */
  let turn = Promise.resolve();

  /** Show `address`: in the view there is, or in a new one. */
  function load(address) {
    const mine = turn.then(() => show(address));
    turn = mine.catch(() => {});
    return mine;
  }

  async function show(address) {
    url = address;
    view.note("");
    view.shows({ ...idle, url: address, loading: true });
    try {
      if (viewId === undefined) {
        const opened = await allowed("web.open", { url: address, scope: SCOPE });
        viewId = opened.viewId;
        placed = "";
        await place();
      } else {
        await allowed("web.load", { viewId, url: address, scope: SCOPE });
      }
      // The page takes the keys: what is typed next goes to it.
      await desk.call("web.focus", { viewId }).catch(() => {});
    } catch (error) {
      view.shows({ ...idle, url: address });
      failed(error);
    }
  }

  const step = (to) => {
    if (viewId !== undefined) void desk.call("web.go", { viewId, to }).catch(() => {});
  };

  /** @param {Shown} shown */
  function changed(shown) {
    if (shown.viewId !== viewId) return;
    if (shown.closed) {
      viewId = undefined;
      placed = "";
      view.shows({ ...idle, url });
      return;
    }
    if (shown.url !== "") url = shown.url;
    view.shows({ ...shown, url });
    if (shown.refused) view.note(`The Browser may not go to ${shown.refused}.`);
  }

  return {
    /** Open on the address kept over a sleep, else on the home page. */
    async start() {
      desk.onEvent((event) => {
        if (event.event === "web.changed") changed(event.data);
      });
      // A setting the person set, then init.yaml's, then the manifest's default (ADR 0031).
      const init = await desk.call("init.get", {}).catch(() => ({ settings: {} }));
      const setting = async (name) =>
        (await desk.setting(name).catch(() => undefined)) ??
        init.settings?.[`endue.browser.${name}`] ??
        DEFAULTS[name];
      search = await setting("search");
      const kept = /** @type {{ url?: unknown } | undefined} */ (desk.restored)?.url;
      const home = await setting("home");
      const first = typeof kept === "string" && kept !== "" ? kept : home;
      const address = typeof first === "string" ? addressOf(first, searching()) : undefined;
      if (address) await load(address);
      else view.shows(idle);
    },
    /** What the person typed and entered. */
    go(typed) {
      const address = addressOf(String(typed ?? ""), searching());
      return address ? load(address) : Promise.resolve();
    },
    back: () => step("back"),
    forward: () => step("forward"),
    reload: () => (viewId === undefined && url !== "" ? void load(url) : step("reload")),
    stop: () => step("stop"),
    place,
    /** What a sleep keeps: the address. */
    kept: () => ({ url }),
    /** The window goes: so does its view. */
    close() {
      if (viewId !== undefined) void desk.call("web.close", { viewId }).catch(() => {});
      viewId = undefined;
    },
  };

  function searching() {
    return typeof search === "string" && search !== "" ? search : undefined;
  }
}
