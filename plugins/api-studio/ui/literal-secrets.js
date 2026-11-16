// Secrets typed as they are into what is saved as files. A request, folder or collection is a
// plain file meant for Git, so a password, token or key typed into its auth, a secret header, a
// secret query pair, a body field or a variable would be committed with it. Before such a file is
// written (S.beforeWrite, once the collection is known), the person is asked, and offered to move
// each value into a secret variable of that collection's environment in use (or of a new "Local
// secrets" one), kept in the desk and never in the files, leaving {{name}} in its place. Never
// into the globals: those fill into every collection's requests. An environment's variable whose
// name says secret is offered to be kept as a secret, too.

import { h } from "./dom.js";
import { literalSecrets, typed } from "./literals.js";
import { dialog } from "./menu.js";
import { uid } from "./model.js";
import { isSecretName } from "./secret-names.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./literals.js").Literal} Literal
 */

/** The environment moved secrets go to when a collection uses none. */
export const LOCAL = "Local secrets";

/** @param {Studio} S */
export function installLiteralSecrets(S) {
  /** The environment a collection's moved secrets go to: the one in use, else Local secrets. @param {Collection} coll */
  const target = async (coll) => {
    let env = S.envs.activeEnv(coll) ?? coll.envs.find((e) => e.name === LOCAL);
    if (!env) env = await S.envs.create(coll, LOCAL, { vars: [] });
    const fresh = S.collections.byPath(coll.path) ?? coll;
    if (!env) throw new Error("could not make an environment for the secrets");
    if (!S.envs.activeEnv(fresh)) await S.envs.use(fresh, env.name);
    const chosen = env;
    return {
      label: `the environment “${chosen.name}”`,
      vars: S.envs.varsOf(fresh, chosen).map((/** @type {any} */ v) => ({ ...v })),
      write: (/** @type {any[]} */ vars) => S.envs.save(fresh, chosen, vars),
    };
  };

  /** Move each literal into a secret variable and leave {{name}} behind. @param {Collection} coll @param {Literal[]} found */
  const move = async (coll, found) => {
    const to = await target(coll);
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
    return save(tab);
  };

  S.beforeWrite = async (
    /** @type {Tab} */ tab,
    /** @type {Collection} */ coll,
    /** @type {string} */ authDefault,
  ) => {
    const found = literalSecrets(tab.req, { authDefault });
    if (!found.length) return true;
    const where = S.envs.activeEnv(coll)?.name ?? LOCAL;
    const answer = await ask(
      tab,
      found.map((l) => l.label),
      `the environment “${where}”`,
    );
    if (answer === undefined || answer === "cancel") return false;
    if (answer === "move") await move(coll, found);
    return true;
  };
}
