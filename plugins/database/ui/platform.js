// What differs by system in the plugin's paths (PG-102, docs/platforms.md): a path the person typed
// on Windows (`C:\certs\ca.crt`) as the bridge reads paths (`C:/certs/ca.crt`, the spelling the
// desk's dialogs answer with), a file's name from a path with either separator, and where libpq
// reads the password file. Pure: the platform is a parameter.

/** @typedef {import("./clients.js").Platform} Platform */

/** A drive-letter path with its backslashes as slashes; every other path as it is. */
export function bridgePath(/** @type {string} */ path) {
  return /^[A-Za-z]:[\\/]/u.test(path) ? path.replaceAll("\\", "/") : path;
}

/** The last part of a path, `/` or `\` separated, trailing separators left out. */
export function fileName(/** @type {string} */ path) {
  const trimmed = path.replace(/[\\/]+$/u, "");
  return trimmed.split(/[\\/]/u).at(-1) || path;
}

/** The password file libpq reads when PGPASSFILE is not set, as the person finds it. */
export const passwordFile = (/** @type {Platform} */ platform) =>
  platform === "windows" ? "%APPDATA%\\postgresql\\pgpass.conf" : "~/.pgpass";
