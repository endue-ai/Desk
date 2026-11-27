// Edits to open drafts and collections use the Studio's regular save and import paths.
import { pair } from "./model.js";
import { hideValues, isSecretName } from "./secret-names.js";

/** @param {import("./commands.js").Register} on @param {import("./commands.js").CommandContext} ctx */
export function registerEdits(on, { S, findTab, collection }) {
  /** @type {Promise<void>} */
  let writing = Promise.resolve();
  /** @template T @param {() => Promise<T>} edit */
  const write = (edit) => {
    const result = writing.then(edit);
    writing = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  on("save-request", ({ name, collection: selected, folder }) =>
    write(async () => {
      const tab = findTab(name);
      if (folder !== undefined && selected === undefined)
        throw new Error("Name the collection for this folder.");
      if (!selected && !tab.ref) throw new Error("Choose an open collection for this request.");
      const destination =
        selected === undefined ? undefined : { collection: collection(selected).path, folder };
      if (!(await S.save(tab, destination))) throw new Error("The request was not saved.");
      return { saved: tab.req.name, path: tab.ref?.path ?? null };
    }),
  );
  on("use-environment", async ({ collection: selected, name }) => {
    const coll = collection(selected);
    if (name && !coll.envs.some((env) => env.name === name))
      throw new Error("Choose an environment in that collection.");
    await S.envs.use(coll, name || undefined);
    return { environment: name || null };
  });
  on("set-variable", ({ collection: selected, environment, key, value }) =>
    write(async () => {
      if (typeof key !== "string" || !/^[a-z_][\w.-]*$/iu.test(key) || isSecretName(key))
        throw new Error("Give a non-secret variable name.");
      if (typeof value !== "string") throw new Error("Give a text value.");
      const coll = collection(selected);
      const env =
        environment === undefined
          ? S.envs.activeEnv(coll)
          : coll.envs.find((env) => env.name === environment);
      if (!env) throw new Error("Choose an environment in that collection.");
      const vars = /** @type {(import("./model.js").Pair & { secret?: boolean })[]} */ (
        S.envs.varsOf(coll, env)
      );
      const existing = vars.find((variable) => variable.key === key);
      const protectedValues = vars
        .filter((variable) => variable.secret && variable.value)
        .map((variable) => variable.value);
      if (existing?.secret || hideValues(value, protectedValues) !== value)
        throw new Error("This command cannot change or copy a secret.");
      const updated = existing
        ? vars.map((variable) => (variable === existing ? { ...variable, value } : variable))
        : [...vars, pair({ key, value })];
      await S.envs.save(coll, env, updated);
      return { changed: key, environment: env.name };
    }),
  );
  on("import", ({ path, kind }) => S.importFile(path, kind));
}
