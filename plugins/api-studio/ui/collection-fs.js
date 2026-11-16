// Collections are folders of plain files, so they live in Git beside the code they test:
//
//   shop-api/
//     collection.json               the collection's name, auth, headers, variables, scripts, docs
//     environments/local.env.json   one file per environment (secret values are never written)
//     users/folder.json             a folder's own settings, the same shape
//     users/list-users.request.json one file per request
//
// Files are pretty JSON with a fixed key order, and fields left at their defaults are left out,
// so a change to a request is a small diff. This module reads such a tree and writes its parts.

import { defaultSettings, normalize, uid } from "./model.js";

/**
 * @typedef {import("./model.js").Request} Request
 * @typedef {import("./model.js").Pair} Pair
 * @typedef {{ name: string, auth: import("./model.js").Auth, headers: Pair[], vars: Pair[],
 *   scripts: { pre: string, post: string }, docs: string, seq?: number }} Group
 * @typedef {{ type: "request", path: string, name: string, method: string, seq: number, req: Request }} RequestNode
 * @typedef {{ type: "folder", path: string, name: string, seq: number, meta: Group, children: Node[] }} FolderNode
 * @typedef {RequestNode | FolderNode} Node
 * @typedef {{ path: string, name: string, vars: (Pair & { secret?: boolean })[], color?: string }} Env
 * @typedef {{ path: string, name: string, meta: Group, children: Node[], envs: Env[], error?: string }} Collection
 * @typedef {{ call(method: string, params: any): Promise<any> }} Bridge
 */

export const FORMAT = "endue.api-studio/1";
export const REQUEST_EXT = ".request.json";
export const ENV_EXT = ".env.json";
export const FOLDER_FILE = "folder.json";
export const COLLECTION_FILE = "collection.json";
export const ENV_DIR = "environments";

/** A file name for a name: lower case, words joined by dashes. @param {string} name */
export function slug(name) {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "untitled";
}

/** @param {string} dir @param {string} name */
export const join = (dir, name) => `${dir.replace(/\/+$/, "")}/${name}`;
/** @param {string} path */
export const parentOf = (path) => path.replace(/\/[^/]+\/?$/, "");
/** @param {string} path */
export const baseName = (path) => path.replace(/\/+$/, "").split("/").pop() ?? path;

/** @param {any} raw @param {string} fallbackName @returns {Group} */
export function normalizeGroup(raw, fallbackName, root = false) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pairs = (/** @type {any} */ list) =>
    Array.isArray(list)
      ? list.map((/** @type {any} */ p) => ({
          id: typeof p?.id === "string" ? p.id : uid("p"),
          on: p?.on !== false,
          key: String(p?.key ?? ""),
          value: String(p?.value ?? ""),
          ...(p?.desc ? { desc: String(p.desc) } : {}),
        }))
      : [];
  return {
    name: String(r.name ?? fallbackName),
    auth: r.auth && typeof r.auth === "object" ? r.auth : { type: root ? "none" : "inherit" },
    headers: pairs(r.headers),
    vars: pairs(r.vars),
    scripts: { pre: String(r.scripts?.pre ?? ""), post: String(r.scripts?.post ?? "") },
    docs: String(r.docs ?? ""),
    ...(typeof r.seq === "number" ? { seq: r.seq } : {}),
  };
}

/** Pairs as stored: no ids, `on` only when off. @param {Pair[]} list */
const storePairs = (list) =>
  list
    .filter((p) => p.key !== "" || p.value !== "")
    .map((p) => ({
      key: p.key,
      value: p.value,
      ...(p.on ? {} : { on: false }),
      ...(p.desc ? { desc: p.desc } : {}),
      .../** @type {any} */ (p.kind === "file" ? { kind: "file" } : {}),
    }));

/** A request as its file holds it. @param {Request} req @returns {Record<string, unknown>} */
export function requestFile(req) {
  /** @type {Record<string, unknown>} */
  const out = { format: FORMAT, id: req.id, name: req.name, method: req.method, url: req.url };
  if (typeof req.seq === "number") out.seq = req.seq;
  if (req.params.length) out.params = storePairs(req.params);
  if (req.pathParams.length) out.pathParams = storePairs(req.pathParams);
  if (req.headers.length) out.headers = storePairs(req.headers);
  const b = req.body;
  if (b.mode !== "none") {
    /** @type {Record<string, unknown>} */
    const body = { mode: b.mode };
    if (b.mode === "json" || b.mode === "text" || b.mode === "xml") body[b.mode] = b[b.mode];
    else if (b.mode === "form") body.form = storePairs(b.form);
    else if (b.mode === "multipart") body.multipart = storePairs(b.multipart);
    else if (b.mode === "file") body.file = b.file;
    else if (b.mode === "graphql") body.graphql = b.graphql;
    out.body = body;
  }
  if (req.auth.type !== "inherit") out.auth = req.auth;
  if (req.vars.pre.length || req.vars.post.length)
    out.vars = { pre: storePairs(req.vars.pre), post: storePairs(req.vars.post) };
  if (req.scripts.pre || req.scripts.post) out.scripts = req.scripts;
  if (req.asserts.length) out.asserts = req.asserts.map(({ id: _id, ...a }) => a);
  if (req.tests) out.tests = req.tests;
  if (req.docs) out.docs = req.docs;
  const defaults = /** @type {Record<string, unknown>} */ (defaultSettings());
  const changed = Object.entries(req.settings).filter(([k, v]) => defaults[k] !== v);
  if (changed.length) out.settings = Object.fromEntries(changed);
  return out;
}

/** A folder's or collection's settings as its file holds them. @param {Group} g @param {boolean} root */
export function groupFile(g, root) {
  /** @type {Record<string, unknown>} */
  const out = { format: FORMAT, name: g.name };
  if (typeof g.seq === "number" && !root) out.seq = g.seq;
  if (g.auth.type !== (root ? "none" : "inherit")) out.auth = g.auth;
  if (g.headers.length) out.headers = storePairs(g.headers);
  if (g.vars.length) out.vars = storePairs(g.vars);
  if (g.scripts.pre || g.scripts.post) out.scripts = g.scripts;
  if (g.docs) out.docs = g.docs;
  return out;
}

/** An environment as its file holds it: a secret keeps its name, never its value. @param {Env} env */
export function envFile(env) {
  return {
    format: FORMAT,
    name: env.name,
    ...(env.color ? { color: env.color } : {}),
    vars: env.vars
      .filter((v) => v.key !== "")
      .map((v) => ({
        key: v.key,
        value: v.secret ? "" : v.value,
        ...(v.secret ? { secret: true } : {}),
        ...(v.on ? {} : { on: false }),
      })),
  };
}

/** JSON as written to disk. @param {unknown} value */
export const text = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** The fs calls a collection needs, each under a scope for its folder; a refusal asks once. @param {Bridge} bridge */
export function createFiles(bridge) {
  /** @type {Set<string>} */
  const asked = new Set();
  /** @param {"fs:read" | "fs:write"} permission @param {string} root */
  const scope = (permission, root) => ({
    permission,
    paths: [root, `${root.replace(/\/+$/, "")}/**`],
  });
  /** @param {string} method @param {any} params @param {"fs:read" | "fs:write"} permission @param {string} root */
  const call = async (method, params, permission, root) => {
    const withScope = { ...params, scope: scope(permission, root) };
    try {
      return await bridge.call(method, withScope);
    } catch (error) {
      const code = /** @type {any} */ (error)?.code;
      const key = `${permission} ${root}`;
      if (code !== "permission_denied" || asked.has(key)) throw error;
      asked.add(key);
      const decision = await bridge
        .call("perm.request", {
          permission: scope(permission, root),
          reason: `To keep the collection in ${root}`,
        })
        .catch(() => ({ granted: false }));
      if (!decision?.granted) throw error;
      return bridge.call(method, withScope);
    }
  };
  return {
    /** @param {string} path @param {string} root */
    read: async (path, root) =>
      String((await call("fs.read", { path, encoding: "utf8" }, "fs:read", root))?.content ?? ""),
    /** @param {string} path @param {string} root @returns {Promise<{ name: string, kind: string }[]>} */
    list: async (path, root) => (await call("fs.list", { path }, "fs:read", root))?.entries ?? [],
    /** @param {string} path @param {string} content @param {string} root */
    write: (path, content, root) =>
      call("fs.write", { path, content, encoding: "utf8", createDirs: true }, "fs:write", root),
    /** @param {string} path @param {string} root */
    mkdir: (path, root) => call("fs.mkdir", { path, parents: true }, "fs:write", root),
    /** @param {string} from @param {string} to @param {string} root */
    rename: (from, to, root) => call("fs.rename", { from, to }, "fs:write", root),
    /** @param {string} path @param {string} root */
    trash: (path, root) => call("fs.trash", { path }, "fs:write", root),
    /** @param {string} path @param {string} root */
    watch: (path, root) => call("fs.watch", { path, recursive: true }, "fs:read", root),
  };
}

/** @typedef {ReturnType<typeof createFiles>} Files */

/** Order nodes by their seq, then by name. @param {Node[]} nodes */
export function sortNodes(nodes) {
  return nodes.sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name));
}

/** @param {string} raw @param {string} path */
function parse(raw, path) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${/** @type {Error} */ (error).message}`);
  }
}

/**
 * Read a collection folder: its settings, its environments and every folder and request in it.
 * A file that cannot be read is skipped and named in `error`; the rest still loads.
 * @param {Files} files @param {string} root @returns {Promise<Collection>}
 */
export async function readCollection(files, root) {
  /** @type {string[]} */
  const problems = [];
  const meta = normalizeGroup(
    await files
      .read(join(root, COLLECTION_FILE), root)
      .then((t) => parse(t, COLLECTION_FILE))
      .catch(() => ({})),
    baseName(root),
    true,
  );
  /** @type {Env[]} */
  const envs = [];
  /** @param {string} dir @returns {Promise<Node[]>} */
  const walk = async (dir) => {
    const entries = await files.list(dir, root);
    /** @type {Node[]} */
    const out = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      try {
        if (entry.kind === "dir" && dir === root && entry.name === ENV_DIR) {
          for (const e of await files.list(path, root)) {
            if (!e.name.endsWith(ENV_EXT)) continue;
            const file = join(path, e.name);
            const raw = parse(await files.read(file, root), file);
            envs.push({
              path: file,
              name: String(raw.name ?? e.name.slice(0, -ENV_EXT.length)),
              ...(raw.color ? { color: String(raw.color) } : {}),
              vars: (Array.isArray(raw.vars) ? raw.vars : []).map((/** @type {any} */ v) => ({
                id: uid("p"),
                on: v.on !== false,
                key: String(v.key ?? ""),
                value: String(v.value ?? ""),
                ...(v.secret ? { secret: true } : {}),
              })),
            });
          }
        } else if (entry.kind === "dir") {
          const raw = await files
            .read(join(path, FOLDER_FILE), root)
            .then((t) => parse(t, FOLDER_FILE))
            .catch(() => ({}));
          const group = normalizeGroup(raw, entry.name);
          out.push({
            type: "folder",
            path,
            name: group.name,
            seq: group.seq ?? 1e6,
            meta: group,
            children: await walk(path),
          });
        } else if (entry.name.endsWith(REQUEST_EXT)) {
          const req = normalize(parse(await files.read(path, root), path));
          out.push({
            type: "request",
            path,
            name: req.name,
            method: req.method,
            seq: req.seq ?? 1e6,
            req,
          });
        }
      } catch (error) {
        problems.push(/** @type {Error} */ (error).message ?? String(error));
      }
    }
    return sortNodes(out);
  };
  const children = await walk(root);
  envs.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: root,
    name: meta.name,
    meta,
    children,
    envs,
    ...(problems.length ? { error: problems.join("\n") } : {}),
  };
}

/** A free file name in a folder for a name: `name.request.json`, then `name-2…`. @param {Files} files @param {string} dir @param {string} name @param {string} ext @param {string} root */
export async function freeName(files, dir, name, ext, root) {
  const taken = new Set((await files.list(dir, root).catch(() => [])).map((e) => e.name));
  const base = slug(name);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base}${i > 1 ? `-${i}` : ""}${ext}`;
    if (!taken.has(candidate)) return join(dir, candidate);
  }
  return join(dir, `${base}-${Date.now()}${ext}`);
}
