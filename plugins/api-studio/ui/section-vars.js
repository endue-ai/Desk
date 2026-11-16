// The Vars section. A request has its own variables (the narrowest scope a file keeps) and values
// it captures from its response, each a name and where to read it: `res.body.access_token`,
// `res.headers.etag`, `$.data[0].id`. A capture into a secret of the environment in use is kept
// with the secrets; anything else lives for the session. A folder or collection has variables.

import { h, icon } from "./dom.js";
import { asText, read } from "./expr.js";
import { kvTable } from "./kv-table.js";
import { active } from "./model.js";
import { addSections, counted } from "./view-request.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./send.js").Response} Response
 */

/** What each capture of a request reads from a response: name, value, or the problem. @param {Tab} tab @param {Response} res */
export function captures(tab, res) {
  return active(tab.req.vars.post).map((p) => {
    try {
      const value = read(p.value, res);
      return value === undefined
        ? { name: p.key, error: `${p.value} is not in the response` }
        : { name: p.key, value: asText(value) };
    } catch (error) {
      return { name: p.key, error: String(/** @type {Error} */ (error).message) };
    }
  });
}

/** @param {Studio} S @param {Tab} tab */
function drawVars(S, tab) {
  const changed = () => S.app.emit("req", { field: "vars" });
  const own = kvTable({
    rows: tab.req.vars.pre,
    scopes: () => S.scopes(tab),
    title: tab.kind === "group" ? "Variables" : "Request variables",
    keyHint: "Add a variable",
    onChange: (rows) => {
      tab.req.vars.pre = rows;
      changed();
    },
  });
  if (tab.kind === "group")
    return {
      el: h(
        "div.as-section",
        null,
        own.el,
        h(
          "p.as-hint",
          null,
          "Requests below see these; a request's own variables or an environment's win over them.",
        ),
      ),
    };
  const caught = kvTable({
    rows: tab.req.vars.post,
    scopes: () => S.scopes(tab),
    title: "Capture from the response",
    keyHint: "Variable name",
    valueHint: "res.body.access_token",
    valueLabel: "Read",
    onChange: (rows) => {
      tab.req.vars.post = rows;
      changed();
    },
  });
  const last = tab.lastCaptures ?? [];
  return {
    el: h(
      "div.as-section",
      null,
      own.el,
      caught.el,
      h(
        "div.as-help",
        null,
        icon("info", 14),
        h(
          "span",
          null,
          "Read with ",
          h("code", null, "res.status"),
          ", ",
          h("code", null, "res.body.path[0].to"),
          ", ",
          h("code", null, "res.headers.name"),
          ", ",
          h("code", null, "res.cookies.name"),
          " or ",
          h("code", null, "$.json.path"),
          ". Later requests use the value as {{name}}.",
        ),
      ),
      last.length
        ? h(
            "div.as-captured",
            null,
            h("h3", null, "Last response"),
            ...last.map((c) =>
              h(
                `div.as-captured-row${c.error ? ".is-bad" : ""}`,
                null,
                icon(c.error ? "alert" : "check", 14),
                h("code", null, c.name),
                h("span", null, c.error ?? c.value),
              ),
            ),
          )
        : null,
    ),
  };
}

addSections([
  {
    id: "vars",
    label: "Vars",
    group: true,
    badge: (tab) => counted(tab.req.vars.pre) + counted(tab.req.vars.post),
    draw: drawVars,
  },
]);
