// What the Docker surface does to containers and images: start, stop, restart, pause, unpause, kill
// and remove a container (or every marked one, DOCK-19), run one from an image, pull with progress,
// remove and prune images with a preview of what goes. Every action checks its names (refs.js),
// confirms what cannot be undone through the desk's pick, says what happened and ends with a
// refresh. No DOM: the controller hands in what it needs, so the SDK's test host runs it against a
// scripted docker.

import { basics, names } from "./actions-base.js";
import { createPullProgress } from "./images.js";
import { previewImages } from "./preview.js";
import { imageRef, listOf, objectRef, runArgs } from "./refs.js";

export { basics, names } from "./actions-base.js";

/**
 * @typedef {import("./actions-base.js").Item} Item
 * @typedef {import("./actions-base.js").Deps} Deps
 * @typedef {import("./actions-base.js").Args} Args
 * @typedef {import("./actions-base.js").Target} Target
 */

/** @param {Deps} deps */
export function createActions(deps) {
  const { docker, say } = deps;
  const { ensure, done, target, many, bulk } = basics(deps);

  /** How a marked container reads as a target. */
  const fromItem = (/** @type {Extract<Item, { kind: "container" }>} */ item) => ({
    ref: item.id,
    name: item.name,
    state: item.state,
    item,
  });

  /** The container a command is about, checked: its id or name and how it reads. */
  const container = (/** @type {Args} */ args) => {
    const found = target(args, "container", "container");
    if ("named" in found) {
      const ref = objectRef(found.named);
      return { ref, name: ref, state: "" };
    }
    return fromItem(found);
  };

  /** One marked container acts alone, by its name; the marks it had go. */
  const single = (/** @type {Args} */ args) => {
    const marked = deps.marked().filter((item) => item.kind === "container");
    if (args.container !== undefined || args.containers !== undefined || marked.length !== 1)
      return container(args);
    deps.setMarks([]);
    return fromItem(/** @type {Extract<Item, { kind: "container" }>} */ (marked[0]));
  };

  const stopTimeout = () => String(deps.settings().stopTimeout);
  /** Waits long enough for docker's own stop timeout, then some. */
  const lifecycleTimeout = () => (deps.settings().stopTimeout + 30) * 1000;

  /**
   * A verb on the container a command is about, or on every one marked or listed. `one` acts on a
   * target already found.
   * @param {"start" | "stop" | "restart" | "pause" | "unpause"} verb
   * @param {string} past
   */
  const lifecycle = (verb, past) => {
    const timed = verb === "stop" || verb === "restart";
    const run = async (/** @type {Target} */ t) => {
      if (timed) deps.expect(t.ref);
      await docker([verb, ...(timed ? ["-t", stopTimeout()] : []), "--", t.ref], {
        timeoutMs: lifecycleTimeout(),
      });
    };
    const one = async (/** @type {Target} */ t) => {
      await run(t);
      return done(`${past} ${t.name}.`);
    };
    const act = async (/** @type {Args} */ args = {}) => {
      const targets = many(args, "container", "containers", fromItem);
      if (targets)
        return bulk(targets, { past, verb }, "container", run, args.containers !== undefined);
      return one(single(args));
    };
    return Object.assign(act, { one });
  };

  /** @param {Args} [args] */
  const kill = async (args = {}) => {
    const targets = many(args, "container", "containers", fromItem);
    const run = async (/** @type {Target} */ t) => {
      deps.expect(t.ref);
      await docker(["kill", "--", t.ref]);
    };
    if (targets) {
      await ensure(
        `Kill ${targets.length} containers: ${names(targets.map((t) => t.name))}? Their processes end at once, without a chance to clean up.`,
        `Kill ${targets.length} containers`,
      );
      return bulk(
        targets,
        { past: "Killed", verb: "kill" },
        "container",
        run,
        args.containers !== undefined,
      );
    }
    const one = single(args);
    await ensure(
      `Kill ${one.name}? Its processes end at once, without a chance to clean up.`,
      `Kill ${one.name}`,
    );
    await run(one);
    return done(`Killed ${one.name}.`);
  };

  /** @param {Args} [args] `volumes: true` also removes their anonymous volumes. */
  const remove = async (args = {}) => {
    const volumes = args.volumes === true;
    const also = volumes ? " Their anonymous volumes go with them." : "";
    const isLive = (/** @type {string} */ state) =>
      state === "running" || state === "paused" || state === "restarting";
    const run = async (/** @type {Target} */ t) => {
      deps.expect(t.ref);
      const force = isLive(t.state) || args.force === true;
      await docker(["rm", ...(force ? ["-f"] : []), ...(volumes ? ["-v"] : []), "--", t.ref], {
        timeoutMs: lifecycleTimeout(),
      });
    };
    const targets = many(args, "container", "containers", fromItem);
    if (targets) {
      const live = targets.filter((t) => isLive(t.state)).length;
      const stopped =
        live === 0
          ? ""
          : live === 1
            ? " The running one is stopped first."
            : " The running ones are stopped first.";
      await ensure(
        `Remove ${targets.length} containers: ${names(targets.map((t) => t.name))}?${stopped}${also}`,
        `Remove ${targets.length} containers`,
      );
      return bulk(
        targets,
        { past: "Removed", verb: "remove" },
        "container",
        run,
        args.containers !== undefined,
      );
    }
    const one = single(args);
    const itsAlso = volumes ? " Its anonymous volumes go with it." : "";
    await ensure(
      isLive(one.state)
        ? `Remove ${one.name}? It is ${one.state}: it is stopped first.${itsAlso}`
        : `Remove ${one.name}?${itsAlso}`,
      `Remove ${one.name}`,
    );
    await run(one);
    return done(`Removed ${one.name}.`);
  };

  /** Pause a running container, unpause a paused one. */
  const togglePause = async (/** @type {Args} */ args = {}) => {
    const targets = many(args, "container", "containers", fromItem);
    if (targets) return targets.every((t) => t.state === "paused") ? unpause(args) : pause(args);
    const one = single(args);
    return one.state === "paused" ? unpause.one(one) : pause.one(one);
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
    const job = deps.track(`Pull ${ref}`, createPullProgress());
    try {
      await docker(["pull", "--", ref], { timeoutMs: 0, onLine: job.line });
    } catch (error) {
      job.end("failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
    job.end("done");
    return done(`Pulled ${ref}.`);
  };

  /** @param {Args} [args] */
  const removeImage = async (args = {}) => {
    const marked = args.image === undefined ? deps.marked().filter((i) => i.kind === "image") : [];
    if (marked.length > 1) {
      const items = /** @type {Array<Extract<Item, { kind: "image" }>>} */ (marked);
      const targets = items.map((i) => ({
        ref: i.dangling ? i.id : i.ref,
        name: i.dangling ? i.id.replace(/^sha256:/, "").slice(0, 12) : i.ref,
        state: "",
        item: i,
      }));
      await ensure(
        `Remove ${targets.length} images: ${names(targets.map((t) => t.name))}?`,
        `Remove ${targets.length} images`,
      );
      return bulk(
        targets,
        { past: "Removed", verb: "remove" },
        "image",
        (t) => docker(["image", "rm", "--", t.ref]),
        false,
      );
    }
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
    const preview = deps.settings().confirm
      ? await previewImages(docker, all).catch(() => undefined)
      : undefined;
    await ensure(
      all
        ? "Remove every image no container uses? They are pulled or built again when needed."
        : "Remove every dangling image (untagged layers left by builds and pulls)?",
      "Remove them",
      preview,
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
