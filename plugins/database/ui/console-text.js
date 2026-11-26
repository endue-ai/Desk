import { t } from "./strings/index.js";

// A console's text, kept under the console's own id (ADR 0286): in the plugin's store a moment
// after each change, at once when another console's text changes, and read back when the console
// opens. Text past the store's limit (64 KiB a value) is kept whole in a file of the plugin's own,
// ~/.endue/database/consoles/<id>.sql, and the store says where: nothing is cut. A closed
// console's text is forgotten. No DOM.

const TEXT_LIMIT = 60 * 1024;
const FOLDER = "~/.endue/database/consoles";
const textKey = (/** @type {string} */ id) => `console:${id}`;

/** The file that keeps a console's text past the store's limit. */
export const spillPath = (/** @type {string} */ id) =>
  `${FOLDER}/${id.replace(/[^\w-]/gu, "_")}.sql`;

/**
 * @param {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   view: { say(text: string): void },
 * }} deps
 */
export function createTexts({ bridge, view }) {
  /** The console text waiting to be kept, and its timer. */
  /** @type {{ id: string, text: string, timer: ReturnType<typeof setTimeout> } | null} */
  let saving = null;
  /** The consoles whose text is in a file, so a closed one's file is emptied. */
  const spilled = new Set();

  const spill = (/** @type {string} */ id, /** @type {string} */ text) => {
    const path = spillPath(id);
    const scope = { permission: /** @type {const} */ ("fs:write"), paths: [path] };
    return bridge.call("fs.write", {
      path,
      content: text,
      encoding: "utf8",
      createDirs: true,
      scope,
    });
  };
  const write = async (/** @type {string} */ id, /** @type {string} */ text) => {
    if (text.length <= TEXT_LIMIT) {
      await bridge.call("store.set", { key: textKey(id), value: text });
      return;
    }
    await spill(id, text);
    spilled.add(id);
    const value = { file: spillPath(id), length: text.length };
    await bridge.call("store.set", { key: textKey(id), value });
  };
  const keep = () => {
    if (!saving) return;
    clearTimeout(saving.timer);
    const { id, text } = saving;
    saving = null;
    void write(id, text).catch(() => view.say(t("consoleText.couldNotSaveThisConsole")));
  };

  return {
    /** The text kept for a console, or "". */
    async load(/** @type {string} */ id) {
      const kept = await bridge.call("store.get", { key: textKey(id) }).catch(() => ({}));
      const value = /** @type {unknown} */ (kept.value);
      if (typeof value === "string") return value;
      const file = /** @type {{ file?: unknown } | null | undefined} */ (value)?.file;
      if (typeof file !== "string" || !file.startsWith(`${FOLDER}/`)) return "";
      const scope = { permission: /** @type {const} */ ("fs:read"), paths: [file] };
      const read = await bridge
        .call("fs.read", { path: file, encoding: "utf8", scope })
        .catch(() => undefined);
      if (!read) {
        view.say(t("consoleText.couldNotReadThisConsoleS"));
        return "";
      }
      spilled.add(id);
      return read.content;
    },
    /** A console's text changed: keep it, a moment later. */
    edited(/** @type {string} */ id, /** @type {string} */ text) {
      if (saving && saving.id !== id) keep();
      if (saving) clearTimeout(saving.timer);
      saving = { id, text, timer: setTimeout(keep, 400) };
    },
    /** Keep at once what waits to be kept. */
    keep,
    /** A console closed for good: its text goes too. */
    forget(/** @type {string} */ id) {
      if (saving?.id === id) {
        clearTimeout(saving.timer);
        saving = null;
      }
      void bridge.call("store.set", { key: textKey(id), value: null }).catch(() => {});
      if (spilled.delete(id)) void spill(id, "").catch(() => {});
    },
  };
}
