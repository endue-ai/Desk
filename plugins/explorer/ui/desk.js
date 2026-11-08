// What the explorer asks of the desk through the command registry (cmd.invoke under its cmd:invoke
// grant): opening a file in the plugin the desk's rules name, one answer typed or one question asked
// in the palette, and the file the person works in. Every failure is an Error whose message is the
// sentence the person reads.
import { nameOf } from "./tree.js";

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;

/** @param {import("@endue-ai/plugin-sdk").PluginContext["commands"]} commands */
export function createDeskLink(commands) {
  return {
    /** Open a file where the desk says. The desk reports a file nobody opens; so does this. */
    open: async (/** @type {string} */ path) => {
      try {
        await commands.run("desk.files.open", { path });
      } catch (error) {
        // A CommandFailed reads "desk.files.open: <code>: <why>"; the person gets the why.
        const text = error instanceof Error ? error.message : String(error);
        const why =
          codeOf(error) === "unknown_command"
            ? "the desk's file commands are off"
            : text.replace(/^[a-z.-]+: [a-z_]+: /, "");
        throw new Error(`Could not open ${nameOf(path)}: ${why}`.replace(/\.?$/, "."));
      }
    },

    /**
     * The person types one answer in the palette, from `query` when given; undefined when nothing
     * was picked.
     */
    pick: async (
      /** @type {string} */ title,
      /** @type {string} */ placeholder,
      /** @type {string | undefined} */ query = undefined,
    ) => {
      const args = { title, items: [], free: true, placeholder, ...(query ? { query } : {}) };
      try {
        return asString(await commands.run("desk.palette.pick", args));
      } catch (error) {
        if (codeOf(error) !== "unknown_command") return undefined;
        throw new Error(`${title}: the palette is not available.`);
      }
    },

    /** One question in the palette: whether the first answer was picked (Escape is no). */
    confirm: async (
      /** @type {string} */ title,
      /** @type {Array<{ id: string, label: string, detail: string }>} */ items,
    ) => {
      try {
        return (await commands.run("desk.palette.pick", { title, items })) === items[0]?.id;
      } catch (error) {
        if (codeOf(error) !== "unknown_command") return false;
        throw new Error(`${title.replace(/\?$/, "")}: the palette is not available to ask.`);
      }
    },

    /** The file the person works in: the most recent buffer that holds one. */
    inUse: async () => {
      const buffers = await commands.run("desk.buffers.list").catch(() => []);
      const current = Array.isArray(buffers)
        ? buffers.find((b) => typeof (/** @type {{ path?: unknown }} */ (b)?.path) === "string")
        : undefined;
      return asString(/** @type {{ path?: unknown }} */ (current)?.path);
    },
  };
}
