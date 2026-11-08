// A temporary, bounded preview. The sequence prevents a late read from replacing a newer file.
// URLs belong to this controller and are released when its selection changes or it closes.

/** @typedef {import("./tree.js").Row} Row
 * @typedef {{ path: string, name: string, size?: number, kind: "loading" | "text" | "image" | "details" | "error",
 * text?: string, url?: string, reason?: string, truncated?: boolean }} Preview
 */
export const TEXT_LIMIT = 64 * 1024;
export const IMAGE_LIMIT = 8 * 1024 * 1024;
const TEXT = new Set(
  "txt md markdown json jsonl yaml yml toml xml html htm css scss js jsx ts tsx py rs go sh bash zsh c h cpp hpp java sql csv tsv log ini env conf config lock r".split(
    " ",
  ),
);
const IMAGES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** @param {ReturnType<typeof import("./disk.js").createDisk>} disk
 * @param {(model: Preview | null) => void} show
 */
export function createPreview(disk, show) {
  let active = false;
  let sequence = 0;
  /** @type {string | undefined} */
  let url;
  const release = () => {
    if (url) URL.revokeObjectURL(url);
    url = undefined;
  };
  const close = () => {
    active = false;
    sequence++;
    release();
    show(null);
  };
  const select = async (/** @type {Row | undefined} */ row) => {
    if (!active) return;
    const current = ++sequence;
    release();
    if (!row) {
      close();
      return;
    }
    const base = {
      path: row.path,
      name: row.name,
      ...(row.size === undefined ? {} : { size: row.size }),
    };
    const details = (reason) => show({ ...base, kind: "details", reason });
    if (row.kind === "dir" || row.kind === "more") {
      details("Select a file to preview its contents.");
      return;
    }
    const ext = row.name.split(".").at(-1)?.toLowerCase() ?? "";
    const mime = Object.hasOwn(IMAGES, ext) ? IMAGES[ext] : undefined;
    const isText = TEXT.has(ext) || /^(makefile|dockerfile|license|readme)$/i.test(row.name);
    if (!mime && !isText) {
      details("Open this file for its full preview.");
      return;
    }
    if (mime && (row.size ?? 0) > IMAGE_LIMIT) {
      details("Images over 8 MiB open in the image viewer.");
      return;
    }
    show({ ...base, kind: "loading" });
    try {
      const result = await disk.read(row.path, mime ? IMAGE_LIMIT : TEXT_LIMIT);
      if (current !== sequence || !active) return;
      const bytes = Uint8Array.from(atob(result.content), (char) => char.charCodeAt(0));
      const size = result.size ?? row.size ?? bytes.length;
      base.size = size;
      if (mime) {
        if (size > IMAGE_LIMIT) {
          details("Images over 8 MiB open in the image viewer.");
          return;
        }
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        show({ ...base, kind: "image", url });
      } else {
        if (bytes.some((byte) => byte === 0 || byte < 9 || (byte > 13 && byte < 32))) {
          details("This file contains binary data. Open it in its viewer.");
          return;
        }
        let text;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
            stream: size > bytes.length,
          });
        } catch {
          details("This file is not UTF-8 text. Open it in its viewer.");
          return;
        }
        show({ ...base, kind: "text", text, truncated: size > TEXT_LIMIT });
      }
    } catch (error) {
      if (current === sequence && active)
        show({
          ...base,
          kind: "error",
          reason: error instanceof Error ? error.message : String(error),
        });
    }
  };
  return {
    active: () => active,
    close,
    select,
    async toggle(row) {
      if (active) close();
      else {
        active = true;
        await select(row);
      }
    },
  };
}
