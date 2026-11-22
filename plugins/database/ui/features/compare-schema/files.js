// The comparison's files on disk (PG-53, ADR 0338): a folder of DDL files read (every `.sql` under
// it, three folders deep at most) or written by a dump (each object's file, and the `.sql` files of
// the kinds' folders that no object holds any more moved to the trash), and a snapshot saved or
// opened. The folder and the file come from the desk's own dialogs; what they do not grant is asked
// for once (perm.request, under the plugin's `/**` scopes).

import { withGrant } from "../../console-files.js";
import { FOLDERS } from "./dump.js";

/**
 * @typedef {Pick<import("../../feature-host.js").Deps, "bridge" | "cancelled">} Deps
 * @typedef {{ path: string, text: string }} File
 */

const DEPTH = 3;
const join = (/** @type {string} */ a, /** @type {string} */ b) => `${a.replace(/\/+$/u, "")}/${b}`;
const read = (/** @type {string} */ folder) =>
  /** @type {const} */ ({ permission: "fs:read", paths: [folder, join(folder, "**")] });
const write = (/** @type {string} */ folder) =>
  /** @type {const} */ ({ permission: "fs:write", paths: [folder, join(folder, "**")] });
const base = (/** @type {string} */ p) => p.replace(/\/+$/u, "").split("/").at(-1) ?? p;

/** A folder the person picks; cancelled when none. */
export async function pickFolder(/** @type {Deps} */ deps, /** @type {string} */ title) {
  const picked = await deps.bridge.call("dialog.open", { title, kind: "folders" });
  const path = picked.cancelled ? undefined : picked.paths[0];
  if (!path) throw deps.cancelled("No folder picked.");
  return path;
}

/** Every `.sql` file under a folder, relative to it. */
async function listSql(/** @type {Deps} */ deps, /** @type {string} */ folder) {
  const scope = read(folder);
  /** @type {string[]} */
  const out = [];
  const walk = async (/** @type {string} */ rel, /** @type {number} */ depth) => {
    const at = rel ? join(folder, rel) : folder;
    const listed = await withGrant(
      deps.bridge,
      /** @type {any} */ (scope),
      () => deps.bridge.call("fs.list", { path: at, scope: /** @type {any} */ (scope) }),
      `To read the DDL files of ${base(folder)}`,
    );
    for (const e of [...listed.entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.kind === "dir" && depth < DEPTH && !e.name.startsWith(".")) await walk(path, depth + 1);
      else if (e.kind === "file" && e.name.endsWith(".sql")) out.push(path);
    }
  };
  await walk("", 1);
  return out;
}

/** A folder's DDL files, each with its text. */
export async function readFolder(/** @type {Deps} */ deps, /** @type {string} */ folder) {
  const scope = read(folder);
  /** @type {File[]} */
  const files = [];
  for (const path of await listSql(deps, folder)) {
    const got = await deps.bridge.call("fs.read", {
      path: join(folder, path),
      encoding: "utf8",
      scope: /** @type {any} */ (scope),
    });
    files.push({ path, text: got.content });
  }
  return files;
}

/** Write a dump: every file, and the stale `.sql` files of its kinds' folders to the trash. */
export async function writeFolder(
  /** @type {Deps} */ deps,
  /** @type {string} */ folder,
  /** @type {File[]} */ files,
) {
  const scope = write(folder);
  const wanted = new Set(files.map((f) => f.path));
  const kinds = new Set(Object.values(FOLDERS));
  const old = await listSql(deps, folder).catch(() => /** @type {string[]} */ ([]));
  const stale = old.filter(
    (p) => kinds.has(p.split("/")[0] ?? "") && p.split("/").length === 2 && !wanted.has(p),
  );
  const put = (/** @type {File} */ f) =>
    deps.bridge.call("fs.write", {
      path: join(folder, f.path),
      content: f.text,
      encoding: "utf8",
      createDirs: true,
      scope: /** @type {any} */ (scope),
    });
  const [first, ...rest] = files;
  if (first)
    await withGrant(
      deps.bridge,
      /** @type {any} */ (scope),
      () => put(first),
      `To write the schema's files into ${base(folder)}`,
    );
  for (const f of rest) await put(f);
  for (const p of stale)
    await deps.bridge.call("fs.trash", {
      path: join(folder, p),
      scope: /** @type {any} */ (scope),
    });
  return { written: files.length, trashed: stale };
}

/** Save a snapshot where the person says; answers the path. */
export async function saveSnapshot(
  /** @type {Deps} */ deps,
  /** @type {string} */ name,
  /** @type {string} */ text,
) {
  const picked = await deps.bridge.call("dialog.save", {
    title: "Save the schema's snapshot",
    suggestedName: `${name}.schema.json`,
    filters: [{ name: "Schema snapshot", extensions: ["json"] }],
  });
  if (picked.cancelled || !picked.path) throw deps.cancelled("Not saved.");
  const path = picked.path;
  const scope = /** @type {const} */ ({ permission: "fs:write", paths: [path] });
  await withGrant(
    deps.bridge,
    /** @type {any} */ (scope),
    () =>
      deps.bridge.call("fs.write", {
        path,
        content: text,
        encoding: "utf8",
        scope: /** @type {any} */ (scope),
      }),
    `To save the snapshot ${base(path)}`,
  );
  return path;
}

/** A snapshot file the person picks, or the one named; answers its path and text. */
export async function openSnapshot(
  /** @type {Deps} */ deps,
  /** @type {string | undefined} */ named,
) {
  let path = named;
  if (!path) {
    const picked = await deps.bridge.call("dialog.open", {
      title: "Compare with which snapshot?",
      filters: [{ name: "Schema snapshot", extensions: ["json"] }],
    });
    path = picked.cancelled ? undefined : picked.paths[0];
  }
  if (!path) throw deps.cancelled("No snapshot picked.");
  const file = path;
  const scope = /** @type {const} */ ({ permission: "fs:read", paths: [file] });
  const got = await withGrant(
    deps.bridge,
    /** @type {any} */ (scope),
    () =>
      deps.bridge.call("fs.read", {
        path: file,
        encoding: "utf8",
        scope: /** @type {any} */ (scope),
      }),
    `To read the snapshot ${base(file)}`,
  );
  return { path: file, text: /** @type {string} */ (got.content) };
}
