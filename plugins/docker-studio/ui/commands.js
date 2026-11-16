// The studio's commands for the palette and agents (ADR 0088): reads answer with plain data (the
// engine, containers, a container's detail and logs, images, stacks); changes go through the same
// actions as the buttons, and the irreversible ones are marked so in the manifest, so an agent's
// call waits for approval. Commands that open the window (open, cleanup, ask, build) are the
// palette's.

import { problemOf, stackState, stateLabel } from "./model.js";
import { imageRef, objectRef, projectName } from "./refs.js";

/** @typedef {import("./studio.js").App} App */

const OPS = new Set(["start", "stop", "restart", "pause", "unpause", "kill", "remove"]);
const STACK_OPS = new Set(["up", "start", "stop", "restart", "pull"]);
const SECTIONS = new Set([
  "dashboard",
  "containers",
  "images",
  "volumes",
  "networks",
  "compose",
  "builds",
  "hub",
  "contexts",
  "settings",
]);

/** A container as data for an agent. @param {import("./parse.js").Container} c */
export function containerData(c) {
  return {
    name: c.name,
    id: c.id.slice(0, 12),
    image: c.image,
    state: c.state,
    status: stateLabel(c),
    health: c.health || undefined,
    exitCode: c.state === "exited" ? c.exitCode : undefined,
    problem: problemOf(c)?.text,
    stack: c.project || undefined,
    service: c.service || undefined,
    ports: c.ports.map((p) => `${p.host}:${p.container}/${p.proto}`),
    started: c.startedAt ? new Date(c.startedAt).toISOString() : undefined,
  };
}

/** @param {any} ctx @param {App} app */
export function wireCommands(ctx, app) {
  const on = (/** @type {string} */ name, /** @type {(args: any) => unknown} */ fn) =>
    ctx.commands?.on?.(`endue.docker-studio.${name}`, (/** @type {any} */ args) => fn(args ?? {}));
  const state = () => app.store.state;
  /** Wait until the engine answers (a command can come before the window has read anything). */
  const ready = async () => {
    if (state().engine.status !== "up") await app.live.refresh();
    if (state().engine.status !== "up")
      throw new Error(state().engine.problem || "No Docker engine answers.");
  };
  const find = (/** @type {unknown} */ ref) => {
    const name = objectRef(ref);
    const c = state().containers.find((x) => x.name === name || x.id.startsWith(name));
    if (!c) throw new Error(`No container is called ${name}.`);
    return c;
  };

  on("open", (args) => {
    ctx.surface?.show?.();
    if (args.section && SECTIONS.has(args.section)) app.go(args.section);
    if (args.container) app.open({ kind: "container", id: find(args.container).id });
    return { section: state().page };
  });
  on("refresh", async () => {
    await app.live.refresh();
    return { engine: state().engine.status };
  });
  on("state", async () => {
    await ready();
    const s = state();
    const info = s.engine.info;
    return {
      engine: info
        ? {
            version: info.server,
            os: info.os,
            arch: info.arch,
            cpus: info.cpus,
            memory: info.memory,
            context: s.context || info.context,
          }
        : null,
      containers: {
        total: s.containers.length,
        running: s.containers.filter((c) => c.state === "running").length,
      },
      problems: s.containers
        .filter((c) => problemOf(c))
        .map((c) => ({ name: c.name, problem: problemOf(c)?.text })),
      images: s.images.length,
      volumes: s.volumes.length,
      stacks: app
        .stacks()
        .map((x) => ({ name: x.name, state: stackState(x), services: x.containers.length })),
      disk: Object.fromEntries(
        s.disk.map((d) => [d.kind, { size: d.size, reclaimable: d.reclaimable }]),
      ),
    };
  });
  on("containers", async (args) => {
    await ready();
    return state()
      .containers.filter(
        (c) => !args.state || c.state === args.state || (args.state === "problems" && problemOf(c)),
      )
      .map(containerData);
  });
  on("container", async (args) => {
    await ready();
    const c = find(args.container);
    return {
      ...containerData(c),
      command: c.command,
      restarts: c.restarts,
      mounts: c.mounts.map((m) => ({
        type: m.type,
        source: m.name || m.source,
        target: m.destination,
        readOnly: !m.rw,
      })),
      networks: c.networks.map((n) => ({ name: n.name, ip: n.ip })),
      environment: c.env.map((e) => e.split("=")[0]),
    };
  });
  on("logs", async (args) => {
    await ready();
    const c = find(args.container);
    const tail = Math.min(2000, Math.max(1, Number(args.tail) || 200));
    const { stdout, stderr } = await app.docker(
      ["logs", "--tail", String(tail), "--timestamps", "--", c.id],
      { timeoutMs: 30_000 },
    );
    return { container: c.name, lines: `${stdout}\n${stderr}`.split("\n").filter(Boolean).sort() };
  });
  on("act", async (args) => {
    await ready();
    if (!OPS.has(args.action))
      throw new Error(`${args.action} is not one of ${[...OPS].join(", ")}.`);
    const list = (Array.isArray(args.containers) ? args.containers : [args.containers]).map(find);
    const ok = await app.act.container(
      args.action,
      list.map((c) => ({ id: c.id, name: c.name, state: c.state })),
    );
    return { done: ok, containers: list.map((c) => c.name) };
  });
  on("images", async () => {
    await ready();
    return state().images.map((i) => ({
      refs: i.refs,
      id: i.id.slice(7, 19),
      size: i.size,
      created: new Date(i.created).toISOString(),
      dangling: i.dangling,
    }));
  });
  on("pull", async (args) => {
    await ready();
    const ref = imageRef(args.image);
    const ok = await app.images.transfer("pull", ref, () => {});
    return { pulled: ok ? ref : null };
  });
  on("run", async (args) => {
    await ready();
    const { formFor, runArgs } = await import("./images.js");
    const form = formFor(imageRef(args.image));
    form.name = args.name ?? "";
    form.ports = (args.ports ?? []).map((/** @type {string} */ p) => {
      const [host = "", container = ""] = String(p).split(":");
      return { host: container ? host : "", container: container || host, proto: "tcp" };
    });
    form.env = Object.entries(args.env ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    form.command = args.command ?? "";
    const ok = await app.images.run(runArgs(form), form.name || form.image);
    return { started: ok };
  });
  on("stacks", async () => {
    await ready();
    return app.stacks().map((s) => ({
      name: s.name,
      state: stackState(s),
      folder: s.dir,
      files: s.files,
      services: s.containers.map(containerData),
    }));
  });
  on("compose", async (args) => {
    await ready();
    if (!STACK_OPS.has(args.action))
      throw new Error(`${args.action} is not one of ${[...STACK_OPS].join(", ")}.`);
    return { done: await app.act.compose(args.action, projectName(args.stack)) };
  });
  on("compose-down", async (args) => {
    await ready();
    return { done: await app.act.compose("down", projectName(args.stack)) };
  });
  on("diagnose", (args) => {
    ctx.surface?.show?.();
    app.ai.diagnose(find(args.container).id);
    return { opened: true };
  });
  on("ask", (args) => {
    ctx.surface?.show?.();
    app.ai.open(typeof args.question === "string" ? args.question : "");
    return { opened: true };
  });
  on("cleanup", () => {
    ctx.surface?.show?.();
    app.dialogs.cleanup();
    return { opened: true };
  });
  on("build", (args) => {
    ctx.surface?.show?.();
    app.dialogs.build({
      context: typeof args.context === "string" ? args.context : "",
      tag: typeof args.tag === "string" ? args.tag : "",
    });
    return { opened: true };
  });
}
