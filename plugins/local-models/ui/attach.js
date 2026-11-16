// What a person attaches to a message: images, which go to a model that sees as they are, and text
// files (notes, code, data), whose words go in the message or, when they are long, are searched for
// the passages the question needs (rag.js). Files come from the open dialog, a drop from the desk, or
// a paste.

/**
 * @typedef {import("./chat-types.js").Image} Image
 * @typedef {{ name: string, path?: string, text: string, chars: number, truncated?: boolean }} Doc
 * @typedef {{ kind: "image", image: Image, path?: string } | { kind: "doc", doc: Doc }} Attachment
 */

export const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
export const TEXT_EXT =
  /\.(txt|md|markdown|mdx|rst|org|csv|tsv|json|jsonl|ya?ml|toml|ini|cfg|conf|env\.example|xml|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|ps1|sql|r|lua|pl|ex|exs|erl|hs|scala|clj|dart|vue|svelte|tex|log|diff|patch|proto|graphql|gradle|dockerfile|makefile|gitignore)$/i;
const IMAGE_LIMIT = 12 * 1024 * 1024;
const TEXT_LIMIT = 2 * 1024 * 1024;
/** How much of one file a thread keeps; a longer one is searched, not sent whole. */
export const KEEP_CHARS = 400_000;

/** @param {string} path */
const nameOf = (path) => path.split("/").pop() ?? path;
/** @param {string} name */
const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();

/** HTML as its words, for a page saved to disk. @param {string} html */
export function htmlText(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A text's characters, kept up to KEEP_CHARS. @param {string} name @param {string} text @param {string} [path] @returns {Doc} */
export function docOf(name, text, path) {
  const clean = /\.html?$/i.test(name) ? htmlText(text) : text.replace(/\r\n?/g, "\n");
  return {
    name,
    path,
    text: clean.slice(0, KEEP_CHARS),
    chars: clean.length,
    ...(clean.length > KEEP_CHARS ? { truncated: true } : {}),
  };
}

/**
 * Read one file the person chose.
 * @param {import("./net.js").Bridge} bridge @param {string} path @returns {Promise<Attachment>}
 */
export async function readAttachment(bridge, path) {
  const name = nameOf(path);
  const ext = extOf(name);
  const type = /** @type {Record<string, string>} */ (IMAGE_TYPES)[ext];
  if (type) {
    const answer = await bridge.call("fs.read", { path, encoding: "base64" });
    if (answer.size > IMAGE_LIMIT) throw new Error(`${name} is larger than 12 MB`);
    return { kind: "image", image: { name, type, data: answer.content }, path };
  }
  const head = await bridge.call("fs.read", { path, offset: 0, length: 0, encoding: "base64" });
  if (head.size > TEXT_LIMIT) throw new Error(`${name} is larger than 2 MB of text`);
  let answer;
  try {
    answer = await bridge.call("fs.read", { path, encoding: "utf8" });
  } catch (e) {
    if (/** @type {{ code?: string }} */ (e)?.code === "invalid_params")
      throw new Error(`${name} is not text: attach images, notes, code or data files`);
    throw e;
  }
  if (!TEXT_EXT.test(name) && answer.content.slice(0, 4096).includes("\u0000"))
    throw new Error(`${name} is not text`);
  return { kind: "doc", doc: docOf(name, answer.content, path) };
}

/** Images pasted from the clipboard, as attachments. @param {ClipboardEvent} e @returns {Promise<Attachment[]>} */
export async function pastedImages(e) {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  return Promise.all(
    files.map(async (f, i) => {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(f);
      });
      return /** @type {Attachment} */ ({
        kind: "image",
        image: {
          name: f.name || `pasted-${i + 1}.png`,
          type: f.type,
          data: /** @type {string} */ (data),
        },
      });
    }),
  );
}

/** The words a message sends with its documents: each one whole, fenced by its name. @param {Doc[]} docs */
export function inlineDocs(docs) {
  return docs
    .map(
      (d) =>
        `<file name="${d.name}">\n${d.text}${d.truncated ? "\n[…the rest of the file is left out]" : ""}\n</file>`,
    )
    .join("\n\n");
}
