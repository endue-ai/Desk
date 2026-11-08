// Paths dropped on a folder (ADR 0119): a drop moves them there, Alt copies, and a drop from another
// volume or from the OS copies, as Finder does (Mod moves anyway). Moves go through fs.rename and
// copies through fs.copy, which the desk's undo reverses; a name already in the folder asks first
// (keep both, replace, skip), before anything is written, and a replaced entry goes to the OS trash.
// The drop hands over paths only: every call carries the explorer's own scopes, asked for once with
// perm.request when they do not cover a path. A file of a container (Docker's `docker/file`, #550)
// has no path here: the folder copies it in with the Docker plugin's endue.docker.copy-out, the
// same name question first, the command asked for once when the explorer may not run it.
import { isUnder, joinPath, nameOf, parentOf, patternOf } from "./tree.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/plugin-sdk").DragOver} DragOver
 * @typedef {import("@endue-ai/plugin-sdk").DragKeys} DragKeys
 * @typedef {"copy" | "move"} Placing
 * @typedef {{ paths: Array<{ path: string }>, folder: string, effect: string, keys?: DragKeys, from?: string }} Placed
 * @typedef {{ dropTarget?: object, landing?(element: unknown): unknown }} DropView
 * @typedef {{ container: string, path: string, name: string }} ContainerFile
 */

/** Docker's command that copies a container's file or folder to this computer. */
const COPY_OUT = "endue.docker.copy-out";

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** The container files a `docker/file` drop names: a container, an absolute path, a plain name. */
export function containerFiles(/** @type {unknown[]} */ values) {
  return values.flatMap((value) => {
    const { container, path, name } = /** @type {Record<string, unknown>} */ (value ?? {});
    if (typeof container !== "string" || container === "") return [];
    if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) return [];
    const base = path.slice(path.lastIndexOf("/") + 1);
    const plain = typeof name === "string" && name !== "" && !/[/\\\0]|^\.\.?$/.test(name);
    const file = /** @type {ContainerFile} */ ({ container, path, name: plain ? name : base });
    return file.name && file.name !== "." && file.name !== ".." ? [file] : [];
  });
}
/** @param {unknown} error */
const permissionOf = (error) =>
  /** @type {{ permission?: import("@endue-ai/plugin-sdk").Permission }} */ (error)?.permission;

/** The volume a path is on, as far as its form says: a drive, /Volumes/<name>, a mount; else home. */
export function volumeOf(/** @type {string} */ path) {
  const drive = /^([A-Za-z]):\//.exec(path);
  if (drive) return `${drive[1]?.toUpperCase()}:`;
  const mount = /^\/(Volumes\/[^/]+|media\/[^/]+\/[^/]+|run\/media\/[^/]+\/[^/]+|mnt\/[^/]+)/;
  return mount.exec(path)?.[1] ?? "/";
}

/** `a.md` → `a 2.md`, `a 3.md`, …: the first name not taken. */
export function freeName(/** @type {string} */ name, /** @type {Set<string>} */ taken) {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; ; n++) if (!taken.has(`${stem} ${n}${ext}`)) return `${stem} ${n}${ext}`;
}

/** The effect a hover over a folder shows: Alt copies, Mod moves, else move when the source allows. */
export function effectFor(/** @type {DragOver} */ over) {
  const allowed = over.effectAllowed;
  const mod = over.keys.meta || over.keys.ctrl;
  const wanted = over.keys.alt && !mod ? "copy" : allowed.includes("move") ? "move" : "copy";
  return allowed.includes(wanted) ? wanted : "none";
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands"> & { dnd?: PluginContext["dnd"] }} ctx
 * @param {DropView} view
 * @param {{ say(text: string): void, rootOf(path: string): string | undefined,
 *   list(folder: string): Promise<Array<{ name: string }>>, placed(folders: string[], first: string): unknown }} deps
 */
export function createDrops({ bridge, commands, dnd }, view, deps) {
  /** The scope a call carries: the explorer folder a path is in, or the path's own folder. */
  const scopeOf = (
    /** @type {"fs:read" | "fs:write"} */ permission,
    /** @type {string} */ path,
  ) => ({
    permission,
    paths: [patternOf(deps.rootOf(path) ?? parentOf(path) ?? path)],
  });

  /** One call; refused, ask once for the scope the core named and try again. */
  const withGrant = async (
    /** @type {string} */ reason,
    /** @type {() => Promise<unknown>} */ call,
  ) => {
    try {
      return await call();
    } catch (error) {
      const permission = permissionOf(error);
      if (codeOf(error) !== "permission_denied" || !permission) throw error;
      const decision = await bridge
        .call("perm.request", { permission, reason })
        .catch(() => ({ granted: false }));
      if (!decision.granted) throw error;
      return call();
    }
  };

  /** fs.copy: a file or a folder, read under the source's scope and written under the folder's. */
  const copy = (/** @type {string} */ from, /** @type {string} */ to) =>
    bridge.call("fs.copy", {
      from,
      to,
      scope: scopeOf("fs:write", to),
      fromScope: scopeOf("fs:read", from),
    });
  /** fs.rename: within a volume or across (the core copies, then trashes the source). */
  const move = (/** @type {string} */ from, /** @type {string} */ to) =>
    bridge.call("fs.rename", {
      from,
      to,
      scope: scopeOf("fs:write", to),
      fromScope: scopeOf("fs:write", from),
    });
  const trash = (/** @type {string} */ path) =>
    bridge.call("fs.trash", { path, scope: scopeOf("fs:write", path) });

  /** What to do with names already in the folder; null when the person cancelled. */
  const ask = async (/** @type {string[]} */ names, /** @type {string} */ folder) => {
    const where = nameOf(folder);
    const title =
      names.length === 1
        ? `${names[0]} is already in ${where}`
        : `${names.length} items are already in ${where}`;
    try {
      const picked = await commands.run("desk.palette.pick", {
        title,
        items: [
          { id: "keep", label: "Keep both", detail: "The new one gets a number: a 2.md" },
          { id: "replace", label: "Replace", detail: `What is in ${where} now goes to the Trash` },
          {
            id: "skip",
            label: "Skip",
            detail: `Leave ${names.length === 1 ? "it" : "them"} where ${names.length === 1 ? "it is" : "they are"}`,
          },
        ],
      });
      return picked === "keep" || picked === "replace" || picked === "skip" ? picked : null;
    } catch {
      return null;
    }
  };

  /**
   * Put dropped paths into `folder`. Resolves with the effect performed ("none": nothing was).
   * @param {Placed} drop
   * @returns {Promise<"copy" | "move" | "none">}
   */
  const place = async ({ paths, folder, effect, keys, from }) => {
    const mod = keys?.meta || keys?.ctrl;
    const sources = [...new Set(paths.map((p) => p.path))].filter(
      (path) => !(effect === "move" && parentOf(path) === folder),
    );
    const inside = sources.find((path) => isUnder(path, folder));
    if (inside) {
      deps.say(`${nameOf(inside)} cannot go into itself.`);
      return "none";
    }
    if (sources.length === 0 || (effect !== "move" && effect !== "copy")) return "none";
    /** @type {(path: string) => Placing} */
    const how = (path) =>
      effect === "copy" || from === "os" || (!mod && volumeOf(path) !== volumeOf(folder))
        ? "copy"
        : "move";
    const taken = new Set((await deps.list(folder)).map((entry) => entry.name));
    const clashes = sources.filter((path) => taken.has(nameOf(path)));
    const answer = clashes.length > 0 ? await ask(clashes.map(nameOf), folder) : "keep";
    if (answer === null) return "none";
    /** @type {Array<{ from: string, to: string, how: Placing, replace: boolean }>} */
    const plan = [];
    for (const path of sources) {
      const clash = taken.has(nameOf(path));
      const name = clash && answer === "keep" ? freeName(nameOf(path), taken) : nameOf(path);
      // Skipped, or a copy that would replace itself: nothing to do.
      if (clash && (answer === "skip" || joinPath(folder, name) === path)) continue;
      taken.add(name);
      plan.push({
        from: path,
        to: joinPath(folder, name),
        how: how(path),
        replace: clash && answer === "replace",
      });
    }
    let done = 0;
    let copied = false;
    for (const step of plan) {
      const verb = step.how === "copy" ? "copy" : "move";
      const reason = `To ${verb} ${nameOf(step.from)} to ${folder}`;
      try {
        if (step.replace) await withGrant(reason, () => trash(step.to));
        if (step.how === "copy") await withGrant(reason, () => copy(step.from, step.to));
        else await withGrant(reason, () => move(step.from, step.to));
        done++;
        copied ||= step.how === "copy";
      } catch (error) {
        deps.say(failure(error, verb, step.from, folder));
        break;
      }
    }
    if (done === 0) return "none";
    const touched = [
      folder,
      ...plan.filter((s) => s.how === "move").map((s) => parentOf(s.from) ?? ""),
    ];
    await deps.placed(
      [...new Set(touched)].filter((f) => f !== ""),
      plan[0]?.to ?? folder,
    );
    if (done === plan.length) deps.say(said(plan, folder));
    return copied ? "copy" : "move";
  };

  /** A command call; refused, ask once to run the command and try again. */
  const withCommand = async (
    /** @type {string} */ reason,
    /** @type {() => Promise<unknown>} */ call,
  ) => {
    try {
      return await call();
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw error;
      const permission = { permission: /** @type {const} */ ("cmd:invoke"), ids: [COPY_OUT] };
      const decision = await bridge
        .call("perm.request", { permission, reason })
        .catch(() => ({ granted: false }));
      if (!decision.granted) throw error;
      return call();
    }
  };

  /**
   * Copy files of a container into `folder` through Docker; the effect performed.
   * @param {{ files: ContainerFile[], folder: string }} drop
   * @returns {Promise<"copy" | "none">}
   */
  const fromContainer = async ({ files, folder }) => {
    if (files.length === 0) return "none";
    const taken = new Set((await deps.list(folder)).map((entry) => entry.name));
    const clashes = files.filter((file) => taken.has(file.name));
    const answer =
      clashes.length > 0
        ? await ask(
            clashes.map((f) => f.name),
            folder,
          )
        : "keep";
    if (answer === null) return "none";
    /** @type {string[]} */
    const placed = [];
    let wanted = 0;
    for (const file of files) {
      const clash = taken.has(file.name);
      if (clash && answer === "skip") continue;
      wanted++;
      // Keep both: the copy gets a name of its own, which docker cp writes it under.
      const name = clash && answer === "keep" ? freeName(file.name, taken) : file.name;
      taken.add(name);
      const reason = `To copy ${file.name} out of its container to ${folder}`;
      try {
        if (clash && answer === "replace")
          await withGrant(reason, () => trash(joinPath(folder, file.name)));
        const dest = name === file.name ? folder : joinPath(folder, name);
        await withCommand(reason, () =>
          commands.run(COPY_OUT, { container: file.container, path: file.path, dest }),
        );
        placed.push(joinPath(folder, name));
      } catch (error) {
        deps.say(`Could not copy ${file.name} to ${nameOf(folder)}: ${messageOf(error)}`);
        break;
      }
    }
    if (placed.length === 0) return "none";
    await deps.placed([folder], placed[0] ?? folder);
    if (placed.length === wanted) {
      const what = placed.length === 1 ? nameOf(placed[0] ?? "") : `${placed.length} items`;
      deps.say(`Copied ${what} to ${nameOf(folder)}.`);
    }
    return "copy";
  };

  dnd?.onDrop(
    view.dropTarget ?? {},
    (drop) => {
      const folder = /** @type {{ dataset?: { path?: string } }} */ (drop.element)?.dataset?.path;
      if (!folder) return "none";
      if (!drop.paths)
        return fromContainer({ files: containerFiles(drop.json("docker/file")), folder });
      return place({
        paths: drop.paths,
        folder,
        effect: drop.effect,
        keys: drop.keys,
        from: drop.from,
      });
    },
    {
      accept: ["desk/paths", "desk/json:docker/file"],
      at: (element) => view.landing?.(element) ?? null,
      // A container's file is copied: it has no path here to move from.
      effect: (over) =>
        over.types.includes("desk/paths")
          ? effectFor(over)
          : over.effectAllowed.includes("copy")
            ? "copy"
            : "none",
    },
  );
  return { place, fromContainer };
}

/** @param {Array<{ from: string, how: Placing }>} plan @param {string} folder */
function said(plan, folder) {
  const verb = plan.every((s) => s.how === "copy")
    ? "Copied"
    : plan.every((s) => s.how === "move")
      ? "Moved"
      : "Put";
  const what = plan.length === 1 ? nameOf(plan[0]?.from ?? "") : `${plan.length} items`;
  return `${verb} ${what} to ${nameOf(folder)}.`;
}

/** The sentence for a failed step. @param {unknown} error */
function failure(
  error,
  /** @type {string} */ verb,
  /** @type {string} */ path,
  /** @type {string} */ folder,
) {
  const name = nameOf(path);
  switch (codeOf(error)) {
    case "permission_denied":
      return `Not allowed to ${verb} ${name} to ${folder}.`;
    case "already_exists":
      return `${name} is already in ${nameOf(folder)}.`;
    case "not_found":
      return `${name} is not there any more.`;
    case "unsupported":
      // A desk with no trash cannot replace: the entry there stays as it is.
      return /** @type {{ method?: string }} */ (error)?.method === "fs.trash"
        ? `${name} in ${nameOf(folder)} was not replaced: there is no trash to put it in.`
        : `This desk cannot ${verb} ${name}.`;
    default:
      return `Could not ${verb} ${name}: ${codeOf(error)}.`;
  }
}
