// Named note actions shared by the shelf and the command registry.

/**
 * A file name for a typed one: trimmed, without slashes, `.md` added unless it ends in .md or .txt.
 * Empty for a name that cannot be a file.
 */
export const fileNameOf = (/** @type {string} */ typed) => {
  const name = typed.trim().replace(/[/\\:]/g, "-");
  if (name === "" || name === "." || name === ".." || name.includes("\0")) return "";
  return /\.(md|txt)$/i.test(name) ? name : `${name}.md`;
};

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext, "bridge" | "commands">} ctx
 * @param {ReturnType<typeof import("./grants.js").createGrants>} grants
 */
export function createNoteActions({ bridge, commands }, grants) {
  const show = async (/** @type {string} */ path) => {
    await commands.run("desk.files.open", { path });
    return { path };
  };
  return {
    show,
    async rename(
      /** @type {string} */ from,
      /** @type {string} */ typed,
      /** @type {string | undefined} */ buffer,
    ) {
      const name = fileNameOf(typed);
      if (!name) throw new Error("A note's name cannot be empty.");
      const path = `${from.slice(0, from.lastIndexOf("/") + 1)}${name}`;
      if (path === from) return { path };
      await grants.withGrant(
        "fs:write",
        path,
        (scope) => bridge.call("fs.rename", { from, to: path, scope }),
        `To rename ${from} to ${name}`,
      );
      if (buffer) {
        await show(path);
        await commands.run("desk.buffers.close", { id: buffer });
      }
      return { path };
    },
    async trash(/** @type {string} */ path, /** @type {string | undefined} */ buffer) {
      await grants.withGrant(
        "fs:write",
        path,
        (scope) => bridge.call("fs.trash", { path, scope }),
        `To move ${path} to the Trash`,
      );
      if (buffer) {
        await commands.run("desk.buffers.update", { id: buffer, modified: false });
        await commands.run("desk.buffers.close", { id: buffer });
      }
      return { path };
    },
  };
}
