// A text-tier first save chooses the exact write destination and grants it in the same dialog.

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/** Where the copy of `path` goes: `report.yaml` → `report.copy.yaml`, beside it. */
export function copyPathOf(/** @type {string} */ path) {
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return `${folder}${dot > 0 ? `${name.slice(0, dot)}.copy${name.slice(dot)}` : `${name}.copy`}`;
}

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext["bridge"], "call">} bridge
 */
export function createSaveChoice(bridge) {
  /** @type {Map<string, string>} */
  const answers = new Map();
  return {
    /** @param {{ path: string, format: string }} file */
    async ask({ path, format }) {
      const held = answers.get(path);
      if (held) return held;
      const answer = await bridge.call("dialog.save", {
        title: `Save ${nameOf(path).slice(0, 140)} as ${format} text`,
        startIn: path.slice(0, path.lastIndexOf("/")) || "/",
        suggestedName: nameOf(copyPathOf(path)),
      });
      if (answer.cancelled || !answer.path || /[*?]/u.test(answer.path)) return null;
      return answer.path;
    },
    /** @param {string} path @param {string} target */
    saved(path, target) {
      answers.set(path, target);
    },
    /** Ask again next time `path` is saved (it closed). */
    forget(/** @type {string} */ path) {
      answers.delete(path);
    },
  };
}
