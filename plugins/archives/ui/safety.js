// Where an entry lands when it is extracted, or why it may not: names with "..", absolute paths,
// drive letters (with "/" or "\" as separators) and links that point out of the folder are refused.

/**
 * The path an entry is written to under `root`, or the reason it is refused.
 * @param {string} root the folder extracted to, without a trailing "/"
 * @param {string} name the entry's name as the archive has it
 * @param {string} [link] the link's target, for a symbolic link
 * @returns {{ path: string } | { refused: string }}
 */
export function safeTarget(root, name, link) {
  if (/^[\\/]/.test(name)) return { refused: "an absolute path" };
  if (/^[A-Za-z]:/.test(name)) return { refused: "a drive letter" };
  /** @type {string[]} */
  const parts = [];
  for (const part of name.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return { refused: "a name that climbs out of the folder" };
      parts.pop();
    } else parts.push(part);
  }
  if (parts.length === 0) return { refused: "an empty name" };
  if (link !== undefined) {
    if (/^[\\/]/.test(link) || /^[A-Za-z]:/.test(link))
      return { refused: "a link to an absolute path" };
    const at = parts.slice(0, -1);
    for (const part of link.split(/[\\/]+/)) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (at.length === 0) return { refused: "a link out of the folder" };
        at.pop();
      } else at.push(part);
    }
  }
  return { path: `${root}/${parts.join("/")}` };
}
