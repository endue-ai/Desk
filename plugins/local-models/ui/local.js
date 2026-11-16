// Models on this computer, run by the built-in engine: the library of .gguf files, this computer's
// memory, each model's load settings (kept per file), loading one with llama-server and choosing it,
// ejecting it, and the models folders.
import { createDownloads } from "./downloads.js";
import { createEngine } from "./engine.js";
import { createLibrary, MODELS_DIR } from "./library.js";
import { fitOf, gpuLayersFor, needBytes, systemMemory } from "./memory.js";
import * as ollama from "./ollama.js";
import { createProcs } from "./proc.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./library.js").LocalModel} LocalModel
 * @typedef {import("./engine.js").LoadConfig} LoadConfig
 * @typedef {Omit<import("./engine.js").Instance, "kill" | "log"> & { lines: number }} EngineView
 */

/** A stable, short key for a path in the store. @param {string} path */
export function pathKey(path) {
  let h = 2166136261;
  for (const ch of path) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}

/** The name a loaded file answers to: its file name without .gguf. @param {LocalModel} m */
export const aliasOf = (m) => m.file.replace(/(-\d{5}-of-\d{5})?\.gguf$/i, "");

/** @param {App} app */
export function createLocal(app) {
  const { S, store } = app;
  const bridge = store.bridge;
  const procs = createProcs(bridge);
  const library = createLibrary(store);
  /** @type {Record<string, LoadConfig>} */
  let configs = {};
  const engine = createEngine({
    procs,
    sockets: app.sockets,
    program: () => S.get().enginePath || "llama-server",
    onChange: (list) =>
      S.set({
        engines: list.map(({ kill: _k, log, ...rest }) => ({ ...rest, lines: log.length })),
      }),
  });
  app.setExtraServers(() =>
    engine
      .list()
      .filter((i) => i.state === "ready")
      .map((i) => ({
        host: "127.0.0.1",
        port: i.port,
        kind: /** @type {const} */ ("openai"),
        label: `Built-in · ${i.alias}`,
        managed: true,
      })),
  );

  const downloads = createDownloads({
    S,
    bridge,
    procs,
    store,
    toast: app.toast,
    pull: async (d, onProgress, signal) => {
      const server = S.get().servers.find((s) => s.id === d.server && s.kind === "ollama");
      if (!server) throw new Error("Ollama is not answering.");
      await ollama.pull(app.sockets, server, d.name, onProgress, signal);
    },
    onDone: (d) => {
      if (d.kind === "ollama") {
        void app.refreshModels(/** @type {string} */ (d.server));
        app.toast(`${d.name} is in Ollama.`, "success");
      } else {
        void scan();
        app.toast(
          `${d.name} is downloaded. Load it from My models or the model picker.`,
          "success",
        );
      }
    },
  });

  async function scan() {
    S.set({ libraryScanning: true });
    const folders = [MODELS_DIR, ...S.get().folders.filter((f) => f !== MODELS_DIR)];
    const local = await library.scan(folders).catch((e) => {
      app.toast(
        `Could not read the models folders: ${e instanceof Error ? e.message : e}`,
        "error",
      );
      return S.get().local;
    });
    S.set({ local, libraryScanning: false });
  }

  async function start() {
    const [folders, saved, path] = await Promise.all([
      store.get("folders"),
      store.get("load-configs"),
      store.get("engine-path"),
    ]);
    configs = saved && typeof saved === "object" ? saved : {};
    S.set({
      folders: Array.isArray(folders) ? folders : [],
      enginePath: typeof path === "string" ? path : "",
    });
    const memory = await systemMemory((c, a) => procs.run(c, a)).catch(() => undefined);
    S.set({ memory });
    await Promise.all([scan(), downloads.start()]);
  }

  /** The settings a model loads with: the person's for that file, else ones that fit. @param {LocalModel} m @returns {LoadConfig} */
  function configFor(m) {
    const saved = configs[pathKey(m.path)];
    if (saved) return { ...saved };
    const ctx = Math.min(m.info?.ctx ?? 4096, 8192);
    const shape = { ...m.info, size: m.size };
    return {
      ctx,
      gpuLayers: gpuLayersFor(shape, needBytes(shape, { ctx }), S.get().memory) ?? 999,
      flashAttention: true,
      cacheType: "f16",
      mmap: true,
      mlock: false,
    };
  }

  /** @param {LocalModel} m @param {LoadConfig} config */
  function fitFor(m, config) {
    const need = needBytes(
      { ...m.info, size: m.size },
      { ctx: config.ctx, cache: config.cacheType },
    );
    return { need, fit: fitOf(need, S.get().memory) };
  }

  /** @param {string} path @param {LoadConfig} config */
  async function saveConfig(path, config) {
    configs = { ...configs, [pathKey(path)]: config };
    await store.set("load-configs", configs);
  }

  /** The loaded instance of a file, if any. @param {string} path */
  const instanceOf = (path) => engine.list().find((i) => i.path === path && i.state !== "failed");

  /**
   * Load a model file and make it the chat's model.
   * @param {LocalModel} m @param {LoadConfig} [config] @param {{ choose?: boolean }} [o]
   */
  async function load(m, config = configFor(m), o = {}) {
    const running = instanceOf(m.path);
    const alias = aliasOf(m);
    if (!running) {
      app.toast(`Loading ${m.name}…`);
      try {
        await engine.load({ path: m.path, alias, config, projector: m.projector });
      } catch (e) {
        app.toast(e instanceof Error ? e.message : String(e), "error");
        return undefined;
      }
    }
    await app.scan();
    const loaded = S.get().models.find(
      (x) => x.id === alias && S.get().servers.find((s) => s.id === x.serverId)?.managed,
    );
    if (loaded && o.choose !== false) app.choose(`${loaded.serverId}|${loaded.id}`);
    if (!running) app.toast(`${m.name} is ready.`, "success");
    return loaded;
  }

  /** @param {string} id */
  async function eject(id) {
    await engine.eject(id);
    await app.scan();
  }

  /** @param {string} folder */
  async function addFolder(folder) {
    const folders = [...new Set([...S.get().folders, folder.replace(/\/+$/, "")])];
    S.set({ folders });
    await store.set("folders", folders);
    await scan();
  }

  /** @param {string} folder */
  async function removeFolder(folder) {
    const folders = S.get().folders.filter((f) => f !== folder);
    S.set({ folders });
    await store.set("folders", folders);
    await scan();
  }

  /** Eject a model if loaded, then move its files to the trash. @param {LocalModel} m */
  async function remove(m) {
    const running = instanceOf(m.path);
    if (running) await eject(running.id);
    await library.remove(m);
    await scan();
    app.toast(`${m.name} is in the Trash.`, "success");
  }

  /** @param {string} path */
  async function setEnginePath(path) {
    S.set({ enginePath: path.trim() });
    await store.set("engine-path", path.trim());
  }

  return {
    start,
    scan,
    configFor,
    fitFor,
    saveConfig,
    load,
    eject,
    addFolder,
    removeFolder,
    remove,
    setEnginePath,
    instanceOf,
    /** @param {string} id */
    logOf: (id) => engine.get(id)?.log ?? [],
    dismiss: (/** @type {string} */ id) => engine.dismiss(id),
    procs,
    downloads,
  };
}

/** @typedef {ReturnType<typeof createLocal>} Local */
