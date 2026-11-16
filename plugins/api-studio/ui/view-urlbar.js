// The line at the top of a request: its method (a coloured menu that also takes a custom one),
// the URL with its {{variables}}, Send (Cancel while it runs) and Save. Pasting a curl command
// into the URL turns it into the whole request.

import { button, h, icon, keys } from "./dom.js";
import { ask, showMenu } from "./menu.js";
import { METHODS, methodClass } from "./model.js";
import { paramsFromUrl } from "./url.js";
import { varField } from "./var-field.js";

/**
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./studio.js").Studio} Studio
 */

/** @param {Studio} S @param {Tab} tab */
export function urlBar(S, tab) {
  const method = h("button.desk-btn.as-method", {
    type: "button",
    "aria-label": "Method",
    "aria-haspopup": "menu",
  });
  const drawMethod = () => {
    method.className = `desk-btn as-method m-${methodClass(tab.req.method)}`;
    method.replaceChildren(h("span", null, tab.req.method), icon("chevronDown", 14));
  };
  const setMethod = (/** @type {string} */ m) => {
    tab.req.method = m;
    drawMethod();
    S.app.emit("req", { field: "method" });
  };
  method.addEventListener("click", () =>
    showMenu(
      [
        ...METHODS.map((m) => ({
          label: m,
          className: `m-${methodClass(m)} as-menu-method`,
          checked: tab.req.method === m,
          run: () => setMethod(m),
        })),
        "-",
        {
          label: "Custom method…",
          icon: /** @type {const} */ ("edit"),
          run: async () => {
            const custom = await ask("Custom method", "Method name", tab.req.method, "Use");
            if (custom && /^[A-Za-z][A-Za-z-]*$/.test(custom)) setMethod(custom.toUpperCase());
          },
        },
      ],
      method,
      { width: 170 },
    ),
  );
  drawMethod();

  const url = varField({
    value: tab.req.url,
    label: "URL",
    placeholder: "Enter a URL or paste a curl command",
    scopes: () => S.scopes(tab),
    className: "as-url",
    onChange: (value) => {
      if (/^\s*curl\s/.test(value) && S.importCurl(tab, value)) return;
      tab.req.url = value;
      tab.req.params = paramsFromUrl(value, tab.req.params);
      S.app.emit("url", { from: "bar" });
      S.app.emit("req", { field: "url" });
    },
    onEnter: (event) => {
      event.preventDefault();
      S.send(tab);
    },
  });

  const send = h("button.desk-btn.desk-btn-primary.as-send", {
    type: "button",
    title: `Send (${keys("Mod+Enter")})`,
  });
  const drawSend = () => {
    const running = !!tab.running;
    send.classList.toggle("is-running", running);
    send.replaceChildren(
      running ? h("span.as-spin") : icon("send", 15),
      h("span.label", null, running ? "Cancel" : "Send"),
    );
  };
  send.addEventListener("click", () => (tab.running ? S.cancel(tab) : S.send(tab)));
  drawSend();

  const save = button({
    label: "Save",
    icon: "download",
    kind: "as-save",
    title: `Save (${keys("Mod+S")})`,
    onClick: () => S.save(tab),
  });
  const more = button({
    label: "More",
    icon: "more",
    hideLabel: true,
    kind: "as-more",
    onClick: () =>
      showMenu(
        [
          { label: "Copy as curl", icon: "copy", run: () => S.copyCurl(tab) },
          { label: "Generate code…", icon: "code", run: () => S.showCode?.(tab) },
          "-",
          { label: "Duplicate in a new tab", icon: "plus", run: () => S.duplicate(tab) },
          { label: "Rename…", icon: "edit", run: () => S.rename(tab) },
        ],
        more,
        { width: 210 },
      ),
  });

  const el = h("div.as-urlbar", null, h("div.as-urlbox", null, method, url.el), send, save, more);
  return {
    el,
    focus: () => url.focus(),
    /** The URL changed from the Params table. */
    syncUrl: () => url.set(tab.req.url),
    redraw: () => {
      url.redraw();
      drawMethod();
      drawSend();
    },
    drawSend,
  };
}
