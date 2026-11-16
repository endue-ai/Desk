// The Auth section: the kind of auth and its fields. "Inherit" says whose auth the request takes;
// secrets are hidden until the field is focused; OAuth 2.0 can fetch its token here.

import { AUTH_FIELDS, AUTH_TYPES, effectiveAuth, getPath, setPath } from "./auth.js";
import { button, h, icon } from "./dom.js";
import { varField } from "./var-field.js";
import { addSections } from "./view-request.js";

/** @typedef {import("./studio.js").Studio} Studio @typedef {import("./app.js").Tab} Tab */

const OAUTH_FIELDS = [
  { key: "oauth2.tokenUrl", label: "Token URL", placeholder: "{{baseUrl}}/oauth/token" },
  { key: "oauth2.clientId", label: "Client ID" },
  { key: "oauth2.clientSecret", label: "Client secret", secret: true },
  { key: "oauth2.scope", label: "Scope", placeholder: "read write" },
];
const OAUTH_PASSWORD = [
  { key: "oauth2.username", label: "Username" },
  { key: "oauth2.password", label: "Password", secret: true },
];

/** @param {Studio} S @param {Tab} tab */
function drawAuth(S, tab) {
  const auth = tab.req.auth;
  const root = h("div.as-section.as-auth");
  const redraw = () => root.replaceWith(drawAuth(S, tab).el);
  const select = h(
    "select.desk-field.as-auth-type",
    {
      "aria-label": "Auth type",
      onChange: (/** @type {Event} */ e) => {
        auth.type = /** @type {any} */ (/** @type {HTMLSelectElement} */ (e.target).value);
        S.app.emit("req", { field: "auth" });
        redraw();
      },
    },
    ...AUTH_TYPES.map(([value, label]) =>
      h("option", { value, selected: auth.type === value }, label),
    ),
  );
  root.append(h("div.as-auth-top", null, h("label.as-field-label", null, "Type"), select));

  /** @param {{ key: string, label: string, secret?: boolean, placeholder?: string }} f */
  const field = (f) =>
    h(
      "label.as-form-row",
      null,
      h("span.as-field-label", null, f.label),
      varField({
        value: getPath(auth, f.key),
        label: f.label,
        placeholder: f.placeholder ?? "",
        secret: f.secret,
        scopes: () => S.scopes(tab),
        onChange: (v) => {
          setPath(auth, f.key, v);
          S.app.emit("req", { field: "auth" });
        },
      }).el,
    );

  if (auth.type === "inherit") {
    const { auth: used, from } = effectiveAuth(auth, S.parentAuth(tab));
    const owner = S.parentNames(tab)[from] ?? "";
    const label = AUTH_TYPES.find(([t]) => t === used.type)?.[1] ?? used.type;
    root.append(
      h(
        "div.as-note",
        null,
        icon("info", 15),
        used.type === "none"
          ? h(
              "span",
              null,
              "No folder or collection above this request sets auth, so none is sent.",
            )
          : h(
              "span",
              null,
              "Uses ",
              h("strong", null, label),
              " from ",
              h("strong", null, owner || "its parent"),
              ".",
            ),
      ),
    );
  } else if (auth.type === "none") {
    root.append(
      h(
        "div.as-note",
        null,
        icon("info", 15),
        h("span", null, "This request sends no credentials."),
      ),
    );
  } else if (auth.type === "apikey") {
    if (!auth.apikey) auth.apikey = { key: "", value: "", in: "header" };
    const where = h(
      "select.desk-field",
      {
        "aria-label": "Add to",
        onChange: (/** @type {Event} */ e) => {
          if (auth.apikey)
            auth.apikey.in =
              /** @type {HTMLSelectElement} */ (e.target).value === "query" ? "query" : "header";
          S.app.emit("req", { field: "auth" });
        },
      },
      h("option", { value: "header", selected: auth.apikey.in !== "query" }, "Header"),
      h("option", { value: "query", selected: auth.apikey.in === "query" }, "Query parameter"),
    );
    root.append(
      field({ key: "apikey.key", label: "Key", placeholder: "X-Api-Key" }),
      field({ key: "apikey.value", label: "Value", secret: true, placeholder: "{{apiKey}}" }),
      h("label.as-form-row", null, h("span.as-field-label", null, "Add to"), where),
    );
  } else if (auth.type === "oauth2") {
    if (!auth.oauth2)
      auth.oauth2 = { grant: "client_credentials", tokenUrl: "", clientId: "", clientSecret: "" };
    const o = auth.oauth2;
    const grant = h(
      "select.desk-field",
      {
        "aria-label": "Grant type",
        onChange: (/** @type {Event} */ e) => {
          o.grant =
            /** @type {HTMLSelectElement} */ (e.target).value === "password"
              ? "password"
              : "client_credentials";
          S.app.emit("req", { field: "auth" });
          redraw();
        },
      },
      h(
        "option",
        { value: "client_credentials", selected: o.grant !== "password" },
        "Client credentials",
      ),
      h("option", { value: "password", selected: o.grant === "password" }, "Password"),
    );
    const state = h("div.as-token-state");
    const drawState = () => {
      const has = !!o.token;
      const left = o.expires ? Math.round((o.expires - Date.now()) / 60000) : undefined;
      state.replaceChildren(
        has ? icon("check", 14) : icon("info", 14),
        h(
          "span",
          null,
          !has
            ? "No token yet."
            : left === undefined
              ? "A token is held."
              : left > 0
                ? `A token is held; it expires in ${left} min.`
                : "The token has expired.",
        ),
      );
      state.classList.toggle("is-ok", has && (left === undefined || left > 0));
    };
    drawState();
    root.append(
      h("label.as-form-row", null, h("span.as-field-label", null, "Grant type"), grant),
      ...OAUTH_FIELDS.map(field),
      ...(o.grant === "password" ? OAUTH_PASSWORD.map(field) : []),
      h(
        "div.as-form-row.as-token-row",
        null,
        h("span.as-field-label", null, "Access token"),
        h(
          "div.as-token",
          null,
          state,
          button({
            label: "Get new token",
            icon: "key",
            kind: "desk-btn-primary",
            onClick: async () => {
              await S.fetchToken(tab);
              redraw();
            },
          }),
        ),
      ),
      field({
        key: "oauth2.token",
        label: "Token",
        secret: true,
        placeholder: "Filled in by Get new token",
      }),
    );
  } else {
    for (const f of AUTH_FIELDS[auth.type] ?? []) root.append(field(f));
    if (auth.type === "digest" || auth.type === "ntlm" || auth.type === "awsv4")
      root.append(
        h(
          "p.as-hint",
          null,
          auth.type === "awsv4"
            ? "curl signs the request with these keys."
            : "curl answers the server's challenge with these credentials.",
        ),
      );
  }
  return { el: root };
}

addSections([
  {
    id: "auth",
    label: "Auth",
    badge: (tab) => tab.req.auth.type !== "inherit" && tab.req.auth.type !== "none",
    draw: drawAuth,
  },
]);
