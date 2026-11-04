// desk.universal's page: one universal view at a time, drawn by ctx.universal.open, with a notice
// that asks for the permission its source needs when the desk refused to read it.
import { scopeOf } from "./open.js";

/**
 * @typedef {import("./open.js").UniversalView} UniversalView
 * @typedef {import("../../../packages/plugin-sdk/src/index").PluginContext} PluginContext
 * @typedef {import("../../../packages/plugin-sdk/src/index").UniversalHandle} UniversalHandle
 * @typedef {{ readonly handle: UniversalHandle | undefined, readonly view: UniversalView | undefined,
 *   open(view: UniversalView): UniversalHandle, allow(): Promise<{ granted: boolean }>, close(): void }} Screen
 */

/**
 * @param {HTMLElement} host
 * @param {PluginContext} ctx
 * @returns {Screen}
 */
export function createScreen(host, ctx) {
  const doc = host.ownerDocument ?? document;
  const notice = doc.createElement("div");
  notice.setAttribute("class", "notice");
  notice.setAttribute("role", "alert");
  notice.hidden = true;
  const text = doc.createElement("span");
  const allow = doc.createElement("button");
  allow.setAttribute("type", "button");
  allow.textContent = "Allow";
  notice.append(text, allow);
  host.append(notice);
  /** @type {UniversalHandle | undefined} */
  let handle;
  /** @type {UniversalView | undefined} */
  let view;
  /** @type {import("../../../packages/bridge/src/index").Permission | undefined} */
  let needed;

  /** @param {unknown} error */
  const failed = (error) => {
    const refused = /** @type {{ code?: string, permission?: typeof needed }} */ (error ?? {});
    if (refused.code !== "permission_denied") return;
    needed = refused.permission ?? scopeOf(view?.source);
    text.textContent = "Desk needs your permission to read this view's source.";
    notice.hidden = false;
  };

  /** @type {Screen} */
  const screen = {
    get handle() {
      return handle;
    },
    get view() {
      return view;
    },
    open(next) {
      handle?.close();
      view = next;
      needed = undefined;
      notice.hidden = true;
      handle = ctx.universal.open(host, next, { onError: failed });
      return handle;
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
    close() {
      handle?.close();
      handle = undefined;
      view = undefined;
      notice.hidden = true;
    },
  };
  allow.addEventListener("click", () => void screen.allow());
  return screen;
}
