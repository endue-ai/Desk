// Secrets typed as they are into what is saved as files. A request, folder or collection is a
// plain file meant for Git, so a password, token or key typed into its auth, a secret header, a
// secret query pair, a form field or a variable would be committed with it. Saving such a tab
// asks first, and offers to move each value into a secret variable (the active environment's, or
// the globals'), kept in the desk and never in the files, leaving {{name}} in its place. An
// environment's variable whose name says secret is offered to be kept as a secret, too.

import { h } from "./dom.js";
import { literalSecrets, typed } from "./literals.js";
import { dialog } from "./menu.js";
import { uid } from "./model.js";
import { isSecretName } from "./secret-names.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./literals.js").Literal} Literal
 */

/** @param {Studio} S */
export function installLiteralSecrets(S) {
  /** Where moved secrets go for a tab: its collection's active environment, else the globals. @param {Tab} tab */
  const target = (tab) => {
    const coll = tab.ref ? S.collections.byPath(tab.ref.collection) : undefined;
    const env = coll ? S.envs.activeEnv(coll) : undefined;
    return coll && env
      ? {
          label: `the environment “${env.name}”`,
          vars: S.envs.varsOf(coll, env).map((/** @type {any} */ v) => ({ ...v })),
          write: (/** @type {any[]} */ vars) => S.envs.save(coll, env, vars),
        }
      : {
          label: "the global variables",
          vars: S.envs.globals.map((/** @type {any} */ v) => ({ ...v })),
          write: (/** @type {any[]} */ vars) => S.envs.saveGlobals(vars),
        };
  };

  /** Move each literal into a secret variable and leave {{name}} behind. @param {Tab} tab @param {Literal[]} found */
  const move = async (tab, found) => {
    const to = target(tab);
    for (const lit of found) {
      let name = lit.name;
      for (let n = 2; ; n++) {
        const same = to.vars.find((v) => v.key === name);
        if (!same) {
          to.vars.push({ id: uid("p"), on: true, key: name, value: lit.value, secret: true });
          break;
        }
        if (same.value === lit.value) {
          same.secret = true;
          break;
        }
        name = `${lit.name}${n}`;
      }
      lit.put(`{{${name}}}`);
    }
    await to.write(to.vars);
    S.app.emit("req", { field: "auth" });
    S.app.toast(`Moved ${found.length} to ${to.label}`, "ok");
  };

  /** @param {Tab} tab @param {string[]} labels @param {string} where */
  const ask = (tab, labels, where) =>
    dialog({
      title: "Save secrets in the file?",
      className: "is-secrets",
      body: [
        h(
          "p.as-dialog-text",
          null,
          `“${tab.req.name}” holds secrets typed as they are. Saving writes them into its file, and into Git if the collection is kept there:`,
        ),
        h("ul.as-dialog-list", null, ...labels.map((l) => h("li", null, l))),
        h(
          "p.as-dialog-text",
          null,
          `Move them into secret variables of ${where}, kept in the desk and not in the files.`,
        ),
      ],
      actions: [
        { label: "Cancel", value: () => "cancel" },
        { label: "Save as typed", value: () => "keep" },
        { label: "Move to secrets", kind: "desk-btn-primary", value: () => "move" },
      ],
    });

  const save = S.save;
  S.save = async (/** @type {Tab} */ tab) => {
    if (tab.kind === "env") {
      const loose =
        tab.ref?.path === "globals"
          ? []
          : tab.req.vars.pre.filter(
              (/** @type {any} */ v) => !v.secret && isSecretName(v.key) && typed(v.value),
            );
      if (loose.length) {
        const answer = await ask(
          tab,
          loose.map((/** @type {any} */ v) => `Variable ${v.key}`),
          "this environment",
        );
        if (answer === undefined || answer === "cancel") return false;
        if (answer === "move") for (const v of loose) /** @type {any} */ (v).secret = true;
      }
      return save(tab);
    }
    if (tab.kind === "runner") return save(tab);
    const found = literalSecrets(tab.req);
    if (found.length) {
      const answer = await ask(
        tab,
        found.map((l) => l.label),
        target(tab).label,
      );
      if (answer === undefined || answer === "cancel") return false;
      if (answer === "move") await move(tab, found);
    }
    return save(tab);
  };
}
