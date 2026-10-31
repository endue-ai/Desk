// What the Docker surface does to containers and images: start, stop, restart, pause, unpause, kill
// and remove a container, run one from an image, pull, remove and prune images. Every action checks
// its names (refs.js), confirms what cannot be undone through the desk's pick, says what happened
// and ends with a refresh. No DOM: the controller hands in what it needs, so the SDK's test host
// runs it against a scripted docker.

import { imageRef, listOf, objectRef, runArgs } from "./refs.js";

/**
 * @typedef {import("./settings.js").Settings} Settings
 * @typedef {import("./run.js").RunOptions} RunOptions
 * @typedef {import("./run.js").Outcome} Outcome
 * @typedef {{ kind: "container", id: string, name: string, state: string, project: string }
 *   | { kind: "image", id: string, ref: string, dangling: boolean, containers: number | null }
 *   | { kind: "volume", name: string }
 *   | { kind: "network", id: string, name: string, builtin: boolean }
 *   | { kind: "project", name: string, files: string[] }
 *   | { kind: "section", section: string }
 *   | { kind: "field", section: string, label: string }} Item
 * @typedef {{ id: string, label: string, detail?: string }} PickItem
 * @typedef {{
 *   docker(args: string[], options?: RunOptions): Promise<Outcome>,
 *   cancel(): void,
 *   settings(): Settings,
 *   selection(): Item | undefined,
 *   refresh(): Promise<void>,
 *   say(text: string): void,
 *   pick(title: string, items: PickItem[], free?: boolean, placeholder?: string): Promise<string | undefined>,
 *   expect(id: string): void,
 *   cancelled(message: string): Error,
 * }} Deps
 * @typedef {Record<string, unknown>} Args
 */

/** The parts every group of actions shares: confirming, finishing, and finding what to act on. */
export function basics(/** @type {Deps} */ deps) {
  /** Ask before something that cannot be undone; `confirm: false` in the settings skips the ask. */
  const confirm = async (/** @type {string} */ question, /** @type {string} */ yes) => {
    if (!deps.settings().confirm) return true;
    const answer = await deps.pick(question, [
      { id: "yes", label: yes },
      { id: "no", label: "Keep everything as it is" },
    ]);
    return answer === "yes";
  };

  /** Ask, and end the command as cancelled on anything but yes. */
  const ensure = async (/** @type {string} */ question, /** @type {string} */ yes) => {
    if (!(await confirm(question, yes))) throw deps.cancelled("Nothing was changed.");
  };

  const done = async (/** @type {string} */ words) => {
    // The change happened: a screen that fails to read again does not make it a failure.
    await deps.refresh().catch(() => {});
    deps.say(words);
    return words;
  };

  /**
   * The object a command is about: the one its args name, else the selection when it is of `kind`.
   * @template {Item["kind"]} K
   * @param {Args} args
   * @param {K} kind
   * @param {string} key The args key that names one.
   * @returns {Extract<Item, { kind: K }> | { kind: K, named: string }}
   */
  const target = (args, kind, key) => {
    const named = args[key];
    if (named !== undefined) return { kind, named: String(named) };
    const item = deps.selection();
    if (item?.kind === kind) return /** @type {Extract<Item, { kind: K }>} */ (item);
    throw new Error(`Select a ${kind}, or name one with ${key}.`);
  };

  return { confirm, ensure, done, target };
}

/** @param {Deps} deps */
export function createActions(deps) {
  const { docker, say } = deps;
  const { ensure, done, target } = basics(deps);

  /** The container a command is about, checked: its id or name and how it reads. */
  const container = (/** @type {Args} */ args) => {
    const found = target(args, "container", "container");
    if ("named" in found) {
      const ref = objectRef(found.named);
      return { ref, name: ref, state: "" };
    }
    return { ref: found.id, name: found.name, state: found.state };
  };

  const stopTimeout = () => String(deps.settings().stopTimeout);
  /** Waits long enough for docker's own stop timeout, then some. */
  const lifecycleTimeout = () => (deps.settings().stopTimeout + 30) * 1000;

  /**
   * @param {"start" | "stop" | "restart" | "pause" | "unpause"} verb
   * @param {string} past
   */
  const lifecycle =
    (verb, past) =>
    async (/** @type {Args} */ args = {}) => {
      const { ref, name } = container(args);
      const timed = verb === "stop" || verb === "restart";
      if (timed) deps.expect(ref);
      await docker([verb, ...(timed ? ["-t", stopTimeout()] : []), "--", ref], {
        timeoutMs: lifecycleTimeout(),
      });
      return done(`${past} ${name}.`);
    };

  /** @param {Args} [args] */
  const kill = async (args = {}) => {
    const { ref, name } = container(args);
    await ensure(
      `Kill ${name}? Its processes end at once, without a chance to clean up.`,
      `Kill ${name}`,
    );
    deps.expect(ref);
    await docker(["kill", "--", ref]);
    return done(`Killed ${name}.`);
  };

  /** @param {Args} [args] `volumes: true` also removes its anonymous volumes. */
  const remove = async (args = {}) => {
    const { ref, name, state } = container(args);
    const live = state === "running" || state === "paused" || state === "restarting";
    const volumes = args.volumes === true;
    const also = volumes ? " Its anonymous volumes go with it." : "";
    await ensure(
      live
        ? `Remove ${name}? It is ${state}: it is stopped first.${also}`
        : `Remove ${name}?${also}`,
      `Remove ${name}`,
    );
    deps.expect(ref);
    await docker(
      ["rm", ...(live || args.force === true ? ["-f"] : []), ...(volumes ? ["-v"] : []), "--", ref],
      {
        timeoutMs: lifecycleTimeout(),
      },
    );
    return done(`Removed ${name}.`);
  };

  /** Pause a running container, unpause a paused one. */
  const togglePause = async (/** @type {Args} */ args = {}) => {
    const { state } = container(args);
    return state === "paused" ? unpause(args) : pause(args);
  };

  /** The image a command is about: named, selected, or (`ask`) asked for. */
  const image = async (/** @type {Args} */ args, /** @type {string} */ question) => {
    if (args.image !== undefined) {
      const ref = imageRef(args.image);
      return { ref, used: null, label: ref, dangling: false };
    }
    const item = deps.selection();
    if (item?.kind === "image")
      return {
        ref: item.dangling ? item.id : item.ref,
        used: item.containers,
        label: item.ref,
        dangling: item.dangling,
      };
    const typed = await deps.pick(
      question,
      [],
      true,
      "an image, like nginx:1.27 or ghcr.io/org/app",
    );
    if (typed === undefined || typed.trim() === "") throw deps.cancelled("Nothing was changed.");
    const ref = imageRef(typed);
    return { ref, used: null, label: ref, dangling: false };
  };

  /** @param {Args} [args] */
  const pull = async (args = {}) => {
    const { ref, dangling } = await image(args, "Docker: pull which image?");
    if (dangling) throw new Error("A dangling image has no name to pull by.");
    say(`Pulling ${ref}…`);
    await docker(["pull", "--", ref], { timeoutMs: 0 });
    return done(`Pulled ${ref}.`);
  };

  /** @param {Args} [args] */
  const removeImage = async (args = {}) => {
    const { ref, used, label } = await image(args, "Docker: remove which image?");
    if (used !== null && used > 0)
      throw new Error(
        `${label} is used by ${used} container${used === 1 ? "" : "s"}: remove ${used === 1 ? "it" : "them"} first.`,
      );
    await ensure(`Remove the image ${label}?`, `Remove ${label}`);
    await docker(["image", "rm", "--", ref]);
    return done(`Removed the image ${label}.`);
  };

  /** @param {Args} [args] `all: true` removes every image no container uses, not only dangling ones. */
  const pruneImages = async (args = {}) => {
    const all = args.all === true;
    await ensure(
      all
        ? "Remove every image no container uses? They are pulled or built again when needed."
        : "Remove every dangling image (untagged layers left by builds and pulls)?",
      "Remove them",
    );
    const { stdout } = await docker(["image", "prune", "-f", ...(all ? ["-a"] : [])], {
      timeoutMs: 0,
    });
    return done(reclaimed(stdout, "No image was removed."));
  };

  /**
   * Start a new container from an image. From the keyboard, asks for a name and ports; agents pass
   * the whole spec (image, name, ports, env, volumes, restart, command).
   * @param {Args} [args]
   */
  const run = async (args = {}) => {
    /** @type {import("./refs.js").RunSpec} */
    let spec;
    if (args.image !== undefined)
      spec = /** @type {any} */ ({ ...args, image: String(args.image) });
    else {
      const { ref } = await image({}, "Docker: run which image?");
      const name = await deps.pick(
        `Docker: name the container from ${ref} (empty: docker picks)`,
        [],
        true,
        "a name",
      );
      if (name === undefined) throw deps.cancelled("Nothing was started.");
      const ports = await deps.pick(
        "Docker: publish which ports? (8080:80, comma-separated; empty: none)",
        [],
        true,
        "host:container",
      );
      if (ports === undefined) throw deps.cancelled("Nothing was started.");
      spec = { image: ref, name: name.trim(), ports: listOf(ports) };
    }
    const argv = runArgs(spec);
    say(`Starting ${spec.image}…`);
    const { stdout } = await docker(argv, { timeoutMs: 0 });
    const id = stdout.trim().split("\n").pop() ?? "";
    await done(`Started ${spec.name || id.slice(0, 12)} from ${spec.image}.`);
    return { id, name: spec.name || null };
  };

  const pause = lifecycle("pause", "Paused");
  const unpause = lifecycle("unpause", "Unpaused");

  return {
    start: lifecycle("start", "Started"),
    stop: lifecycle("stop", "Stopped"),
    restart: lifecycle("restart", "Restarted"),
    pause,
    unpause,
    togglePause,
    kill,
    remove,
    pull,
    removeImage,
    pruneImages,
    run,
    cancel: () => {
      deps.cancel();
      say("Cancelled.");
    },
  };
}

/** docker's "Total reclaimed space: 1.2GB" as a sentence, or `none` when nothing went. */
export function reclaimed(/** @type {string} */ stdout, /** @type {string} */ none) {
  const space = /Total reclaimed space:\s*(\S+)/.exec(stdout)?.[1];
  if (!space || /^0(\.0+)?B$/.test(space)) return none;
  return `Freed ${space}.`;
}
