// "Show in Finder" on a file this build of the desk does not show (ADR 0174): shell.open with reveal
// shows the file selected in the system's file manager, so another app can open it. The manifest's
// shell:open grant covers files under the home folder; for any other the core asks first (ADR 0047).

/**
 * @typedef {{ call(method: "shell.open", params: { target: string, reveal: true,
 *   scope: { permission: "shell:open", paths: string[] } }): Promise<unknown> }} RevealBridge
 */

/** What the system calls its file manager, for the button and the sentences. */
export function fileManager(platform = globalThis.navigator?.platform ?? "") {
  if (/^mac/i.test(platform)) return "Finder";
  if (/^win/i.test(platform)) return "File Explorer";
  return "the file manager";
}

/** The button's words: "Show in Finder". */
export const revealLabel = (platform = globalThis.navigator?.platform ?? "") =>
  `Show in ${fileManager(platform)}`;

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/**
 * Show `path` in the file manager. Resolves once it is shown; rejects with a sentence otherwise.
 * @param {RevealBridge} bridge
 * @param {string} path
 */
export async function reveal(bridge, path) {
  const name = nameOf(path);
  // A path scope is a pattern. Wildcards in the name would change the folder or target it names.
  if (/[*?]/.test(path)) throw new Error(`${name} cannot be shown: its path holds * or ?.`);
  const folder = path.slice(0, path.lastIndexOf("/"));
  // A grant reaches other direct children of this folder, without sweeping in subfolders or roots.
  const grouped = folder && !/^[A-Za-z]:$/.test(folder) && !path.split("/").includes("..");
  const scope = {
    permission: /** @type {const} */ ("shell:open"),
    paths: [grouped ? `${folder}/*` : path],
  };
  try {
    await bridge.call("shell.open", { target: path, reveal: true, scope });
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error)?.code;
    if (code === "permission_denied")
      throw new Error(`Not allowed to show ${name} in ${fileManager()}.`);
    if (code === "not_found") throw new Error(`${name} is no longer where it was.`);
    throw new Error(`Could not show ${name} in ${fileManager()}.`);
  }
}
