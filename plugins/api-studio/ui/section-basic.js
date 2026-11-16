// The Params and Headers sections: the query rows (the URL follows them), the path variables a
// URL names as :name, and the headers, with the ones the desk adds itself shown below them.

import { h } from "./dom.js";
import { COMMON_HEADERS, kvTable } from "./kv-table.js";
import { pair } from "./model.js";
import { SECRET_HEADERS } from "./send.js";
import { pathVariables, urlFromParams } from "./url.js";
import { addSections, counted } from "./view-request.js";

/** @typedef {import("./studio.js").Studio} Studio @typedef {import("./app.js").Tab} Tab */

/** @param {Studio} S @param {Tab} tab */
function params(S, tab) {
  const table = kvTable({
    rows: tab.req.params,
    scopes: () => S.scopes(tab),
    title: "Query parameters",
    keyHint: "Add a parameter",
    onChange: (rows) => {
      tab.req.params = rows;
      tab.req.url = urlFromParams(tab.req.url, rows);
      S.app.emit("url", { from: "params" });
      S.app.emit("req", { field: "params" });
    },
  });
  const pathBox = h("div.as-pathvars");
  const drawPath = () => {
    const names = pathVariables(tab.req.url);
    if (!names.length) return pathBox.replaceChildren();
    const rows = names.map(
      (name) => tab.req.pathParams.find((p) => p.key === name) ?? pair({ key: name, value: "" }),
    );
    pathBox.replaceChildren(
      kvTable({
        rows,
        scopes: () => S.scopes(tab),
        title: "Path variables",
        notes: false,
        onChange: (next) => {
          tab.req.pathParams = next.filter((p) => names.includes(p.key));
          S.app.emit("req", { field: "pathParams" });
        },
      }).el,
    );
  };
  drawPath();
  return {
    el: h("div.as-section", null, table.el, pathBox),
    syncUrl: () => {
      table.set(tab.req.params);
      drawPath();
    },
  };
}

/** @param {Studio} S @param {Tab} tab */
function headers(S, tab) {
  const list = h(
    "datalist#as-header-names",
    null,
    ...COMMON_HEADERS.map((name) => h("option", { value: name })),
  );
  const table = kvTable({
    rows: tab.req.headers,
    scopes: () => S.scopes(tab),
    title: "Headers",
    keyHint: "Add a header",
    secret: (row) => SECRET_HEADERS.test(row.key),
    onChange: (rows) => {
      tab.req.headers = rows;
      S.app.emit("req", { field: "headers" });
    },
  });
  for (const input of table.el.querySelectorAll(".kv-key input"))
    input.setAttribute("list", "as-header-names");
  const auto = h(
    "details.as-auto",
    null,
    h("summary", null, "Added when sent"),
    h(
      "div.as-auto-list",
      null,
      ...S.autoHeaders(tab).map(([k, v]) =>
        h(
          "div.as-auto-row",
          null,
          h("span.as-auto-key", null, k),
          h("span.as-auto-value", null, v),
        ),
      ),
    ),
  );
  return { el: h("div.as-section", null, list, table.el, auto) };
}

addSections([
  { id: "params", label: "Params", badge: (tab) => counted(tab.req.params), draw: params },
  {
    id: "body",
    label: "Body",
    badge: (tab) => tab.req.body.mode !== "none",
    draw: (S, tab) => S.drawBody(tab),
  },
  { id: "headers", label: "Headers", badge: (tab) => counted(tab.req.headers), draw: headers },
]);
