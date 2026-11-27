// Environments in the studio: open an environment or the globals in a tab, make one, save it,
// put the picker on the tab strip, and after each response run the request's captures, keeping
// what they read for the next requests.

import { SEND_HOOKS } from "./actions.js";
import { envPane } from "./env-pane.js";
import { createEnvironments } from "./environments.js";
import { newRequest, uid } from "./model.js";
import { captures } from "./section-vars.js";
import { askEnvName, envPicker } from "./view-envs.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Env} Env
 */

/** @param {Studio} S */
export function installEnvironments(S) {
  const envs = createEnvironments(S);
  S.envs = envs;
  S.panes.env = envPane;

  /** @param {Collection} coll @param {Env} env */
  S.openEnv = (coll, env) => {
    const req = newRequest({
      id: `e-${env.path}`,
      name: env.name,
      vars: { pre: envs.varsOf(coll, env).map((v) => ({ ...v })), post: [] },
    });
    const tab = S.app.open(
      req,
      { collection: coll.path, path: env.path },
      { saved: true, kind: "env" },
    );
    if (tab && !tab.extra) tab.extra = { color: env.color ?? "gray" };
    return tab;
  };
  S.openGlobals = () => {
    const req = newRequest({
      id: "e-globals",
      name: "Globals",
      vars: { pre: envs.globals.map((v) => ({ ...v })), post: [] },
    });
    return S.app.open(req, { collection: "", path: "globals" }, { saved: true, kind: "env" });
  };
  /** @param {Collection} coll @param {Env} [from] */
  S.newEnv = async (coll, from) => {
    const name = await askEnvName(from?.name);
    if (!name) return;
    const env = await envs.create(coll, name, from);
    const fresh = S.collections.byPath(coll.path);
    if (env && fresh) {
      if (!envs.activeEnv(fresh)) await envs.use(fresh, env.name);
      S.openEnv(fresh, env);
    }
  };

  const save = S.save;
  S.save = async (
    /** @type {Tab} */ tab,
    /** @type {import("./features-collections.js").SaveDestination | undefined} */ destination,
  ) => {
    if (tab.kind !== "env") return save(tab, destination);
    try {
      const vars = tab.req.vars.pre
        .filter((v) => v.key)
        .map((v) => ({ ...v, id: v.id || uid("p") }));
      if (tab.ref?.path === "globals") await envs.saveGlobals(vars);
      else {
        const coll = tab.ref && S.collections.byPath(tab.ref.collection);
        const env = coll?.envs.find((e) => e.path === tab.ref?.path);
        if (!coll || !env) throw new Error("the environment is gone");
        await envs.save(
          coll,
          { ...env, name: tab.req.name, color: tab.extra?.color ?? env.color },
          vars,
        );
      }
      tab.saved = JSON.stringify(tab.req);
      S.app.emit("req", { field: "saved" });
      S.app.toast("Saved", "ok");
      return true;
    } catch (error) {
      S.app.toast(
        `Could not save: ${String(/** @type {any} */ (error)?.message ?? error)}`,
        "error",
      );
      return false;
    }
  };

  SEND_HOOKS.push({
    after(_S, tab, res) {
      if (!res.status) return;
      const found = captures(tab, res);
      tab.lastCaptures = found;
      for (const c of found) if (c.value !== undefined) envs.setFromRun(tab, c.name, c.value);
    },
  });

  S.envPicker = () => envPicker(S);
  return envs;
}
