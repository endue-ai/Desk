// An environment's own tab (or the globals'): its name and colour, whether the collection uses it
// now, and its variables, any of which can be secret. A secret's value stays in the desk's store;
// the environment's file keeps only its name, so the collection can go into Git as it is.

import { button, h, icon, keys } from "./dom.js";
import { COLORS } from "./environments.js";
import { kvTable } from "./kv-table.js";
import { confirm } from "./menu.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 */

/** @param {Studio} S @param {Tab} tab */
export function envPane(S, tab) {
  const isGlobals = tab.ref?.path === "globals";
  const coll = tab.ref && !isGlobals ? S.collections.byPath(tab.ref.collection) : undefined;
  const env = coll?.envs.find((e) => e.path === tab.ref?.path);
  const using = coll && env && S.envs.activeEnv(coll)?.path === env.path;
  const color = tab.extra?.color ?? env?.color ?? "gray";

  const name = /** @type {HTMLInputElement} */ (
    h("input.desk-field.as-group-name", {
      type: "text",
      value: tab.req.name,
      "aria-label": "Name",
      disabled: isGlobals,
    })
  );
  name.addEventListener("input", () => {
    tab.req.name = name.value;
    S.app.emit("req", { field: "name" });
  });
  const swatches = isGlobals
    ? null
    : h(
        "div.as-swatches",
        { role: "radiogroup", "aria-label": "Colour" },
        ...COLORS.map((c) =>
          h(`button.desk-icon-btn.as-swatch.env-${c}${c === color ? ".is-on" : ""}`, {
            type: "button",
            role: "radio",
            "aria-checked": String(c === color),
            "aria-label": c,
            title: c,
            onClick: async () => {
              tab.extra = { ...(tab.extra ?? {}), color: c };
              if (coll && env)
                await S.envs.save(coll, { ...env, color: c }, S.envs.varsOf(coll, env));
              root.replaceWith(envPane(S, tab).el);
            },
          }),
        ),
      );
  const table = kvTable({
    rows: tab.req.vars.pre,
    scopes: () => S.scopes(tab),
    title: "Variables",
    keyHint: "Add a variable",
    valueHint: "Value",
    notes: false,
    locks: true,
    onChange: (rows) => {
      tab.req.vars.pre = rows;
      S.app.emit("req", { field: "vars" });
    },
  });
  const head = h(
    "div.as-group-head",
    null,
    h(
      `span.as-group-icon.as-env-icon.env-${isGlobals ? "gray" : color}`,
      null,
      icon(isGlobals ? "globe" : "environments", 20),
    ),
    h(
      "div.as-group-title",
      null,
      name,
      h(
        "span.as-group-path",
        null,
        isGlobals ? "Kept on this desk, for every collection" : (tab.ref?.path ?? ""),
      ),
    ),
    h("span.as-grow"),
    coll && env
      ? button({
          label: using ? "In use" : "Use this environment",
          icon: using ? "check" : "play",
          kind: using ? "as-in-use" : "",
          onClick: () => S.envs.use(coll, using ? undefined : env.name),
        })
      : null,
    coll && env
      ? button({
          label: "Delete",
          icon: "trash",
          hideLabel: true,
          onClick: async () => {
            if (
              !(await confirm(
                "Delete environment",
                `Move “${env.name}” to the trash? Its secret values on this desk go too.`,
                "Delete",
                true,
              ))
            )
              return;
            S.app.close(tab.id);
            await S.envs.remove(coll, env);
          },
        })
      : null,
    button({
      label: "Save",
      icon: "download",
      kind: "desk-btn-primary",
      title: `Save (${keys("Mod+S")})`,
      onClick: () => S.save(tab),
    }),
  );
  const root = h(
    "div.as-group.as-env",
    null,
    head,
    swatches
      ? h("div.as-env-colors", null, h("span.as-field-label", null, "Colour"), swatches)
      : null,
    h(
      "p.as-group-note",
      null,
      icon("lock", 14),
      isGlobals
        ? "Globals are the broadest scope: any collection, any environment. They never leave this desk."
        : "Secret values stay on this desk; the environment's file keeps only their names.",
    ),
    h("div.as-section", null, table.el),
  );
  return { el: root };
}
