// Paths inside a package (EPUB, XPS): hrefs resolved against the file that holds them, with
// percent-escapes decoded and fragments split off. Absolute URLs (with a scheme) are not paths.

/** Whether an href leaves the package: it has a scheme (https:, mailto:, data:, javascript:...). */
export const isExternal = (/** @type {string} */ href) => /^[a-z][a-z0-9+.-]*:/i.test(href.trim());

/** The folder of a package path, with its trailing slash, or "" at the top. */
export const folderOf = (/** @type {string} */ path) => path.slice(0, path.lastIndexOf("/") + 1);

const decodePath = (/** @type {string} */ text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/**
 * Resolve `href` against `base` (a folder, or a file whose folder is used).
 * @param {string} base
 * @param {string} href
 * @returns {{ path: string, fragment: string }}
 */
export function resolvePath(base, href) {
  const hash = href.indexOf("#");
  const fragment = hash < 0 ? "" : decodePath(href.slice(hash + 1));
  const bare = (hash < 0 ? href : href.slice(0, hash)).split("?")[0] ?? "";
  if (bare === "") return { path: base, fragment };
  const parts = bare.startsWith("/") ? [] : folderOf(base).split("/").filter(Boolean);
  for (const part of decodePath(bare).split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return { path: parts.join("/"), fragment };
}
