// The import graphs of the plugin frames (#38, ADR 0048): what a plugin's page loads on its main
// thread from ui/main.js, and what each worker it starts with `new URL("./x.js", import.meta.url)`
// loads. scripts/plugin-workers.test.mjs holds the audit in docs/qa/TESTING.md to them: a parser or
// decoder the audit put in a worker is never loaded on the main thread.
//   node scripts/plugin-workers.mjs [plugin]   print each plugin's worker graphs
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const PLUGINS = join(ROOT, "plugins");

/**
 * What the audit moved off the main thread, by plugin folder: the worker module the plugin starts and
 * every parser or decoder module only that worker may load. Plugins whose parsers also run in the
 * frame below a size (docs, slides, web, images, data) are not here: see the audit table.
 * @type {Record<string, { worker: string, modules: string[] }>}
 */
export const OFF_MAIN = {
  database: {
    worker: "ui/output-worker.js",
    modules: [
      "ui/output-worker.js",
      "ui/output/index.js",
      "ui/output/postgres.js",
      "ui/output/mysql.js",
      "ui/output/sqlite.js",
      "ui/output/csv.js",
      "ui/output/readers.js",
    ],
  },
  notes: { worker: "ui/count-worker.js", modules: ["ui/count-worker.js", "ui/count.js"] },
  player: {
    worker: "ui/software/worker.js",
    modules: ["ui/software/worker.js", "ui/software/reader.js", "ui/software/ffmpeg.js"],
  },
  sheets: {
    worker: "ui/worker.js",
    modules: [
      "ui/worker.js",
      "ui/book.js",
      "ui/ods.js",
      "ui/ods-parts.js",
      "ui/vendor/xlsx.mjs",
      "ui/vendor/cpexcel.full.mjs",
    ],
  },
};

// Comments go first: JSDoc types say `import("./x.js")` without loading anything.
const strip = (/** @type {string} */ source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const STATIC = /(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"']+)["']/g;
const DYNAMIC = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const WORKER = /new\s+URL\s*\(\s*["']([^"']+\.m?js)["']\s*,\s*import\.meta\.url\s*\)/g;

/**
 * The specifiers one module's source names: what it imports (statically or with `import("...")`)
 * and the module files it builds worker URLs for.
 * @param {string} source
 */
export function scan(source) {
  const text = strip(source);
  const all = (/** @type {RegExp} */ pattern) => [...text.matchAll(pattern)].map((m) => m[1] ?? "");
  return { imports: [...all(STATIC), ...all(DYNAMIC)], workers: all(WORKER) };
}

/** A relative specifier as a file path; anything else (bare, absolute, URL) is not followed. */
const resolveFrom = (/** @type {string} */ file, /** @type {string} */ spec) =>
  spec.startsWith("./") || spec.startsWith("../")
    ? join(dirname(file), spec.replace(/[?#].*$/, ""))
    : undefined;
/** A bare specifier needs an import map, which reaches the page but not its workers. */
const bare = (/** @type {string} */ spec) =>
  !spec.startsWith(".") && !/^(\/|[a-z][a-z0-9+.-]*:)/i.test(spec);

/**
 * Every module the entries load, the worker modules they start, and the bare specifiers named.
 * @param {string[]} entries absolute paths
 */
export function graph(entries) {
  /** @type {Set<string>} */
  const modules = new Set();
  /** @type {Set<string>} */
  const workers = new Set();
  /** @type {Array<{ file: string, spec: string }>} */
  const bares = [];
  const todo = [...entries];
  while (todo.length > 0) {
    const file = /** @type {string} */ (todo.pop());
    if (modules.has(file) || !existsSync(file)) continue;
    modules.add(file);
    const { imports, workers: started } = scan(readFileSync(file, "utf8"));
    for (const spec of imports) {
      const target = resolveFrom(file, spec);
      if (target) todo.push(target);
      else if (bare(spec)) bares.push({ file, spec });
    }
    for (const spec of started) {
      const target = resolveFrom(file, spec);
      if (target) workers.add(target);
    }
  }
  return { modules, workers, bares };
}

/** The plugin folders with a frame (ui/main.js), by name. */
export const framePlugins = () =>
  readdirSync(PLUGINS).filter((name) => existsSync(join(PLUGINS, name, "ui/main.js")));

/**
 * One plugin's page: its main-thread graph and the graph of each worker it starts.
 * @param {string} name plugin folder
 * @param {string} [root] where plugin folders are (tests point it at a fixture)
 */
export function pluginGraphs(name, root = PLUGINS) {
  const folder = join(root, name);
  const main = graph([join(folder, "ui/main.js")]);
  const rel = (/** @type {string} */ file) => relative(folder, file).split("\\").join("/");
  // A worker may start workers of its own (a library worker's decoders).
  /** @type {Map<string, ReturnType<typeof graph>>} */
  const workers = new Map();
  const todo = [...main.workers];
  while (todo.length > 0) {
    const entry = /** @type {string} */ (todo.pop());
    if (workers.has(rel(entry))) continue;
    const worker = graph([entry]);
    workers.set(rel(entry), worker);
    todo.push(...worker.workers);
  }
  return { main, workers, rel };
}

/**
 * What breaks the audit for one plugin: a declared worker the page never starts, a declared module
 * its worker does not load, or one the main thread loads.
 * @param {string} name
 * @param {{ worker: string, modules: string[] }} declared
 * @param {string} [root]
 */
export function offMainProblems(name, declared, root = PLUGINS) {
  const { main, workers, rel } = pluginGraphs(name, root);
  const onMain = new Set([...main.modules].map(rel));
  const worker = workers.get(declared.worker);
  /** @type {string[]} */
  const problems = [];
  if (!worker) problems.push(`${name}: ui/main.js never starts ${declared.worker}`);
  const inWorker = new Set([...(worker?.modules ?? [])].map(rel));
  for (const module of declared.modules) {
    if (worker && !inWorker.has(module))
      problems.push(`${name}: ${declared.worker} does not load ${module}`);
    if (onMain.has(module)) problems.push(`${name}: the main thread loads ${module}`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = process.argv[2];
  for (const name of framePlugins().filter((n) => !only || n === only)) {
    const { main, workers, rel } = pluginGraphs(name);
    if (workers.size === 0) continue;
    console.log(`${name}: ${main.modules.size} modules on the main thread`);
    for (const [entry, worker] of workers) {
      const shared = [...worker.modules].filter((m) => main.modules.has(m)).map(rel);
      console.log(
        `  ${entry}: ${worker.modules.size} modules, ${shared.length} also on the main thread`,
      );
    }
  }
}
