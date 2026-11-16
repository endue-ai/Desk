// The Settings section: how this one request is sent. Redirects, TLS checks, the timeout, the
// HTTP version, compression, URL encoding and the cookie jar.

import { h } from "./dom.js";
import { defaultSettings } from "./model.js";
import { addSections } from "./view-request.js";

/** @typedef {import("./studio.js").Studio} Studio @typedef {import("./app.js").Tab} Tab */

/** @param {Studio} S @param {Tab} tab */
function drawSettings(S, tab) {
  const s = tab.req.settings;
  const changed = () => S.app.emit("req", { field: "settings" });
  /** @param {keyof typeof s} key @param {string} title @param {string} text */
  const toggle = (key, title, text) => {
    const input = /** @type {HTMLInputElement} */ (
      h("input.desk-check", { type: "checkbox", checked: s[key] === true })
    );
    input.addEventListener("change", () => {
      /** @type {any} */ (s)[key] = input.checked;
      changed();
    });
    return h(
      "label.as-setting",
      null,
      h("span.as-setting-text", null, h("strong", null, title), h("span", null, text)),
      input,
    );
  };
  /** @param {"maxRedirects" | "timeoutMs"} key @param {string} title @param {string} text @param {number} min @param {number} max */
  const number = (key, title, text, min, max) => {
    const input = /** @type {HTMLInputElement} */ (
      h("input.desk-field.as-number", {
        type: "number",
        min,
        max,
        value: String(key === "timeoutMs" ? s.timeoutMs : s.maxRedirects),
        "aria-label": title,
      })
    );
    input.addEventListener("input", () => {
      const n = Math.max(min, Math.min(max, Math.round(Number(input.value) || 0)));
      s[key] = n;
      changed();
    });
    return h(
      "label.as-setting",
      null,
      h("span.as-setting-text", null, h("strong", null, title), h("span", null, text)),
      input,
    );
  };
  const version = h(
    "select.desk-field",
    {
      "aria-label": "HTTP version",
      onChange: (/** @type {Event} */ e) => {
        s.httpVersion = /** @type {any} */ (/** @type {HTMLSelectElement} */ (e.target).value);
        changed();
      },
    },
    ...[
      ["auto", "Automatic"],
      ["1.1", "HTTP/1.1"],
      ["2", "HTTP/2"],
      ["3", "HTTP/3 (where curl has it)"],
    ].map(([v, label]) => h("option", { value: v, selected: s.httpVersion === v }, label)),
  );
  const reset = h(
    "button.desk-btn.desk-btn-quiet",
    {
      type: "button",
      onClick: () => {
        tab.req.settings = defaultSettings();
        changed();
        root.replaceWith(drawSettings(S, tab).el);
      },
    },
    "Reset to defaults",
  );
  const root = h(
    "div.as-section.as-settings",
    null,
    toggle(
      "followRedirects",
      "Follow redirects",
      "Go where a 3xx answer points, and show each hop.",
    ),
    number("maxRedirects", "Most redirects", "Stop after this many hops.", 0, 50),
    toggle(
      "verifyTls",
      "Check TLS certificates",
      "Refuse servers whose certificate the system does not trust.",
    ),
    number(
      "timeoutMs",
      "Timeout (ms)",
      "Give up after this long; 0 waits as long as it takes.",
      0,
      600000,
    ),
    h(
      "label.as-setting",
      null,
      h(
        "span.as-setting-text",
        null,
        h("strong", null, "HTTP version"),
        h("span", null, "Which version to ask the server for."),
      ),
      version,
    ),
    toggle(
      "decompress",
      "Accept compressed answers",
      "Ask for gzip, deflate or brotli and unpack the body.",
    ),
    toggle("encodeUrl", "Encode the URL", "Percent-encode query values when sending."),
    toggle(
      "cookies",
      "Use the cookie jar",
      "Send the cookies servers set, and keep the ones they set now.",
    ),
    h("div.as-setting-foot", null, reset),
  );
  return { el: root };
}

addSections([{ id: "settings", label: "Settings", draw: drawSettings }]);
