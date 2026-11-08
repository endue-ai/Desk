// Eris's computer-use tools (ADR 0088, ADR 0123): each agent command of plugin.json as the
// computer.* calls it makes. Every act carries the invocation it serves, so the core holds it as
// the agent's (the person's approval card, the run with its screenshot), and the scope the person's
// app list allows. Plain functions over a bridge, tested on the SDK's test host.
import { outline, point, refOf } from "./outline.js";

/** @typedef {{ call(method: string, params: unknown): Promise<any> }} Bridge */
/** @typedef {{ see: object, control: object }} Scopes */
/** @typedef {{ invocationId: string, caller: string } | undefined} Invocation */

export const PREFIX = "endue.computer.";
/** The tools, by command id. */
export const TOOLS = [
  "look",
  "find",
  "click",
  "type",
  "keys",
  "scroll",
  "open",
  "switch",
  "apps",
].map((name) => PREFIX + name);
/** The tools that only read. */
export const READS = new Set(["look", "find", "apps"].map((name) => PREFIX + name));

/** A screenshot an agent reads: at most this many pixels. */
const SHOT = { maxWidth: 1280, maxHeight: 800 };

/** @param {unknown} raw */
const argsOf = (raw) =>
  /** @type {Record<string, any>} */ (raw && typeof raw === "object" ? raw : {});

/**
 * @param {Bridge} bridge
 * @param {() => Scopes} scopes
 */
export function createTools(bridge, scopes) {
  /**
   * An act, as the agent's when an agent's invocation asked for it.
   * @param {string} method
   * @param {Record<string, unknown>} params
   * @param {Invocation} invocation
   */
  const act = (method, params, invocation) =>
    bridge.call(method, {
      ...params,
      ...(invocation ? { invocationId: invocation.invocationId } : {}),
      scope: scopes().control,
    });
  const see = (method, params = {}) => bridge.call(method, { ...params, scope: scopes().see });

  const running = async () => (await see("computer.apps.list")).apps;

  /** A running app by name, bundle id or pid. */
  const app = async (/** @type {unknown} */ wanted) => {
    const text = String(wanted ?? "").trim();
    if (!text) throw new Error("Say which app: its name, bundle id or pid.");
    const lower = text.toLowerCase();
    const apps = await running();
    const found = apps.find(
      (a) =>
        String(a.pid) === text ||
        a.bundleId?.toLowerCase() === lower ||
        a.name.toLowerCase() === lower,
    );
    return found;
  };

  /** The root of a read: the named app's element, or the frontmost app's focused window. */
  const rootOf = async (/** @type {unknown} */ wanted) => {
    if (wanted === undefined) return {};
    const found = await app(wanted);
    if (!found) throw new Error(`${wanted} is not running. Open it first.`);
    return { root: { pid: found.pid, path: [] } };
  };

  /** @type {Record<string, (args: Record<string, any>, invocation: Invocation) => Promise<unknown>>} */
  const run = {
    async look(args) {
      const root = await rootOf(args.app);
      const tree = await see("computer.ax.tree", { ...root, depth: args.depth ?? 8, nodes: 300 });
      const answer = {
        app: tree.app
          ? { name: tree.app.name, bundleId: tree.app.bundleId, pid: tree.pid }
          : undefined,
        elements: outline(tree.nodes, tree.pid),
        truncated: tree.truncated,
      };
      if (args.screenshot === false) return answer;
      const shot = await see("computer.screenshot", SHOT);
      const screen = {
        width: shot.width,
        height: shot.height,
        scale: shot.scale,
        bounds: shot.bounds,
      };
      return { ...answer, screen, image: shot.image, mediaType: shot.mediaType };
    },
    async find(args) {
      const root = await rootOf(args.app);
      const found = await see("computer.ax.find", {
        ...root,
        ...(args.role ? { role: args.role } : {}),
        ...(args.title ? { title: args.title } : {}),
        limit: args.limit ?? 20,
      });
      return { elements: outline(found.elements, found.pid) };
    },
    async click(args, invocation) {
      if (args.element) {
        const element = refOf(args.element);
        return done(await act("computer.ax.perform", { element, action: "press" }, invocation));
      }
      const at = point(args);
      const params = {
        ...at,
        ...(args.button ? { button: args.button } : {}),
        count: args.count ?? 1,
      };
      return done(await act("computer.input.click", params, invocation));
    },
    async type(args, invocation) {
      return done(await act("computer.input.type", { text: String(args.text ?? "") }, invocation));
    },
    async keys(args, invocation) {
      const keys = Array.isArray(args.keys) ? args.keys.map(String) : [String(args.keys ?? "")];
      return done(await act("computer.input.keys", { keys }, invocation));
    },
    async scroll(args, invocation) {
      const at = args.x === undefined ? {} : { at: point(args) };
      const params = { ...at, dx: args.dx ?? 0, dy: args.dy ?? 0 };
      return done(await act("computer.input.scroll", params, invocation));
    },
    async open(args, invocation) {
      const found = await app(args.app);
      if (found) return done(await act("computer.apps.activate", { pid: found.pid }, invocation));
      const id = String(args.app ?? "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/.test(id)) {
        throw new Error(`${id} is not running; give its bundle id, such as com.apple.Safari.`);
      }
      return done(await act("computer.apps.launch", { bundleId: id }, invocation));
    },
    async switch(args, invocation) {
      const found = await app(args.app);
      if (!found) throw new Error(`${args.app} is not running. Open it first.`);
      return done(await act("computer.apps.activate", { pid: found.pid }, invocation));
    },
    async apps() {
      const apps = await running();
      return {
        apps: apps
          .filter((a) => a.regular)
          .map((a) => ({ name: a.name, bundleId: a.bundleId, pid: a.pid, front: a.active })),
      };
    },
  };

  /**
   * Run tool `id` with `raw` args for `invocation`.
   * @param {string} id
   * @param {unknown} raw
   * @param {Invocation} invocation
   */
  return (id, raw, invocation) => {
    const tool = run[id.slice(PREFIX.length)];
    if (!tool) return Promise.reject(new Error(`no tool ${id}`));
    return tool(argsOf(raw), invocation);
  };
}

/** What an act tells the agent: what it did, and the app it reached. */
function done(/** @type {any} */ result) {
  const answer = { summary: result.summary };
  if (result.app)
    answer.app = { name: result.app.name, bundleId: result.app.bundleId, pid: result.app.pid };
  return answer;
}
