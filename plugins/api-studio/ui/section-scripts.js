// The Scripts and Tests sections. Scripts are JavaScript run before the request goes (they can
// change it and set variables) and after the response comes (to read it, set variables, log);
// a folder's or collection's scripts run around every request in it. Tests are JavaScript with
// test() and expect(). Snippets insert the common things at the cursor.

import { codeEditor } from "./code-editor.js";
import { button, h, icon } from "./dom.js";
import { showMenu } from "./menu.js";
import { addSections } from "./view-request.js";

/** @typedef {import("./studio.js").Studio} Studio @typedef {import("./app.js").Tab} Tab */

export const PRE_SNIPPETS = [
  ["Add a header", 'req.setHeader("X-Request-Id", api.uuid());'],
  ["Set a variable", 'api.set("startedAt", String(Date.now()));'],
  [
    "Sign the body with HMAC",
    'const signature = await api.hmac256(api.get("secret"), JSON.stringify(req.body));\nreq.setHeader("X-Signature", signature);',
  ],
  ["Change the body", "req.setBody({ ...req.body, sentAt: new Date().toISOString() });"],
  ["Skip when a variable is missing", 'if (!api.get("token")) api.skip();'],
  ["Log the request", "console.log(req.method, req.url, req.headers);"],
];
export const POST_SNIPPETS = [
  ["Keep a value from the body", 'api.set("userId", res.body.id);'],
  ["Keep a header", 'api.set("etag", res.header("etag"));'],
  ["Keep it in the environment", 'api.env.set("token", res.body.access_token);'],
  ["Log the response", "console.log(res.status, res.time, res.body);"],
];
export const TEST_SNIPPETS = [
  ["Status is 200", 'test("status is 200", () => {\n  expect(res.status).to.equal(200);\n});'],
  [
    "Answers quickly",
    'test("answers within 500 ms", () => {\n  expect(res.time).to.be.below(500);\n});',
  ],
  [
    "Body is JSON with a field",
    'test("has an id", () => {\n  expect(res.body).to.have.property("id");\n});',
  ],
  [
    "List is not empty",
    'test("returns items", () => {\n  expect(res.body.data).to.be.an("array").that.is.not.empty;\n});',
  ],
  [
    "Header is set",
    'test("sends JSON", () => {\n  expect(res.header("content-type")).to.include("application/json");\n});',
  ],
  [
    "Each item has a shape",
    'test("each user has an email", () => {\n  for (const user of res.body.data) expect(user.email).to.match(/@/);\n});',
  ],
];

/** An editor with a title and a Snippets menu. @param {{ title: string, hint: string, value: string, snippets: string[][], minLines?: number, onChange(v: string): void }} spec */
function block(spec) {
  const ed = codeEditor({
    value: spec.value,
    lang: "js",
    label: spec.title,
    minLines: spec.minLines ?? 9,
    placeholder: spec.snippets[0]?.[1] ?? "",
    onChange: spec.onChange,
  });
  const snippets = button({
    label: "Snippets",
    icon: "code",
    kind: "desk-btn-quiet as-snip-btn",
    onClick: (e) =>
      showMenu(
        spec.snippets.map(([label, code]) => ({
          label: label ?? "",
          run: () => {
            const at = ed.area.selectionStart ?? ed.value.length;
            const before = ed.value.slice(0, at);
            const insert = `${before && !before.endsWith("\n") ? "\n" : ""}${code}\n`;
            ed.area.setRangeText(insert, at, ed.area.selectionEnd ?? at, "end");
            ed.redraw();
            spec.onChange(ed.value);
            ed.focus();
          },
        })),
        /** @type {Element} */ (e.currentTarget),
        { width: 260 },
      ),
  });
  return h(
    "div.as-script",
    null,
    h(
      "div.as-script-head",
      null,
      h("strong", null, spec.title),
      h("span.as-hint", null, spec.hint),
      h("span.as-grow"),
      snippets,
    ),
    ed.el,
  );
}

/** @param {Studio} S @param {Tab} tab */
function drawScripts(S, tab) {
  const changed = () => S.app.emit("req", { field: "scripts" });
  const group = tab.kind === "group";
  return {
    el: h(
      "div.as-section.as-scripts",
      null,
      block({
        title: "Before the request",
        hint: group
          ? "Runs before every request below, outermost first."
          : "Can change the request and set variables.",
        value: tab.req.scripts.pre,
        snippets: PRE_SNIPPETS,
        onChange: (v) => {
          tab.req.scripts.pre = v;
          changed();
        },
      }),
      block({
        title: "After the response",
        hint: group
          ? "Runs after every request below, innermost first."
          : "Reads the response; sets variables; logs.",
        value: tab.req.scripts.post,
        snippets: POST_SNIPPETS,
        onChange: (v) => {
          tab.req.scripts.post = v;
          changed();
        },
      }),
      h(
        "p.as-help",
        null,
        icon("info", 14),
        h(
          "span",
          null,
          "Scripts run in a sealed worker: ",
          h("code", null, "req"),
          ", ",
          h("code", null, "res"),
          ", ",
          h("code", null, "api.get/set"),
          ", ",
          h("code", null, "api.env.set"),
          ", ",
          h("code", null, "api.uuid()"),
          ", ",
          h("code", null, "api.sha256()"),
          ", ",
          h("code", null, "console.log"),
          ". Ten seconds at most.",
        ),
      ),
    ),
  };
}

/** @param {Studio} S @param {Tab} tab */
function drawTests(S, tab) {
  return {
    el: h(
      "div.as-section.as-scripts",
      null,
      block({
        title: "Tests",
        hint: "Run after the response; results show in the response's Tests tab.",
        value: tab.req.tests,
        snippets: TEST_SNIPPETS,
        minLines: 16,
        onChange: (v) => {
          tab.req.tests = v;
          S.app.emit("req", { field: "tests" });
        },
      }),
    ),
  };
}

addSections([
  {
    id: "scripts",
    label: "Scripts",
    group: true,
    badge: (tab) => !!(tab.req.scripts.pre.trim() || tab.req.scripts.post.trim()),
    draw: drawScripts,
  },
  { id: "tests", label: "Tests", badge: (tab) => tab.req.tests.trim() !== "", draw: drawTests },
]);
