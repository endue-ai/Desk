// Environments and globals: which environment each collection uses (kept per collection), the
// values of secret variables (kept in the desk's store, never in a collection's files), the
// global variables (in the store too), and changes to environments, written to their files.

import { ENV_DIR, ENV_EXT, envFile, freeName, join, text } from "./collection-fs.js";
import { uid } from "./model.js";
import { scope } from "./vars.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Env} Env
 * @typedef {import("./model.js").Pair & { secret?: boolean }} Var
 */

export const COLORS = ["green", "orange", "red", "blue", "purple", "teal", "gray"];

/** A short stable key for a path, as the store's keys allow. @param {string} path */
export function hashKey(path) {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

/** @param {Studio} S */
export function createEnvironments(S) {
  /** @type {Record<string, string>} collection path → active environment's name */
  let active = {};
  /** @type {Var[]} */
  let globals = [];
  /** @type {Map<string, Record<string, Record<string, string>>>} collection → env → key → value */
  const secrets = new Map();
  const store = (/** @type {string} */ key, /** @type {unknown} */ value) =>
    S.ctx.bridge.call("store.set", { key, value }).catch(() => {});
  const load = async (/** @type {string} */ key) => {
    try {
      return (await S.ctx.bridge.call("store.get", { key }))?.value;
    } catch {
      return undefined;
    }
  };

  /** @param {string} coll */
  const secretsOf = async (coll) => {
    if (!secrets.has(coll)) secrets.set(coll, (await load(`secrets.${hashKey(coll)}`)) ?? {});
    return /** @type {Record<string, Record<string, string>>} */ (secrets.get(coll));
  };

  /** The tab's collection. @param {Tab | undefined} tab */
  const collOf = (tab) => (tab?.ref ? S.collections.byPath(tab.ref.collection) : undefined);

  /** The environment a collection uses now. @param {Collection | undefined} coll */
  const activeEnv = (coll) =>
    coll ? coll.envs.find((e) => e.name === active[coll.path]) : undefined;

  /** An environment's variables with their secret values filled in from the store. @param {Collection} coll @param {Env} env @returns {Var[]} */
  const varsOf = (coll, env) => {
    const kept = secrets.get(coll.path)?.[env.name] ?? {};
    return env.vars.map((v) => (v.secret ? { ...v, value: kept[v.key] ?? "" } : v));
  };

  const api = {
    get globals() {
      return globals;
    },
    activeEnv,
    collOf,
    varsOf,
    async start() {
      active = (await load("active-envs")) ?? {};
      const g = await load("globals");
      globals = Array.isArray(g)
        ? g.map((v) => ({
            id: uid("p"),
            on: v.on !== false,
            key: String(v.key ?? ""),
            value: String(v.value ?? ""),
            ...(v.secret ? { secret: true } : {}),
          }))
        : [];
      for (const coll of S.collections.list) await secretsOf(coll.path);
      S.app.emit("env");
    },
    /** Use an environment (or none) for a collection. @param {Collection} coll @param {string | undefined} name */
    async use(coll, name) {
      if (name) active[coll.path] = name;
      else delete active[coll.path];
      await secretsOf(coll.path);
      await store("active-envs", active);
      S.app.emit("env");
    },
    /** Write an environment's file and its secrets. @param {Collection} coll @param {Env} env @param {Var[]} vars */
    async save(coll, env, vars) {
      const kept = await secretsOf(coll.path);
      kept[env.name] = Object.fromEntries(
        vars.filter((v) => v.secret && v.key).map((v) => [v.key, v.value]),
      );
      await store(`secrets.${hashKey(coll.path)}`, kept);
      await S.collections.files.write(env.path, text(envFile({ ...env, vars })), coll.path);
      await S.collections.reload(coll.path);
      S.app.emit("env");
    },
    /** A new environment in a collection, copying another's variables (secrets empty). @param {Collection} coll @param {string} name @param {Env} [from] */
    async create(coll, name, from) {
      const path = await freeName(
        S.collections.files,
        join(coll.path, ENV_DIR),
        name,
        ENV_EXT,
        coll.path,
      );
      const vars = (from?.vars ?? [{ id: uid("p"), on: true, key: "baseUrl", value: "" }]).map(
        (v) => ({ ...v, id: uid("p") }),
      );
      await S.collections.files.write(
        path,
        text(
          envFile({
            path,
            name,
            vars,
            color: from?.color ?? COLORS[coll.envs.length % COLORS.length],
          }),
        ),
        coll.path,
      );
      await S.collections.reload(coll.path);
      return S.collections.byPath(coll.path)?.envs.find((e) => e.path === path);
    },
    /** @param {Collection} coll @param {Env} env */
    async remove(coll, env) {
      await S.collections.files.trash(env.path, coll.path);
      const kept = await secretsOf(coll.path);
      delete kept[env.name];
      await store(`secrets.${hashKey(coll.path)}`, kept);
      if (active[coll.path] === env.name) await api.use(coll, undefined);
      await S.collections.reload(coll.path);
    },
    /** @param {Var[]} vars */
    async saveGlobals(vars) {
      globals = vars;
      await store(
        "globals",
        vars.map(({ id: _id, ...v }) => v),
      );
      S.app.emit("env");
    },
    /** Set a variable while running: in the active environment when it has the name, else at runtime. @param {Tab} tab @param {string} key @param {string} value */
    setFromRun(tab, key, value) {
      const coll = collOf(tab);
      const env = activeEnv(coll);
      if (coll && env?.vars.some((v) => v.key === key && v.secret)) {
        const kept = secrets.get(coll.path) ?? {};
        kept[env.name] = { ...(kept[env.name] ?? {}), [key]: value };
        secrets.set(coll.path, kept);
        void store(`secrets.${hashKey(coll.path)}`, kept);
      } else if (S.setRuntime) S.setRuntime(tab, key, value);
      else S.runtime.values.set(key, value);
      S.app.emit("env");
    },
  };

  S.envScopes = (/** @type {Tab} */ tab) => {
    const coll = collOf(tab) ?? (tab.ref ? undefined : S.collections.list[0]);
    const env = activeEnv(coll);
    if (!coll || !env) return [];
    const vars = varsOf(coll, env);
    return [scope("env", env.name, vars, new Set(vars.filter((v) => v.secret).map((v) => v.key)))];
  };
  S.globalScopes = () => [
    scope("global", "Global", globals, new Set(globals.filter((v) => v.secret).map((v) => v.key))),
  ];
  return api;
}

/** @typedef {ReturnType<typeof createEnvironments>} Environments */
