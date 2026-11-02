// Editing and saving the data plugin's open files (ADR 0071), without a DOM. Edits of one file run
// in order, in its session (the page's, or the worker's above 1 MiB); the first since a load or a
// save marks its buffer unsaved with desk.buffers.update. desk.files.save writes the file's bytes
// with fs.write under an fs:write scope of its folder, asking once with perm.request when that is
// refused. A text-tier file asks first whether to save a copy or overwrite (save-copy.js).

import { copyPathOf, createSaveChoice } from "./save-copy.js";
import { MAX_EDIT } from "./session.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("../formats.js").Opened} Opened
 * @typedef {import("./session.js").EditTier} EditTier
 * @typedef {object} EditedFile The part of an open file editing reads and writes
 * @property {string} buffer
 * @property {string} path
 * @property {string} name
 * @property {Opened} opened
 * @property {EditTier} tier
 * @property {string} [why]
 * @property {ReturnType<typeof import("./session.js").createSession>} [session] Below 1 MiB
 * @property {boolean} [edited] Marked unsaved since the last load or save
 * @property {Promise<unknown>} [pending] The edits still running
 * @typedef {{ shown(): EditedFile | undefined, held(buffer: string): EditedFile,
 *   changed(file: EditedFile): Promise<void>, say(text: string): void }} Hooks
 */

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
/**
 * The scope of `permission` over the folder `path` is in. (Its glob is joined, not a template:
 * Biome 2 misreads a template's slash-star-star as a comment opener.)
 * @param {"fs:read" | "fs:write"} permission
 * @param {string} path
 */
const folderScope = (permission, path) => ({
  permission,
  paths: [[folderOf(path), "**"].join("/")],
});
const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** Base64 of the bytes, in pieces small enough for String.fromCharCode. */
function base64(/** @type {Uint8Array} */ bytes) {
  const native = /** @type {{ toBase64?: () => string }} */ (/** @type {unknown} */ (bytes));
  if (typeof native.toBase64 === "function") return native.toBase64();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {Hooks} hooks
 */
export function createEditing({ bridge, commands }, hooks) {
  /** Whether a file is in its folder, to say a copy replaces it. */
  const exists = async (/** @type {string} */ path) => {
    const scope = folderScope("fs:read", path);
    const { entries } = await bridge.call("fs.list", { path: folderOf(path), scope });
    return entries.some((entry) => entry.name === nameOf(path));
  };
  const choice = createSaveChoice(commands, exists);

  const readOnly = (/** @type {EditedFile} */ file) =>
    new Error(`${file.name} opens read-only: ${file.why ?? "it is not edited here"}.`);
  const current = () => {
    const file = hooks.shown();
    if (!file) throw new Error("Open a file first.");
    return file;
  };

  /** Write `bytes` to `path`; when the grants do not cover it, ask once for its folder. */
  const write = async (/** @type {string} */ path, /** @type {Uint8Array} */ bytes) => {
    const scope = folderScope("fs:write", path);
    const content = base64(bytes);
    const call = () => bridge.call("fs.write", { path, content, encoding: "base64", scope });
    const refusal = new Error(`Not allowed to write ${path}.`);
    const failed = (/** @type {unknown} */ error) =>
      codeOf(error) === "permission_denied"
        ? refusal
        : new Error(`Could not write ${path}: ${codeOf(error)}.`);
    try {
      return await call();
    } catch (error) {
      if (codeOf(error) !== "permission_denied") throw failed(error);
    }
    // perm.request answers a refusal as a result; a failed ask counts as one.
    const decision = await bridge
      .call("perm.request", { permission: scope, reason: `To save ${path}` })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refusal;
    try {
      return await call();
    } catch (error) {
      throw failed(error);
    }
  };

  return {
    /**
     * The editor's text for the value at `path` (root index, then child indexes) of the file shown.
     * @param {number[]} path
     * @returns {Promise<string>}
     */
    async begin(path) {
      const file = current();
      if (file.tier === "read-only") throw readOnly(file);
      const remote = file.opened.remote;
      const { text } = remote
        ? await remote.request("begin", { path })
        : /** @type {NonNullable<EditedFile["session"]>} */ (file.session).valueOf(path);
      return text;
    },

    /**
     * Set the value at `path` of the file shown from the editor's text, after its earlier edits.
     * @param {number[]} path
     * @param {string} text
     */
    edit(path, text) {
      const file = current();
      const run = async () => {
        if (file.tier === "read-only") throw readOnly(file);
        const remote = file.opened.remote;
        if (remote) {
          const { changed, ...meta } = await remote.request("edit", { path, text });
          if (!changed) return;
          file.opened = { ...meta, remote };
        } else {
          const session = /** @type {NonNullable<EditedFile["session"]>} */ (file.session);
          if (!session.edit(path, text).changed) return;
          file.opened = session.opened;
        }
        if (!file.edited) {
          file.edited = true;
          commands.run("desk.buffers.update", { id: file.buffer, modified: true }).catch(() => {});
        }
        await hooks.changed(file);
      };
      const done = (file.pending ?? Promise.resolve()).then(run);
      file.pending = done.catch(() => {});
      return done;
    },

    /**
     * Answer desk.files.save: the file's bytes to its path, or for a text-tier file to its copy when
     * the person chooses so. Throws, in words, when nothing was saved.
     * @param {string} buffer
     * @param {string} [asked] The path the desk names
     */
    async save(buffer, asked) {
      const file = hooks.held(buffer);
      await file.pending;
      if (file.tier === "read-only") throw readOnly(file);
      let target = asked ?? file.path;
      if (file.tier === "text") {
        const answer = await choice.ask({ path: file.path, format: file.opened.label });
        if (!answer) throw new Error(`Did not save ${file.name}.`);
        if (answer === "copy") target = copyPathOf(file.path);
      }
      const remote = file.opened.remote;
      /** @type {Uint8Array} */
      const bytes = remote
        ? await remote.request("bytes")
        : /** @type {NonNullable<EditedFile["session"]>} */ (file.session).bytes;
      if (bytes.length > MAX_EDIT)
        throw new Error(`Did not save ${file.name}: Data saves files up to 64 MiB.`);
      await write(target, bytes);
      file.edited = false;
      hooks.say(
        target === file.path
          ? `Saved ${file.name}.`
          : `Saved a copy as ${nameOf(target)}; ${file.name} is unchanged.`,
      );
    },

    /** The file closed: its save question is asked again when it opens again. */
    closed(/** @type {string} */ path) {
      choice.forget(path);
    },
  };
}
