// Scripts, tests and checks around a send. Before: the collection's script, then each folder's
// from the outside in, then the request's; each sees the request as it will go and may change
// it, set variables or skip it. After: the request's script, the folders' from the inside out,
// the collection's, then the tests, then the checks. Results and logs go to the response's Tests
// and Console tabs; variables set go where captures go.

import { SEND_HOOKS } from "./actions.js";
import { check } from "./assert.js";
import { button, h, icon } from "./dom.js";
import { browserSpawn, runScript } from "./scripts.js";
import { bodyText } from "./send.js";
import { resolve } from "./vars.js";
import { RES_TABS } from "./view-response.js";
import "./section-assert.js";
import "./section-scripts.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {{ tests: { name: string, ok: boolean, error?: string, from: string }[],
 *   asserts: { id: string, ok: boolean, message: string, target: string }[],
 *   logs: { level: string, text: string, from: string }[], errors: { from: string, text: string }[] }} Results
 */

export class Skipped extends Error {
  /** A skip is said as it is, not as a failure to send. */
  plain = true;
}

/** Every variable in reach as name → value, the narrowest winning. @param {Studio} S @param {Tab} tab */
function flatVars(S, tab) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const s of [...S.scopes(tab)].reverse()) for (const [k, v] of s.values) out[k] = v;
  return out;
}

/** @param {Studio} S */
export function installScripts(S) {
  S.spawn = browserSpawn;
  /** @param {Tab} tab */
  const groups = (tab) => S.collections?.parents(tab) ?? [];
  /** @param {Tab} tab @param {import("./scripts.js").ScriptResult} r @param {string} from */
  const keep = (tab, r, from) => {
    const results = /** @type {Results} */ (tab.results);
    for (const l of r.logs) results.logs.push({ ...l, from });
    for (const t of r.tests) results.tests.push({ ...t, from });
    if (r.error) results.errors.push({ from, text: r.error });
    for (const [k, v] of Object.entries(r.vars)) S.runtime.values.set(k, v);
    for (const [k, v] of Object.entries(r.env)) S.envs?.setFromRun(tab, k, v);
    if (Object.keys(r.vars).length || Object.keys(r.env).length) S.app.emit("env");
  };

  SEND_HOOKS.push({
    before(_S, tab) {
      tab.results = { tests: [], asserts: [], logs: [], errors: [] };
    },
    async prepared(_S, tab, prep) {
      const list = [...groups(tab)]
        .reverse()
        .map((g) => ({ from: g.name, code: g.scripts.pre }))
        .concat([{ from: tab.req.name, code: tab.req.scripts.pre }])
        .filter((x) => x.code.trim());
      for (const item of list) {
        const request = {
          method: prep.method,
          url: prep.url,
          headers: prep.headers.map((x) => /** @type {[string, string]} */ ([x.key, x.value])),
          body: prep.body.kind === "raw" ? prep.body.text : "",
        };
        const r = await runScript(
          item.code,
          { phase: "pre", name: item.from, vars: flatVars(S, tab), request },
          { spawn: S.spawn },
        );
        keep(tab, r, item.from);
        if (r.request) {
          prep.method = r.request.method;
          prep.url = r.request.url;
          prep.headers = r.request.headers.map(([key, value]) => ({ key, value }));
          if (r.request.bodyChanged) prep.body = { kind: "raw", text: r.request.body };
        }
        if (r.skip) throw new Skipped(`Skipped by the script of ${item.from}.`);
      }
      if (!list.length) return;
      // Names a script has just set fill in now.
      const scopes = S.scopes(tab);
      prep.url = resolve(prep.url, scopes);
      prep.headers = prep.headers.map((x) => ({ key: x.key, value: resolve(x.value, scopes) }));
      if (prep.body.kind === "raw")
        prep.body = { kind: "raw", text: resolve(prep.body.text, scopes) };
    },
    async after(_S, tab, res) {
      if (!res.status || !tab.results) return;
      const response = {
        status: res.status,
        reason: res.reason,
        headers: res.headers,
        text: res.body.length < 8_000_000 ? bodyText(res) : "",
        time: Math.round(res.timings.total),
        size: res.size,
        url: res.sent.url,
      };
      const posts = [
        { from: tab.req.name, code: tab.req.scripts.post },
        ...groups(tab).map((g) => ({ from: g.name, code: g.scripts.post })),
      ].filter((x) => x.code.trim());
      for (const item of posts)
        keep(
          tab,
          await runScript(
            item.code,
            { phase: "post", name: item.from, vars: flatVars(S, tab), response },
            { spawn: S.spawn },
          ),
          item.from,
        );
      if (tab.req.tests.trim())
        keep(
          tab,
          await runScript(
            tab.req.tests,
            { phase: "tests", name: tab.req.name, vars: flatVars(S, tab), response },
            { spawn: S.spawn },
          ),
          "Tests",
        );
      const scopes = S.scopes(tab);
      tab.results.asserts = tab.req.asserts
        .filter((a) => a.on && a.target.trim())
        .map((a) => ({ id: a.id, target: a.target, ...check(a, res, (t) => resolve(t, scopes)) }));
    },
  });

  RES_TABS.push(
    {
      id: "tests",
      label: "Tests",
      show: (_res, tab) =>
        !!tab.results &&
        tab.results.tests.length + tab.results.asserts.length + tab.results.errors.length > 0,
      count: (_res, tab) => {
        const r = /** @type {Results} */ (tab.results);
        const all = [...r.tests, ...r.asserts];
        const passed = all.filter((t) => t.ok).length;
        return `${passed === all.length && !r.errors.length ? "✓" : "✗"} ${passed}/${all.length}`;
      },
      draw: (_S, tab) => testsView(S, tab),
    },
    {
      id: "console",
      label: "Console",
      show: (_res, tab) => !!tab.results?.logs.length,
      count: (_res, tab) => tab.results?.logs.length ?? 0,
      draw: (_S, tab) =>
        h(
          "div.as-console",
          null,
          ...(tab.results?.logs ?? []).map((l) =>
            h(
              `div.as-console-line.lv-${l.level}`,
              null,
              h("span.as-console-from", null, l.from),
              h("span.as-console-text", null, l.text),
            ),
          ),
        ),
    },
  );
}

/** @param {Studio} S @param {Tab} tab */
function testsView(S, tab) {
  const r = /** @type {Results} */ (tab.results);
  const all = [...r.tests, ...r.asserts];
  const failed = all.filter((t) => !t.ok).length;
  const row = (
    /** @type {boolean} */ ok,
    /** @type {string} */ name,
    /** @type {string | undefined} */ detail,
    /** @type {string} */ from,
  ) =>
    h(
      `div.as-result${ok ? ".is-ok" : ".is-bad"}`,
      null,
      h("span.as-result-icon", null, icon(ok ? "check" : "x", 14)),
      h("span.as-result-name", null, name),
      detail ? h("span.as-result-detail", null, detail) : null,
      h("span.as-result-from", null, from),
    );
  return h(
    "div.as-tests",
    null,
    h(
      `div.as-tests-sum${failed || r.errors.length ? ".is-bad" : ".is-ok"}`,
      null,
      icon(failed || r.errors.length ? "alert" : "check", 18),
      h("strong", null, failed ? `${failed} of ${all.length} failed` : `All ${all.length} passed`),
      h("span.as-grow"),
      button({
        label: "Run again",
        icon: "refresh",
        kind: "desk-btn-quiet",
        onClick: () => S.send(tab),
      }),
    ),
    ...r.errors.map((e) =>
      h(
        "div.as-result.is-bad",
        null,
        h("span.as-result-icon", null, icon("alert", 14)),
        h("span.as-result-name", null, e.text),
        h("span.as-result-from", null, e.from),
      ),
    ),
    r.tests.length ? h("h3.as-tests-h", null, "Tests") : null,
    ...r.tests.map((t) => row(t.ok, t.name, t.error, t.from)),
    r.asserts.length ? h("h3.as-tests-h", null, "Checks") : null,
    ...r.asserts.map((a) =>
      row(a.ok, a.ok ? a.message : a.target, a.ok ? undefined : a.message, "Assert"),
    ),
  );
}
