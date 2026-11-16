// Environments in the window: the picker at the tab strip's end (the colour and name of the
// environment the request's collection uses), the Variables look that lists every name in reach
// and which scope wins, and the Environments panel with each collection's environments and the
// globals.

import { button, h, icon } from "./dom.js";
import { ask, showMenu } from "./menu.js";
import { DYNAMIC } from "./vars.js";
import { addRail, panelHead } from "./view-side.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 */

/** @param {Studio} S */
export function envPicker(S) {
  const root = h("div.as-envbar");
  const draw = () => {
    const tab = S.app.current();
    const coll = S.envs.collOf(tab) ?? (tab?.ref ? undefined : S.collections.list[0]);
    const env = S.envs.activeEnv(coll);
    if (!coll) {
      root.replaceChildren();
      return;
    }
    const pick = h(
      `button.desk-btn.as-envpick${env ? "" : ".is-none"}`,
      {
        type: "button",
        title: `${coll.name}: environment`,
        onClick: () =>
          showMenu(
            [
              { heading: coll.name },
              { label: "No environment", checked: !env, run: () => S.envs.use(coll, undefined) },
              ...coll.envs.map((e) => ({
                label: e.name,
                checked: env?.path === e.path,
                className: `env-item env-${e.color ?? "gray"}`,
                run: () => S.envs.use(coll, e.name),
              })),
              "-",
              ...(env
                ? [
                    {
                      label: `Edit ${env.name}`,
                      icon: /** @type {const} */ ("edit"),
                      run: () => S.openEnv(coll, env),
                    },
                  ]
                : []),
              {
                label: "New environment…",
                icon: /** @type {const} */ ("plus"),
                run: () => S.newEnv(coll),
              },
              {
                label: "Globals",
                icon: /** @type {const} */ ("globe"),
                run: () => S.openGlobals(),
              },
            ],
            pick,
            { width: 230 },
          ),
      },
      h(`span.as-env-dot.env-${env ? (env.color ?? "gray") : "none"}`),
      h("span.label", null, env?.name ?? "No environment"),
      icon("chevronDown", 13),
    );
    const look = button({
      label: "Variables in reach",
      icon: "eye",
      hideLabel: true,
      kind: "as-look",
      onClick: (e) =>
        tab ? showLook(S, tab, /** @type {Element} */ (e.currentTarget)) : undefined,
    });
    root.replaceChildren(look, pick);
  };
  S.app.on("env", draw);
  S.app.on("tab", draw);
  S.app.on("collections", draw);
  draw();
  return root;
}

/** Every variable in reach of a tab: name, value, where it comes from, whether a narrower scope hides it. @param {Studio} S @param {Tab} tab @param {Element} at */
function showLook(S, tab, at) {
  const scopes = S.scopes(tab);
  const seen = new Set();
  const rows = [];
  for (const s of scopes)
    for (const [key, value] of s.values) {
      const hidden = seen.has(key);
      seen.add(key);
      const secret = s.secret?.has(key);
      rows.push(
        h(
          `div.as-look-row${hidden ? ".is-hidden" : ""}`,
          null,
          h("span.as-look-name", null, key),
          h(
            "span.as-look-value",
            { title: secret ? "" : value },
            secret ? (value ? "••••••••" : "(not set)") : value || "(empty)",
          ),
          h(`span.as-look-scope.sc-${s.name}`, null, s.label),
        ),
      );
    }
  const box = h(
    "div.as-look",
    null,
    h(
      "div.as-look-head",
      null,
      h("strong", null, "Variables in reach"),
      h("span.as-hint", null, "Narrowest first; a struck-out name is hidden by the one above it."),
    ),
    rows.length
      ? h("div.as-look-list", null, ...rows)
      : h(
          "p.as-hint",
          null,
          "No variables yet. Add some to an environment, a collection or the globals.",
        ),
    h(
      "div.as-look-dyn",
      null,
      h("span.as-hint", null, "Made fresh each time: "),
      ...Object.keys(DYNAMIC)
        .slice(0, 6)
        .map((k) => h("code", null, `{{${k}}}`)),
      h("span.as-hint", null, "…"),
    ),
  );
  showMenu([], at, { className: "as-look-menu" }).append(box);
}

/** @param {Studio} S */
function envPanel(S) {
  const list = h("div.as-side-list");
  const draw = () => {
    const out = [];
    for (const coll of S.collections.list) {
      const activeEnv = S.envs.activeEnv(coll);
      out.push(
        h(
          "div.as-side-group.as-env-group",
          null,
          h("span", null, coll.name),
          button({
            label: `New environment in ${coll.name}`,
            icon: "plus",
            hideLabel: true,
            kind: "as-node-more",
            onClick: () => S.newEnv(coll),
          }),
        ),
      );
      if (!coll.envs.length) out.push(h("div.as-tree-empty", null, "No environments yet."));
      for (const env of coll.envs) {
        const on = activeEnv?.path === env.path;
        out.push(
          h(
            `div.as-node.desk-row.as-env-row${S.app.current()?.ref?.path === env.path ? ".is-selected" : ""}`,
            {
              role: "button",
              tabindex: "0",
              onClick: () => S.openEnv(coll, env),
              onContextmenu: (/** @type {MouseEvent} */ e) => {
                e.preventDefault();
                showMenu(
                  [
                    {
                      label: on ? "Stop using" : "Use",
                      icon: "check",
                      run: () => S.envs.use(coll, on ? undefined : env.name),
                    },
                    { label: "Edit", icon: "edit", run: () => S.openEnv(coll, env) },
                    { label: "Duplicate…", icon: "copy", run: () => S.newEnv(coll, env) },
                  ],
                  { x: e.clientX, y: e.clientY },
                );
              },
            },
            h(`span.as-env-dot.env-${env.color ?? "gray"}`),
            h("span.as-node-name", null, env.name),
            h("span.as-env-count", null, `${env.vars.length}`),
            on ? h("span.as-env-on", null, "In use") : null,
          ),
        );
      }
    }
    out.push(h("div.as-side-group", null, "This desk"));
    out.push(
      h(
        `div.as-node.desk-row.as-env-row${S.app.current()?.ref?.path === "globals" ? ".is-selected" : ""}`,
        { role: "button", tabindex: "0", onClick: () => S.openGlobals() },
        h("span.as-node-icon", null, icon("globe", 15)),
        h("span.as-node-name", null, "Globals"),
        h("span.as-env-count", null, `${S.envs.globals.length}`),
      ),
    );
    if (!S.collections.list.length)
      out.unshift(
        h(
          "div.as-side-empty",
          null,
          icon("environments", 22),
          h("p", null, "Open a collection to give it environments."),
        ),
      );
    list.replaceChildren(...out);
  };
  draw();
  return {
    el: h("div.as-panel", null, panelHead("Environments"), list),
    redraw: draw,
    topics: /** @type {import("./app.js").Topic[]} */ (["env", "collections", "tab"]),
  };
}

addRail({
  id: "environments",
  label: "Environments",
  icon: "environments",
  order: 20,
  draw: envPanel,
});

/** Ask a new environment's name. @param {string} [from] */
export const askEnvName = (from) =>
  ask(from ? `Duplicate ${from}` : "New environment", "Name", from ? `${from} copy` : "", "Create");
