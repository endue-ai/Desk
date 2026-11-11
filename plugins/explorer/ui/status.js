// The status line (role=status): what the person's last action did or why it failed, in words. It
// says one thing until the person acts again (a command, a selection that moves), so it never speaks
// of another file. A folder's listing failure goes once that folder lists; a change on disk that
// lists a folder again leaves every other message alone.

/** @param {(text: string) => void} show */
export function statusLine(show) {
  let said = "";
  /** @type {string | undefined} the folder whose listing failure the line says */
  let failedFolder;
  const set = (/** @type {string} */ text, /** @type {string | undefined} */ folder) => {
    failedFolder = folder;
    if (text === said) return;
    said = text;
    show(text);
  };
  return {
    /** What an action did, or why it failed. */
    say: (/** @type {string} */ text) => set(text, undefined),
    /** A folder did not list: said until it lists or the person acts again. */
    failed: (/** @type {string} */ folder, /** @type {string} */ text) => set(text, folder),
    /** A folder listed: its failure, when the line says it, goes. */
    listed: (/** @type {string} */ folder) => {
      if (failedFolder === folder) set("", undefined);
    },
  };
}
