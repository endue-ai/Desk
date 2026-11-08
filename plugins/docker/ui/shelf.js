// What each list holds now: read with its loader (lists.js), drawn, and kept until an event or a
// context switch makes it stale. A read that a newer read of the same list overtook is not drawn.
// The overview draws twice: once its lists are in, and again with disk use, which can take seconds.

import { overviewModel } from "./overview.js";

/**
 * @typedef {import("./docker.js").ListName} ListName
 * @typedef {import("./overview.js").Sources} Sources
 */

/**
 * @param {object} deps
 * @param {ReturnType<typeof import("./lists.js").createLoaders>} deps.loaders
 * @param {{ list(name: ListName, model: unknown): void }} deps.view
 * @param {ReturnType<typeof import("./engine.js").createEngine>} deps.engine
 * @param {() => Map<string, import("./parse-engine.js").Stats>} deps.stats The latest resource use.
 * @param {() => string} deps.context
 * @param {() => boolean} deps.all Whether the containers list shows stopped ones too.
 */
export function createShelf({ loaders, view, engine, stats, context, all }) {
  /** @type {Partial<Record<ListName, any>>} */
  const models = {};
  /** @type {Partial<Record<ListName, number>>} */
  const loads = {};
  /** The last disk use read, kept while it is read again. @type {import("./parse-engine.js").DiskUse[] | null} */
  let disk = null;

  const draw = (/** @type {ListName} */ name, /** @type {unknown} */ model) => {
    models[name] = model;
    view.list(name, model);
  };

  /** The overview of what was read, with the engine as the controller knows it. */
  const overviewOf = (/** @type {Sources} */ sources) =>
    overviewModel({
      ...sources,
      disk,
      version: engine.version(),
      context: context(),
      problem: engine.problem(),
    });

  const overview = async (/** @type {number} */ mine) => {
    /** @type {Sources} */
    let sources = {};
    try {
      sources = await loaders.overview();
      engine.ok();
    } catch (error) {
      if (mine === loads.overview) draw("overview", overviewOf({}));
      throw error;
    }
    if (mine !== loads.overview) return models.overview;
    draw("overview", overviewOf(sources));
    disk = await loaders.disk().catch(() => null);
    if (mine === loads.overview) draw("overview", overviewOf(sources));
    return models.overview;
  };

  return {
    models,
    draw,
    overviewOf,
    /** Read a list and draw it, unless a newer read of the same list came back first. */
    async load(/** @type {ListName} */ name) {
      const mine = (loads[name] ?? 0) + 1;
      loads[name] = mine;
      if (name === "overview") return overview(mine);
      const model =
        name === "containers"
          ? { ...(await loaders.containers(all())), stats: stats() }
          : await loaders[name]();
      if (mine !== loads[name]) return models[name];
      engine.ok();
      draw(name, model);
      return model;
    },
    /** Forget every list (another context): each is read fresh when it shows. */
    clear() {
      for (const key of Object.keys(models)) delete models[/** @type {ListName} */ (key)];
      disk = null;
    },
  };
}
