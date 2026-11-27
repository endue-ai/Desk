// What an assistant's action does when the person applies it: open a new request, change the one
// in front, add tests or checks to it, write its docs, or set a variable for the session. Nothing
// is saved to disk by an action; the person saves as always.

import { newRequest, pair, uid } from "./model.js";
import { paramsFromUrl, urlFromParams } from "./url.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {{ kind: string, title: string, request?: any, code?: string, checks?: { target: string, op: string, value?: string }[],
 *   markdown?: string, variable?: { name: string, value: string } }} Action
 */

/** A request from an action's description. @param {any} r */
export function requestFrom(r) {
  const req = newRequest({
    name: String(r?.name ?? "Suggested request"),
    method: String(r?.method ?? "GET").toUpperCase(),
    url: String(r?.url ?? ""),
  });
  for (const h of r?.headers ?? [])
    req.headers.push(pair({ key: String(h.key), value: String(h.value ?? "") }));
  req.params = paramsFromUrl(req.url, []);
  if (Array.isArray(r?.query) && r.query.length) {
    req.params = [
      ...req.params,
      ...r.query.map((/** @type {any} */ q) =>
        pair({ key: String(q.key), value: String(q.value ?? "") }),
      ),
    ];
    req.url = urlFromParams(req.url, req.params);
  }
  const mode = r?.body?.mode;
  if (mode && mode !== "none") {
    const text = String(r.body.text ?? "");
    if (mode === "graphql") {
      req.body.mode = "graphql";
      req.body.graphql.query = text;
    } else if (mode === "form") {
      req.body.mode = "form";
      req.body.form = text
        .split("&")
        .filter(Boolean)
        .map((kv) =>
          pair({
            key: decodeURIComponent(kv.split("=")[0] ?? ""),
            value: decodeURIComponent(kv.split("=").slice(1).join("=")),
          }),
        );
    } else if (mode === "json" || mode === "text" || mode === "xml") {
      req.body.mode = mode;
      req.body[mode] = text;
    }
  }
  return req;
}

/** Apply one action. Returns words saying what changed. @param {Studio} S @param {Tab | undefined} tab @param {Action} a */
export function applyAction(S, tab, a) {
  const needTab = () => {
    if (!tab || tab.kind) throw new Error("Open a request first.");
    return tab;
  };
  switch (a.kind) {
    case "create_request": {
      S.app.open(requestFrom(a.request));
      return "Opened the request in a new tab; save it to keep it.";
    }
    case "update_request": {
      const t = needTab();
      const next = requestFrom({
        name: t.req.name,
        method: a.request?.method ?? t.req.method,
        url: a.request?.url ?? t.req.url,
        ...a.request,
      });
      if (a.request?.method) t.req.method = next.method;
      if (a.request?.url) {
        t.req.url = next.url;
        t.req.params = next.params;
      }
      if (Array.isArray(a.request?.headers))
        for (const h of next.headers)
          t.req.headers = [
            ...t.req.headers.filter((o) => o.key.toLowerCase() !== h.key.toLowerCase()),
            h,
          ];
      if (a.request?.body) t.req.body = { ...t.req.body, ...next.body, mode: next.body.mode };
      S.app.emit("tab");
      return "Changed the request.";
    }
    case "add_tests": {
      const t = needTab();
      const before = t.req.tests;
      t.req.tests = `${t.req.tests.trim() ? `${t.req.tests.trimEnd()}\n\n` : ""}${String(a.code ?? "").trim()}\n`;
      t.reqTab = "tests";
      S.app.emit("tab");
      // Applied by the person: their own, as if typed, when what it adds to is theirs too
      // (empty or allowed); added to tests that came from a file, it is asked about (trust.js).
      S.app.emit("req", { field: "tests", which: "tests", tab: t, before });
      return "Added the tests; send to run them.";
    }
    case "add_checks": {
      const t = needTab();
      t.req.asserts = [
        ...t.req.asserts,
        ...(a.checks ?? []).map((c) => ({
          id: uid("a"),
          on: true,
          target: String(c.target),
          op: String(c.op),
          value: String(c.value ?? ""),
        })),
      ];
      t.reqTab = "assert";
      S.app.emit("tab");
      return `Added ${a.checks?.length ?? 0} checks.`;
    }
    case "write_docs": {
      const t = needTab();
      t.req.docs = String(a.markdown ?? "");
      t.reqTab = "docs";
      S.app.emit("tab");
      return "Wrote the docs.";
    }
    case "set_variable": {
      if (!a.variable?.name) throw new Error("The action names no variable.");
      const value = String(a.variable.value ?? "");
      if (S.setRuntime && tab) S.setRuntime(tab, a.variable.name, value);
      else S.runtime.values.set(a.variable.name, value);
      S.app.emit("env");
      return `Set {{${a.variable.name}}} for this session.`;
    }
    default:
      throw new Error(`Unknown action ${a.kind}.`);
  }
}
