// The text tier's first-save question (ADR 0071), for any file plugin that saves a format as text:
// "Save as copy" (the default: `<name>.copy.<ext>` beside the file) or "Overwrite", asked with
// desk.palette.pick the first time each file is saved. The answer holds for that file until
// `forget(path)`; a cancelled question saves nothing and is asked again next time. With the
// palette off, the copy is written. Needs `cmd:invoke` on `desk.palette.pick`; no DOM, no SDK
// import, so it copies into another plugin as it is (pass your own `exists`, or none).

/** @typedef {"copy" | "overwrite"} SaveChoice */

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/** Where the copy of `path` goes: `report.yaml` → `report.copy.yaml`, beside it. */
export function copyPathOf(/** @type {string} */ path) {
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return `${folder}${dot > 0 ? `${name.slice(0, dot)}.copy${name.slice(dot)}` : `${name}.copy`}`;
}

/**
 * @param {{ run(id: string, args?: unknown): Promise<unknown> }} commands `ctx.commands`
 * @param {(path: string) => Promise<boolean>} [exists] Whether a file is there, to say the copy
 *   replaces one
 */
export function createSaveChoice(commands, exists = async () => false) {
  /** @type {Map<string, SaveChoice>} */
  const answers = new Map();
  return {
    /**
     * How to save `path`: the answer given for it before, else the person's. Null when they
     * cancelled. `format` names the format in the question ("YAML").
     * @param {{ path: string, format: string }} file
     * @returns {Promise<SaveChoice | null>}
     */
    async ask({ path, format }) {
      const held = answers.get(path);
      if (held) return held;
      const [name, copy] = [nameOf(path), nameOf(copyPathOf(path))];
      const replaces = await exists(copyPathOf(path)).catch(() => false);
      let picked;
      try {
        picked = await commands.run("desk.palette.pick", {
          title: `Save ${name}: ${format} is saved as text`,
          items: [
            {
              id: "copy",
              label: "Save as copy",
              detail: `${replaces ? "Replaces" : "Writes"} ${copy} beside it; ${name} stays as it is`,
            },
            {
              id: "overwrite",
              label: "Overwrite",
              detail: `Rewrites ${name}; its formatting may change`,
            },
          ],
        });
      } catch (error) {
        // No palette to ask with: the default, without keeping it as the answer.
        const code = /** @type {{ code?: string }} */ (error)?.code;
        return code === "unknown_command" ? "copy" : null;
      }
      if (picked !== "copy" && picked !== "overwrite") return null;
      answers.set(path, picked);
      return picked;
    },
    /** Ask again next time `path` is saved (it closed). */
    forget(/** @type {string} */ path) {
      answers.delete(path);
    },
  };
}
