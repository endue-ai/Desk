// Previews of the selected entry: its first bytes, read as a job on the progress element so a long
// decode (an entry deep in a solid RAR, a file on a disk image) shows how far it is and can be
// cancelled; a preview asked for later stops the one before. No DOM: it hands models to the view.
import { formatSize } from "./bytes.js";
import { ENCRYPTED } from "./formats/archive.js";
import { detectFormat } from "./formats/index.js";
import { HEX_LIMIT, previewOf, TEXT_LIMIT } from "./preview.js";
import { memorySource } from "./source.js";

/**
 * @typedef {import("./formats/archive.js").Archive} Archive
 * @typedef {import("./formats/archive.js").Entry} Entry
 * @typedef {import("./preview.js").PreviewModel} PreviewModel
 * @typedef {import("./opening.js").Level} Level
 */

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
const aborted = (/** @type {unknown} */ error) =>
  /** @type {{ name?: string } | null} */ (error)?.name === "AbortError";

/**
 * @param {{ preview(model: PreviewModel | null): void }} view
 * @param {ReturnType<typeof import("./jobs.js").createJobs>} jobs
 * @param {() => Level | undefined} top the level shown
 */
export function createPreviews(view, jobs, top) {
  let previewed = 0;
  /** Cancels the preview being read, when another is asked for. */
  let unpreview = () => {};

  /**
   * Read part of an entry as a job on the progress element, so a long decode can be cancelled.
   * @param {Archive} archive @param {Entry} entry @param {number} limit @param {string} label
   * @param {AbortSignal} [signal] stops it as Cancel does
   */
  const reading = (archive, entry, limit, label, signal = undefined) =>
    jobs.run(
      label,
      "",
      (job) => {
        const report = (/** @type {number} */ done, /** @type {number} */ total) =>
          job.report(done, total, `${formatSize(done)} of ${formatSize(total)} decoded`);
        return archive.read(entry, limit, { signal: job.signal, report });
      },
      { signal },
    );

  /** Preview the selected row: its first bytes, read now (a preview asked for later stops it). */
  const preview = async () => {
    const token = ++previewed;
    unpreview();
    const at = top();
    const node = at?.selected == null ? undefined : at.tree.byId.get(at.selected);
    if (!at?.archive || !node) return view.preview(null);
    const archive = at.archive;
    const entry = node.entry;
    const name = node.name;
    /** @param {PreviewModel} model */
    const show = (model) => {
      if (token === previewed) view.preview(model);
    };
    if (node.kind === "folder")
      return show({
        kind: "folder",
        name,
        caption: `${node.files} ${node.files === 1 ? "file" : "files"}, ${formatSize(node.size)}`,
      });
    if (!entry) return view.preview(null);
    if (entry.encrypted) return show({ kind: "message", name, text: ENCRYPTED });
    if (entry.refusal) return show({ kind: "message", name, text: entry.refusal });
    if (entry.kind === "link")
      return show({ kind: "message", name, text: `A link to ${entry.link ?? "a path not read"}.` });
    const stop = new AbortController();
    unpreview = () => stop.abort();
    const read = (/** @type {number} */ limit) =>
      reading(archive, entry, limit, `Reading ${name}`, stop.signal);
    try {
      const big = entry.size > TEXT_LIMIT;
      const bytes = await read(big ? TEXT_LIMIT : Number.POSITIVE_INFINITY);
      if (token !== previewed) return;
      const inner = await detectFormat(
        memorySource(bytes.subarray(0, Math.max(HEX_LIMIT, 64 * 1024))),
        name,
      ).catch(() => null);
      const kind =
        inner && inner.key !== "img" && inner.key !== "tar"
          ? inner.label
          : inner?.key === "tar" && /\.tar$/i.test(name)
            ? "tar"
            : "";
      let shown = bytes;
      if (
        !kind &&
        big &&
        /^\x89PNG|^\xff\xd8\xff|^GIF8|^RIFF/.test(String.fromCharCode(...bytes.subarray(0, 4)))
      )
        shown = await read(Math.min(entry.size, 32 * 1024 * 1024));
      if (token === previewed) show(previewOf(name, entry.size, shown, kind));
    } catch (error) {
      if (token !== previewed) return;
      show({
        kind: "message",
        name,
        text: aborted(error) ? `Reading ${name} was cancelled.` : message(error),
      });
    }
  };

  return { reading, preview };
}
