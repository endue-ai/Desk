// desk.universal's page: one universal view at a time, drawn by ctx.universal.open, under the bar
// (bar.js) that shows what Eris is drafting, the preview's choices and the notice after Apply, with
// a notice that asks for the permission its source needs when the desk refused to read it. A view
// opened again by the id it is drawn under keeps its element and data: Apply never redraws. A source
// that fails says why in words (words.js); a calendar paged to another day moves the clock its
// queries read (clock.js).
import { createBar } from "./bar.js";
import { createClock, readsClock } from "./clock.js";
import { scopeOf } from "./open.js";
import { failureText } from "./words.js";

/**
 * @typedef {import("./open.js").UniversalView} UniversalView
 * @typedef {import("../../../packages/bridge/src/index").UniversalPage} UniversalPage
 * @typedef {import("./bar.js").Choice} Choice
 * @typedef {import("./bar.js").Notice} Notice
 * @typedef {import("../../../packages/plugin-sdk/src/index").PluginContext} PluginContext
 * @typedef {import("../../../packages/plugin-sdk/src/index").UniversalHandle} UniversalHandle
 * @typedef {{ readonly handle: UniversalHandle | undefined,
 *   readonly view: UniversalView | UniversalPage | undefined,
 *   readonly bar: ReturnType<typeof createBar>,
 *   open(view: UniversalView | UniversalPage,
 *     options?: { notice?: Notice, params?: Record<string, unknown> }): UniversalHandle,
 *   drafting(note: string): void, preview(view: UniversalView, note: string): Promise<Choice>,
 *   allow(): Promise<{ granted: boolean }>, close(id?: string): boolean }} Screen
 */

/**
 * JSON with every object's keys in order: the same view read back from YAML compares equal.
 * @param {unknown} value
 * @returns {string}
 */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(/** @type {any} */ (value)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/**
 * @param {HTMLElement} host
 * @param {PluginContext} ctx
 * @param {{ now?: () => number }} [options] the live clock, Date.now by default
 * @returns {Screen}
 */
export function createScreen(host, ctx, options = {}) {
  const doc = host.ownerDocument ?? document;
  const notice = doc.createElement("div");
  notice.setAttribute("class", "notice");
  notice.setAttribute("role", "alert");
  notice.hidden = true;
  const text = doc.createElement("span");
  const el = (/** @type {string} */ tag, /** @type {Record<string, string>} */ attrs) => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };
  const allow = el("button", { class: "desk-btn", type: "button" });
  allow.textContent = "Allow";
  notice.append(text, allow);
  const bar = createBar(doc, (action) => {
    const args = action.args && typeof action.args === "object" ? action.args : {};
    void ctx.commands.run(action.command, /** @type {Record<string, unknown>} */ (args));
  });
  // What shows while Eris drafts and nothing is drawn yet: rows of the shape to come.
  const ghost = doc.createElement("div");
  ghost.className = "ghost";
  ghost.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 4; i++) ghost.append(doc.createElement("span"));
  ghost.hidden = true;
  host.append(notice, bar.element, ghost);
  /** @type {UniversalHandle | undefined} */
  let handle;
  /** @type {UniversalView | undefined} */
  let view;
  /** @type {import("../../../packages/bridge/src/index").Permission | undefined} */
  let needed;
  /** The params the drawn view was opened with. @type {Record<string, unknown>} */
  let params = {};
  const clock = createClock(options.now);

  /** The drawn views, each with the source it reads: the view, or a page's sections in order. */
  const drawn = () => {
    if (!handle || !view) return [];
    if (!("sections" in view)) return [{ element: handle.element, source: view.source }];
    const { sections } = view;
    const elements = [...handle.element.querySelectorAll(":scope > desk-universal-view")];
    return elements.map((element, i) => ({ element, source: sections[i]?.source }));
  };
  /** @param {unknown} error */
  const failed = (error) => {
    const refused = /** @type {{ code?: string, permission?: typeof needed }} */ (error ?? {});
    if (refused.code !== "permission_denied") {
      // The view shows the load's own message: say it in words instead.
      const raw = error instanceof Error ? error.message : undefined;
      for (const { element, source } of drawn())
        if (raw !== undefined && element.getAttribute("message") === raw)
          element.setAttribute("message", failureText(error, source));
      return;
    }
    needed = refused.permission ?? scopeOf(view?.source);
    text.textContent = "Desk needs your permission to read this view's source.";
    notice.hidden = false;
  };
  const settled = () => {
    host.removeAttribute("data-drafting");
    ghost.hidden = true;
  };

  /** @type {Screen} */
  const screen = {
    get handle() {
      return handle;
    },
    get view() {
      return view;
    },
    bar,
    open(next, options = {}) {
      settled();
      const same =
        view !== undefined &&
        (next === view || canonical(next) === canonical(view)) &&
        canonical(options.params ?? {}) === canonical(params);
      if (handle && same) {
        if (options.notice) bar.notice(options.notice);
        else bar.hide();
        return handle;
      }
      handle?.close();
      view = next;
      params = options.params ?? {};
      needed = undefined;
      notice.hidden = true;
      clock.reset();
      handle = ctx.universal.open(host, next, { onError: failed, params, now: clock.now });
      if (options.notice) bar.notice(options.notice);
      else bar.hide();
      return handle;
    },
    drafting(note) {
      host.setAttribute("data-drafting", "");
      ghost.hidden = handle !== undefined;
      bar.drafting(note);
    },
    preview(next, note) {
      screen.open(next);
      return bar.preview(note);
    },
    async allow() {
      const permission = needed ?? scopeOf(view?.source);
      if (!permission) return { granted: false };
      const answer = await ctx.perm.request(permission, "Show the entries of this universal view");
      if (answer.granted) {
        notice.hidden = true;
        needed = undefined;
        await handle?.reload();
      }
      return { granted: answer.granted };
    },
    close(id) {
      if (id !== undefined && view?.id !== id) return false;
      settled();
      handle?.close();
      handle = undefined;
      view = undefined;
      notice.hidden = true;
      bar.hide();
      return true;
    },
  };
  allow.addEventListener("click", () => void screen.allow());
  // A calendar paged to another day: the queries of its view (or page) read that day's clock.
  host.addEventListener("desk-range", (event) => {
    const { anchor } = /** @type {CustomEvent<{ anchor?: string }>} */ (event).detail ?? {};
    if (!handle || !readsClock(view) || !clock.move(String(anchor))) return;
    void handle.reload();
  });
  return screen;
}
