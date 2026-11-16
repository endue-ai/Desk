// The parts of sending that keep state between requests: OAuth 2.0 tokens (fetched on demand and
// before a send when they run out), the cookie jar, a pasted curl command turned into the request,
// and the Settings dialog with curl's path, the history and the jar.

import { SEND_HOOKS } from "./actions.js";
import { createJar } from "./cookies.js";
import { fromCurl } from "./curl-import.js";
import { button, h, icon } from "./dom.js";
import { ago } from "./format.js";
import { dialog } from "./menu.js";
import { clone } from "./model.js";
import { createTokens } from "./oauth.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 */

export const SETTING_CURL = "endue.api-studio.curl";
export const SETTING_HISTORY = "endue.api-studio.history";

/** @param {Studio} S */
export function installAuth(S) {
  const tokens = createTokens(S);
  S.tokens = tokens;
  const jar = createJar({
    load: async () =>
      (await S.ctx.bridge.call("store.get", { key: "cookies" }).catch(() => undefined))?.value,
    save: (list) =>
      void S.ctx.bridge.call("store.set", { key: "cookies", value: list }).catch(() => {}),
  });
  S.jar = jar;

  S.fetchToken = async (/** @type {Tab} */ tab) => {
    try {
      const held = await tokens.fetchToken(tab);
      S.app.toast(
        held.expires
          ? `Got a token for ${Math.round((held.expires - Date.now()) / 60000)} min`
          : "Got a token",
        "ok",
      );
    } catch (error) {
      S.app.toast(`No token: ${String(/** @type {any} */ (error)?.message ?? error)}`, "error");
    }
  };

  SEND_HOOKS.unshift({
    async before(_S, tab) {
      try {
        await tokens.ensure(tab);
      } catch (error) {
        S.app.toast(
          `Could not refresh the token: ${String(/** @type {any} */ (error)?.message ?? error)}`,
          "error",
        );
      }
    },
    after(_S, tab, res) {
      if (res.status && tab.req.settings.cookies) jar.take(res.sent.url, res.headers);
    },
  });

  /** Turn a pasted curl command into the tab's request. @param {Tab} tab @param {string} text */
  S.importCurl = (tab, text) => {
    const parsed = fromCurl(text);
    if (!parsed) return false;
    const { req } = parsed;
    const keep = tab.ref ? { id: tab.req.id, name: tab.req.name, seq: tab.req.seq } : {};
    tab.req = { ...clone(req), ...keep };
    S.app.emit("tab");
    S.app.emit("req", { field: "url" });
    S.app.toast(
      parsed.ignored.length
        ? `Imported; left out ${parsed.ignored.join(" ")}`
        : "Imported the curl command",
      "ok",
    );
    return true;
  };

  /** Ask for a curl command and open it as a new request. */
  S.pasteCurl = async () => {
    const area = /** @type {HTMLTextAreaElement} */ (
      h("textarea.desk-field.as-paste", {
        "aria-label": "curl command",
        placeholder:
          "curl -X POST https://api.example.com/v1/items \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"lamp\"}'",
        spellcheck: "false",
      })
    );
    const text = await dialog({
      title: "Import a curl command",
      className: "is-wide",
      body: [
        h(
          "p.as-dialog-text",
          null,
          "Paste a command copied from a terminal, a browser's network panel or API docs.",
        ),
        area,
      ],
      actions: [
        { label: "Cancel", value: () => undefined },
        { label: "Import", kind: "desk-btn-primary", value: () => area.value },
      ],
      focus: "textarea",
    });
    if (!text) return;
    const parsed = fromCurl(text);
    if (!parsed) {
      S.app.toast("That is not a curl command with a URL.", "error");
      return;
    }
    S.app.open(parsed.req);
  };
  const imports = S.importMenu;
  S.importMenu = () => [
    ...(imports?.() ?? []),
    "-",
    { label: "Import a curl command…", icon: "import", run: () => S.pasteCurl() },
  ];
  const home = S.homeActions;
  S.homeActions = () => [
    ...home(),
    {
      icon: "import",
      label: "Import curl",
      text: "Paste a command, get a request",
      run: () => S.pasteCurl(),
    },
  ];

  /** The jar's cookies, by domain, each removable. */
  S.showCookies = async () => {
    const box = h("div.as-jar");
    const draw = () => {
      const all = jar.all;
      const domains = [...new Set(all.map((c) => c.domain))].sort();
      box.replaceChildren(
        ...(domains.length
          ? domains.map((d) =>
              h(
                "div.as-jar-domain",
                null,
                h(
                  "div.as-jar-head",
                  null,
                  icon("globe", 14),
                  h("strong", null, d),
                  button({
                    label: `Remove ${d}'s cookies`,
                    icon: "trash",
                    hideLabel: true,
                    onClick: () => {
                      jar.clear({ domain: d });
                      draw();
                    },
                  }),
                ),
                ...all
                  .filter((c) => c.domain === d)
                  .map((c) =>
                    h(
                      "div.as-jar-row",
                      null,
                      h("code", null, c.name),
                      h("span.as-jar-value", { title: c.value }, c.value),
                      h(
                        "span.as-hint",
                        null,
                        c.expires ? `ends ${new Date(c.expires).toLocaleString()}` : "session",
                      ),
                      button({
                        label: `Remove ${c.name}`,
                        icon: "x",
                        hideLabel: true,
                        onClick: () => {
                          jar.clear({ domain: d, name: c.name });
                          draw();
                        },
                      }),
                    ),
                  ),
              ),
            )
          : [
              h(
                "p.as-hint",
                null,
                "The jar is empty. Cookies servers set are kept here and sent back to them.",
              ),
            ]),
      );
    };
    draw();
    await dialog({
      title: "Cookies",
      className: "is-wide",
      body: box,
      actions: [{ label: "Done", kind: "desk-btn-primary", value: () => true }],
    });
  };

  S.openSettings = async () => {
    const curl = /** @type {HTMLInputElement} */ (
      h("input.desk-field.as-dialog-input", {
        type: "text",
        value: S.settings.curl,
        placeholder: "curl (found on PATH)",
        "aria-label": "curl's path",
      })
    );
    const history = /** @type {HTMLInputElement} */ (
      h("input.desk-check", { type: "checkbox", checked: S.settings.history })
    );
    const version = h("span.as-hint", null, "Checking curl…");
    void S.engine.version().then((v) => {
      version.textContent = v ?? "curl did not answer: check its path.";
    });
    const row = (
      /** @type {string} */ title,
      /** @type {string} */ text,
      /** @type {Node} */ control,
    ) =>
      h(
        "label.as-setting",
        null,
        h("span.as-setting-text", null, h("strong", null, title), h("span", null, text)),
        control,
      );
    const clearAll = h(
      "div.as-setting-actions",
      null,
      button({
        label: `Cookies (${jar.all.length})…`,
        icon: "cookie",
        onClick: () => S.showCookies(),
      }),
      button({
        label: "Forget OAuth tokens",
        icon: "key",
        onClick: () => {
          tokens.clear();
          S.app.toast("Tokens forgotten", "ok");
        },
      }),
      button({
        label: "Clear runtime values",
        icon: "broom",
        onClick: () => {
          S.clearRuntime();
          S.app.emit("env");
          S.app.toast("Runtime values cleared", "ok");
        },
      }),
    );
    const ok = await dialog({
      title: "API Studio settings",
      className: "is-wide",
      body: [
        h("div.as-setting-col", null, h("span.as-field-label", null, "curl"), curl, version),
        row(
          "Keep a history",
          `Remember the last requests sent (${S.app.state.history.length} now).`,
          history,
        ),
        h(
          "div.as-setting-col",
          null,
          h("span.as-field-label", null, "Kept on this desk"),
          clearAll,
        ),
      ],
      actions: [
        { label: "Cancel", value: () => false },
        { label: "Save", kind: "desk-btn-primary", value: () => true },
      ],
    });
    if (!ok) return;
    S.settings.curl = curl.value.trim();
    S.settings.history = history.checked;
    await S.ctx.settings?.set?.(SETTING_CURL, S.settings.curl).catch(() => {});
    await S.ctx.settings?.set?.(SETTING_HISTORY, S.settings.history).catch(() => {});
    S.app.toast("Settings saved", "ok");
  };

  return {
    async start() {
      await Promise.all([tokens.start(), jar.start()]);
      try {
        const path = await S.ctx.settings?.get?.(SETTING_CURL);
        const keep = await S.ctx.settings?.get?.(SETTING_HISTORY);
        if (typeof path === "string") S.settings.curl = path;
        if (typeof keep === "boolean") S.settings.history = keep;
      } catch {
        /* defaults */
      }
    },
  };
}

/** How long ago a token was fetched, for the Auth section. @param {number} at */
export const fetchedAgo = (at) => ago(at);
