// Files a request makes curl read. curl reads them itself, past the desk's grants, so a request
// file from a shared collection could name ~/.ssh/id_rsa as its body and send it anywhere. A file
// goes out without asking only when the person chose it in this session, or when it lies inside
// the request's own collection folder with no symlink on the way; any other file is sent only
// after the person says yes, once per path for the session.

import { filePart } from "./curl-config.js";
import { h } from "./dom.js";
import { dialog } from "./menu.js";
import { hostOf } from "./url.js";

/**
 * @typedef {import("./curl-config.js").Prepared} Prepared
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 */

/** The paths curl reads for a request's body, as curl gets them. @param {Prepared} prep */
export function filesRead(prep) {
  if (prep.body.kind === "file") return [prep.body.path];
  if (prep.body.kind === "multipart")
    return prep.body.parts.filter((p) => p.file).map((p) => filePart(p.value));
  return [];
}

/**
 * A path's segments with `.` and `..` worked out, `/` and `\` alike; undefined when it is not
 * absolute (curl would read it from a folder nobody chose). `~` counts as a root.
 * @param {string} path @returns {string[] | undefined}
 */
export function segments(path) {
  const p = path.trim().replace(/\\/g, "/");
  const root = /^(~|[A-Za-z]:)?\//.exec(p);
  if (!root) return undefined;
  /** @type {string[]} */
  const out = [root[1] ?? ""];
  for (const part of p.slice(root[0].length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 1) out.pop();
    } else out.push(part);
  }
  return out;
}

/** Whether `path` lies inside the folder `root`. @param {string} path @param {string} root */
export function inside(path, root) {
  const p = segments(path);
  const r = segments(root);
  if (!p || !r || p.length <= r.length) return false;
  return r.every((part, i) => part === p[i]);
}

/**
 * Whether any folder between `root` and `path`, or the file itself, is a symlink, which would let
 * a file inside the folder stand for one outside it. A path that does not exist is no link.
 * @param {Studio} S @param {string} path @param {string} root
 */
async function linked(S, path, root) {
  const r = segments(root) ?? [];
  const p = segments(path) ?? [];
  const base = root.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  for (let i = r.length; i < p.length; i++) {
    const at = `${base}/${p.slice(r.length, i + 1).join("/")}`;
    try {
      const stat = await S.ctx.bridge.call("fs.stat", {
        path: at,
        scope: { permission: "fs:read", paths: [root, `${base}/**`] },
      });
      if (stat?.kind === "symlink") return true;
    } catch (error) {
      if (/** @type {any} */ (error)?.code === "not_found") return false;
      return true;
    }
  }
  return false;
}

/** @param {Studio} S */
export function installFileGuard(S) {
  /** Paths the person chose or allowed in this session. @type {Set<string>} */
  const allowed = new Set();
  const pick = S.pickFile;
  S.pickFile = async () => {
    const path = await pick();
    if (path) allowed.add(path.trim());
    return path;
  };

  /**
   * Whether the files a request reads may go out; asks for each one that is not plainly the
   * collection's own. @param {Tab} tab @param {Prepared} prep
   */
  S.filesAllowed = async (tab, prep) => {
    const root = tab.ref?.collection;
    for (const path of filesRead(prep)) {
      const key = path.trim();
      if (!key || allowed.has(key)) continue;
      if (root && inside(key, root) && !(await linked(S, key, root))) continue;
      const yes = await dialog({
        title: "Send a file from this computer?",
        className: "is-file-guard",
        body: [
          h(
            "p.as-dialog-text",
            null,
            `“${tab.req.name}” would send this file to ${hostOf(prep.url) || "the server"}:`,
          ),
          h("p.as-dialog-text", null, h("code", null, key)),
          h(
            "p.as-dialog-text",
            null,
            root
              ? "It is outside the request's collection folder. A collection can name any file, so send it only if you chose it."
              : "A request can name any file, so send it only if you chose it.",
          ),
        ],
        actions: [
          { label: "Don't send", value: () => false },
          { label: "Send the file", kind: "desk-btn-primary", value: () => true },
        ],
      });
      if (yes !== true) return false;
      allowed.add(key);
    }
    return true;
  };
}
