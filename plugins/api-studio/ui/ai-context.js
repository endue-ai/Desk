// What the assistant is told, and the shape its answer must take. The prompt carries the request
// in front (secret header values and auth secrets left out), its last response (cut short), its
// test results, the collection's outline and the environment's variable names; never a secret's
// value: secret headers, query pairs and JSON fields are hidden, in the request and in the
// response, and so is every secret variable's value wherever it turns up. The answer is a tool
// call: a short reply and actions the person can apply one by one.

import {
  HIDDEN,
  hideText,
  hideUrl,
  hideValues,
  isSecretName,
  secretValues,
} from "./secret-names.js";
import { bodyText } from "./send.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 */

const cut = (/** @type {string} */ text, /** @type {number} */ max) =>
  text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;

export const ANSWER_TOOL = {
  name: "api_studio_answer",
  description: "Answer the person and propose changes to their requests that they can apply.",
  schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "The answer, short, in Markdown." },
      actions: {
        type: "array",
        description:
          "Changes the person can apply, each on its own. Empty when nothing should change.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [
                "create_request",
                "update_request",
                "add_tests",
                "add_checks",
                "write_docs",
                "set_variable",
              ],
            },
            title: { type: "string", description: "What applying it does, in a few words." },
            request: {
              type: "object",
              properties: {
                name: { type: "string" },
                method: { type: "string" },
                url: { type: "string" },
                headers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { key: { type: "string" }, value: { type: "string" } },
                    required: ["key", "value"],
                  },
                },
                query: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { key: { type: "string" }, value: { type: "string" } },
                    required: ["key", "value"],
                  },
                },
                body: {
                  type: "object",
                  properties: {
                    mode: {
                      type: "string",
                      enum: ["none", "json", "text", "xml", "form", "graphql"],
                    },
                    text: { type: "string" },
                  },
                },
              },
            },
            code: {
              type: "string",
              description: "Tests: JavaScript with test(name, fn) and expect().",
            },
            checks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  target: { type: "string" },
                  op: { type: "string" },
                  value: { type: "string" },
                },
                required: ["target", "op"],
              },
            },
            markdown: { type: "string" },
            variable: {
              type: "object",
              properties: { name: { type: "string" }, value: { type: "string" } },
              required: ["name", "value"],
            },
          },
          required: ["kind", "title"],
        },
      },
    },
    required: ["reply"],
  },
};

const GUIDE = `You are the assistant inside API Studio, an HTTP client on the person's desk.
- Variables are written {{name}}; {{$uuid}}, {{$timestamp}}, {{$randomEmail}} and others make fresh values.
- Tests are JavaScript run after the response: test("name", () => { expect(res.status).to.equal(200); }).
  res.status, res.body (parsed JSON), res.header("name"), res.time (ms), res.size. expect(x).to.equal / eql (deep)
  / include / have.property(name) / have.lengthOf(n) / be.above(n) / be.below(n) / be.an("array") / match(/re/) / be.true; .not negates.
- Checks need no code: target (res.status, res.time, res.headers.name, res.body.a.b[0], $.data[*].id), op (eq, neq, gt, gte, lt,
  lte, contains, notContains, startsWith, endsWith, matches, in, length, isEmpty, isNotEmpty, isDefined, isUndefined, isNull,
  isTruthy, isFalsy, isNumber, isString, isBoolean, isArray, isObject) and value.
- Propose actions only when they help; keep the reply short and concrete. Never ask for or invent secrets: use {{variables}}.`;

/** The request in front, as the brain may see it. @param {Tab} tab @param {string[]} [values] secret values to hide */
export function describeRequest(tab, values = []) {
  const r = tab.req;
  const headers = r.headers
    .filter((h) => h.on && h.key)
    .map(
      (h) =>
        `${h.key}: ${isSecretName(h.key) && !/^\{\{[^{}]+\}\}$/.test(h.value.trim()) ? HIDDEN : hideValues(h.value, values)}`,
    );
  const body =
    r.body.mode === "none"
      ? ""
      : r.body.mode === "graphql"
        ? r.body.graphql.query
        : String(/** @type {any} */ (r.body)[r.body.mode] ?? "");
  return [
    `Request "${r.name}": ${r.method} ${hideUrl(r.url, values)}`,
    headers.length ? `Headers:\n${headers.join("\n")}` : "",
    r.body.mode !== "none" ? `Body (${r.body.mode}):\n${cut(hideText(body, values), 4000)}` : "",
    `Auth: ${r.auth.type}`,
    r.asserts.length
      ? `Checks: ${r.asserts.map((a) => `${a.target} ${a.op} ${a.value}`).join("; ")}`
      : "",
    r.tests.trim() ? `Tests:\n${cut(r.tests, 2000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The last response, cut short. @param {Tab} tab @param {string[]} [values] secret values to hide */
export function describeResponse(tab, values = []) {
  const res = tab.response;
  if (!res) return "Not sent yet.";
  if (!res.status)
    return `It failed before any answer: ${hideValues(res.error ?? "unknown error", values)}`;
  const headers = res.headers.map(
    ([k, v]) =>
      `${k}: ${/^set-cookie$/i.test(k) ? `${v.split("=")[0]}=(value)` : isSecretName(k) ? HIDDEN : hideValues(v, values)}`,
  );
  const results = tab.results;
  const failed = results
    ? [
        ...results.tests.filter((t) => !t.ok).map((t) => `test "${t.name}": ${t.error}`),
        ...results.asserts.filter((a) => !a.ok).map((a) => `check ${a.target}: ${a.message}`),
        ...results.errors.map((e) => `script ${e.from}: ${e.text}`),
      ]
    : [];
  return [
    `Response: ${res.status} ${res.reason}, ${Math.round(res.timings.total)} ms, ${res.size} bytes${res.hops.length ? `, after ${res.hops.length} redirects` : ""}`,
    `Headers:\n${headers.slice(0, 30).join("\n")}`,
    `Body:\n${cut(hideText(bodyText(res), values), 6000)}`,
    failed.length
      ? `Failing:\n${failed.join("\n")}`
      : results
        ? "All tests and checks passed."
        : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The collection around a tab: its requests and the environment's variable names. @param {Studio} S @param {Tab | undefined} tab */
export function describeWorkspace(S, tab) {
  const coll = tab?.ref ? S.collections?.byPath(tab.ref.collection) : S.collections?.list[0];
  if (!coll) return "No collection is open.";
  /** @type {string[]} */
  const lines = [];
  const walk = (
    /** @type {import("./collection-fs.js").Node[]} */ nodes,
    /** @type {string} */ pad,
  ) => {
    for (const n of nodes) {
      if (lines.length > 150) return;
      if (n.type === "folder") {
        lines.push(`${pad}${n.name}/`);
        walk(n.children, `${pad}  `);
      } else lines.push(`${pad}${n.method} ${n.name} — ${hideUrl(n.req.url)}`);
    }
  };
  walk(coll.children, "  ");
  const env = S.envs?.activeEnv(coll);
  const vars = env
    ? env.vars
        .map((v) =>
          v.secret || isSecretName(v.key) ? `${v.key} (secret)` : `${v.key}=${cut(v.value, 80)}`,
        )
        .join(", ")
    : "";
  return [
    `Collection "${coll.name}":`,
    ...lines,
    env ? `Environment "${env.name}": ${vars}` : "No environment in use.",
    coll.meta.vars.length
      ? `Collection variables: ${coll.meta.vars.map((v) => v.key).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The whole prompt for a question. @param {Studio} S @param {Tab | undefined} tab @param {string} question */
export function promptFor(S, tab, question) {
  const values = tab ? secretValues(S.scopes?.(tab) ?? []) : [];
  return [
    GUIDE,
    "",
    describeWorkspace(S, tab),
    "",
    tab && !tab.kind ? describeRequest(tab, values) : "No request is open.",
    "",
    tab && !tab.kind ? describeResponse(tab, values) : "",
    "",
    `The person asks: ${question}`,
  ].join("\n");
}
