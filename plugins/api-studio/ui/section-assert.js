// The Assert section: checks without code, one per row. What to read from the response (status,
// time, a header, a path in the body), an operator, and what to expect ({{variables}} allowed).
// The last response's verdict shows beside each row.

import { OPS } from "./assert.js";
import { button, h, icon } from "./dom.js";
import { uid } from "./model.js";
import { varField } from "./var-field.js";
import { addSections } from "./view-request.js";

/** @typedef {import("./studio.js").Studio} Studio @typedef {import("./app.js").Tab} Tab */

const TARGETS = [
  "res.status",
  "res.time",
  "res.size",
  "res.body",
  "res.headers.content-type",
  "$.data",
  "res.body.id",
];

/** @param {Studio} S @param {Tab} tab */
function drawAssert(S, tab) {
  const list = h("div.as-asserts");
  const changed = () => S.app.emit("req", { field: "asserts" });
  const verdicts = new Map((tab.results?.asserts ?? []).map((v) => [v.id, v]));
  const datalist = h(
    "datalist#as-assert-targets",
    null,
    ...TARGETS.map((t) => h("option", { value: t })),
  );

  const draw = () => {
    list.replaceChildren(
      h(
        "div.as-assert.as-assert-head",
        null,
        h("span"),
        h("span", null, "Read"),
        h("span", null, "Check"),
        h("span", null, "Expected"),
        h("span"),
        h("span"),
      ),
      ...tab.req.asserts.map((a) => {
        const on = /** @type {HTMLInputElement} */ (
          h("input.desk-check", { type: "checkbox", checked: a.on, "aria-label": "Use this check" })
        );
        on.addEventListener("change", () => {
          a.on = on.checked;
          changed();
        });
        const target = /** @type {HTMLInputElement} */ (
          h("input.desk-field.as-assert-target", {
            type: "text",
            value: a.target,
            list: "as-assert-targets",
            spellcheck: "false",
            "aria-label": "What to read",
          })
        );
        target.addEventListener("input", () => {
          a.target = target.value;
          changed();
        });
        const op = h(
          "select.desk-field.as-assert-op",
          {
            "aria-label": "Operator",
            onChange: (/** @type {Event} */ e) => {
              a.op = /** @type {HTMLSelectElement} */ (e.target).value;
              changed();
              draw();
            },
          },
          ...OPS.map(([id, label]) => h("option", { value: id, selected: a.op === id }, label)),
        );
        const takes = OPS.find(([id]) => id === a.op)?.[2] ?? true;
        const value = takes
          ? varField({
              value: a.value,
              label: "Expected",
              placeholder: "200",
              scopes: () => S.scopes(tab),
              className: "as-assert-value",
              onChange: (v) => {
                a.value = v;
                changed();
              },
            }).el
          : h("span.as-hint.as-assert-none", null, "—");
        const verdict = verdicts.get(a.id);
        return h(
          `div.as-assert${a.on ? "" : ".is-off"}`,
          null,
          on,
          target,
          op,
          value,
          verdict
            ? h(
                `span.as-verdict.${verdict.ok ? "is-ok" : "is-bad"}`,
                { title: verdict.message },
                icon(verdict.ok ? "check" : "x", 14),
              )
            : h("span.as-verdict"),
          button({
            label: "Remove",
            icon: "x",
            hideLabel: true,
            kind: "kv-remove",
            onClick: () => {
              tab.req.asserts = tab.req.asserts.filter((x) => x !== a);
              changed();
              draw();
            },
          }),
        );
      }),
    );
  };
  draw();
  const add = (
    /** @type {string} */ target,
    /** @type {string} */ op,
    /** @type {string} */ value,
  ) => {
    tab.req.asserts = [...tab.req.asserts, { id: uid("a"), on: true, target, op, value }];
    changed();
    draw();
  };
  return {
    el: h(
      "div.as-section",
      null,
      datalist,
      h("div.kv-bar", null, h("span.kv-title", null, "Checks on the response")),
      list,
      h(
        "div.as-assert-add",
        null,
        button({
          label: "Add a check",
          icon: "plus",
          onClick: () => add("res.status", "eq", "200"),
        }),
        button({
          label: "Status is 2xx",
          kind: "desk-btn-quiet",
          onClick: () => add("res.status", "lt", "300"),
        }),
        button({
          label: "Faster than 500 ms",
          kind: "desk-btn-quiet",
          onClick: () => add("res.time", "lt", "500"),
        }),
        button({
          label: "Body is JSON",
          kind: "desk-btn-quiet",
          onClick: () => add("res.headers.content-type", "contains", "json"),
        }),
      ),
    ),
  };
}

addSections([
  {
    id: "assert",
    label: "Assert",
    badge: (tab) => tab.req.asserts.filter((a) => a.on).length,
    draw: drawAssert,
  },
]);
