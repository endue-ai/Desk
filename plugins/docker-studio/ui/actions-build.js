// The builds the studio runs: each one docker build with its steps followed as they come, which
// pages listen to; the last twenty kept (steps, times, the failure) across reloads; and the build
// cache cleared on request.

import { buildArgs, createBuild, summary } from "./build.js";
import { bytes } from "./format.js";

/**
 * @typedef {import("./build.js").BuildForm} BuildForm
 * @typedef {{ id: string, tag: string, context: string, started: number, ended: number,
 *   status: "running" | "ok" | "failed" | "cancelled", summary: string, error: string, image: string,
 *   steps: Array<{ name: string, stage: string, status: string, seconds: number }>, form: BuildForm }} BuildRecord
 */

const KEEP = 20;

/** @param {import("./studio.js").App} app */
export function createBuilds(app) {
  const saved = app.prefs("builds", { history: /** @type {BuildRecord[]} */ ([]) });
  /** @type {Map<string, { record: BuildRecord, model: ReturnType<typeof createBuild>, cancel(): void }>} */
  const active = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  let queued = false;
  const changed = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      for (const fn of [...listeners]) fn();
    });
  };
  const keep = () => {
    saved.history = saved.history.slice(0, KEEP);
    app.savePrefs("builds", saved);
  };

  /** Start a build; resolves with its record when it ends. @param {BuildForm} form */
  const start = async (form) => {
    const args = buildArgs(form);
    const id = `b${Date.now().toString(36)}`;
    const model = createBuild();
    /** @type {BuildRecord} */
    const record = {
      id,
      tag: form.tag.trim() || "(untagged)",
      context: form.context,
      started: Date.now(),
      ended: 0,
      status: "running",
      summary: "",
      error: "",
      image: "",
      steps: [],
      form,
    };
    let stop = () => {};
    active.set(id, { record, model, cancel: () => stop() });
    changed();
    const job = app.docker(args, {
      cwd: form.context,
      timeoutMs: 0,
      onLine: (_stream, line) => {
        model.push(line);
        changed();
      },
    });
    stop = () => app.runner.cancel();
    try {
      await job;
      record.status = "ok";
      app.toast(`Built ${record.tag}.`, "success");
      void app.engine.load("images");
      void app.engine.load("disk");
    } catch (error) {
      const e = /** @type {any} */ (error);
      record.status = e?.cancelled ? "cancelled" : "failed";
      record.error = model.error || String(e?.message ?? e);
      if (!e?.cancelled) app.toast(`The build of ${record.tag} failed.`, "danger");
    }
    record.ended = Date.now();
    record.summary = summary(model);
    record.image = model.image;
    record.steps = model.steps.map((s) => ({
      name: s.name,
      stage: s.stage,
      status: s.status,
      seconds: s.seconds,
    }));
    active.delete(id);
    saved.history.unshift(record);
    keep();
    lastModels.set(id, model);
    changed();
    return record;
  };

  /** The full models of builds that ended this session, for their output. */
  /** @type {Map<string, ReturnType<typeof createBuild>>} */
  const lastModels = new Map();

  const pruneCache = async () => {
    const cache = app.store.state.disk.find((d) => d.kind === "cache");
    const yes = await app.overlay.confirm({
      title: "Clear the build cache?",
      text: `${cache ? `${bytes(cache.reclaimable)} of ${bytes(cache.size)} can go. ` : ""}The next builds run every step again, so they take longer once.`,
      ok: "Clear the cache",
      danger: true,
    });
    if (!yes) return;
    try {
      const { stdout } = await app.docker(["builder", "prune", "--force"], { timeoutMs: 0 });
      const freed = /Total:\s*(.+)/.exec(stdout)?.[1] ?? "";
      app.toast(`Cleared the build cache${freed ? `: ${freed}` : ""}.`, "success");
    } catch (error) {
      app.toast(String(/** @type {any} */ (error)?.message ?? error), "danger");
    } finally {
      void app.engine.load("disk");
    }
  };

  return {
    start,
    pruneCache,
    active: () => [...active.values()],
    history: () => saved.history,
    model: (/** @type {string} */ id) => active.get(id)?.model ?? lastModels.get(id),
    cancel: (/** @type {string} */ id) => active.get(id)?.cancel(),
    forget(/** @type {string} */ id) {
      saved.history = saved.history.filter((r) => r.id !== id);
      keep();
      changed();
    },
    /** @param {() => void} fn */
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
