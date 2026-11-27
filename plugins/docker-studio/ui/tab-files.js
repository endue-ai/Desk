// The Files tab: folders with breadcrumbs, folders first, sizes and times, and the file chosen
// shown beside them with its line numbers. The source says how to list and read: a running
// container's own ls and head, or a volume's (files.js volumeSource).

import { button, fill, h, icon } from "./dom.js";
import { crumbs, isText, lsArgs, PREVIEW_BYTES, parentOf, parseLs, readArgs } from "./files.js";
import { bytes } from "./format.js";

/**
 * @typedef {import("./studio.js").App} App @typedef {import("./files.js").Entry} Entry
 * @typedef {{ key: string, start: string, root: string, ready(): string, ls(path: string): string[] | Promise<string[]>,
 *   read(path: string): string[] | Promise<string[]> }} Source `ready()` is "" when it can be read, else why not.
 */

/** A running container as a source of files. @param {import("./parse.js").Container} c @returns {Source} */
export function containerSource(c) {
  return {
    key: c.id,
    start: c.workdir || "/",
    root: "/",
    ready: () =>
      c.state === "running" ? "" : "Files are read inside the container: start it to browse them.",
    ls: (path) => lsArgs(c.id, path),
    read: (path) => readArgs(c.id, path),
  };
}

/** @param {App} app @param {Source} c */
export function createFilesView(app, c) {
  const prefs = app.prefs(`files:${c.key}`, { path: c.start });
  let path = prefs.path;
  /** @type {Entry[]} */
  let entries = [];
  /** @type {Entry | null} */
  let chosen = null;
  const trail = h("nav.crumbs", { "aria-label": "Folder" });
  const list = h("div.file-list", { role: "listbox", "aria-label": "Files", tabindex: "0" });
  const preview = h("div.file-preview");
  const element = h(
    "section.files-view",
    null,
    h(
      "div.files-bar",
      null,
      button({
        label: "Up a folder",
        icon: "arrowLeft",
        hideLabel: true,
        onClick: () => go(parentOf(path)),
      }),
      trail,
      h("span.grow"),
      button({ label: "Reload", icon: "restart", hideLabel: true, onClick: () => go(path) }),
      button({
        label: "Copy the path",
        icon: "copy",
        hideLabel: true,
        onClick: () => void app.act.copy(chosen?.path ?? path, "the path"),
      }),
    ),
    h("div.files-split", null, list, preview),
  );

  const showPreview = async (/** @type {Entry} */ e) => {
    chosen = e;
    for (const el of list.querySelectorAll(".file-row"))
      el.classList.toggle("chosen", /** @type {HTMLElement} */ (el).dataset.path === e.path);
    preview.replaceChildren(h("p.muted.pad", null, "Reading…"));
    try {
      const { stdout } = await app.docker(await c.read(e.path), { timeoutMs: 30_000 });
      if (!isText(stdout)) {
        preview.replaceChildren(
          h(
            "div.preview-empty",
            null,
            icon("file", 28),
            h("b", null, e.name),
            h("p", null, `A binary file of ${bytes(e.size)}.`),
          ),
        );
        return;
      }
      const lines = stdout.split("\n");
      if (lines.at(-1) === "") lines.pop();
      fill(
        preview,
        h(
          "header.preview-head",
          null,
          icon("file", 14),
          h("b", null, e.name),
          h("small.muted", null, bytes(e.size)),
          h("span.grow"),
          button({
            label: "Copy the text",
            icon: "copy",
            hideLabel: true,
            onClick: () => void app.act.copy(stdout, "the text"),
          }),
        ),
        h(
          "pre.code",
          null,
          lines.map((text, i) =>
            h("div.code-line", null, h("span.ln", null, String(i + 1)), h("span", null, text)),
          ),
        ),
        e.size > PREVIEW_BYTES
          ? h("p.muted.pad", null, `The first ${bytes(PREVIEW_BYTES)} of ${bytes(e.size)}.`)
          : null,
      );
    } catch (error) {
      preview.replaceChildren(
        h("p.error-text.pad", null, String(/** @type {any} */ (error)?.message ?? error)),
      );
    }
  };

  const draw = () => {
    fill(
      trail,
      ...crumbs(path).flatMap((crumb, i) => [
        i > 1 ? h("span.crumb-sep", null, "/") : null,
        h(
          "button.desk-btn.desk-btn-quiet.crumb",
          { type: "button", onClick: () => go(crumb.path) },
          crumb.name,
        ),
      ]),
    );
    list.replaceChildren(
      ...entries.map((e) =>
        h(
          `button.desk-btn.desk-btn-quiet.file-row.k-${e.kind}`,
          {
            type: "button",
            role: "option",
            dataset: { path: e.path },
            title: e.target ? `${e.name} → ${e.target}` : e.name,
            onClick: () =>
              e.kind === "dir" || (e.kind === "link" && !e.name.includes("."))
                ? go(e.path)
                : void showPreview(e),
          },
          icon(e.kind === "dir" ? "folder" : e.kind === "link" ? "link" : "file", 15),
          h(
            "span.file-name",
            null,
            e.name,
            e.target ? h("small.muted", null, ` → ${e.target}`) : null,
          ),
          h("span.file-size", null, e.kind === "file" ? bytes(e.size) : ""),
          h("span.file-time", null, e.modified),
          h("span.file-mode.mono", null, e.mode),
        ),
      ),
    );
    if (!entries.length) list.append(h("p.muted.pad", null, "This folder is empty."));
  };

  const go = async (/** @type {string} */ wanted) => {
    // Never above the source's root (a volume's mount point).
    const next =
      c.root === "/" || wanted === c.root || wanted.startsWith(`${c.root}/`) ? wanted : c.root;
    const why = c.ready();
    if (why) {
      list.replaceChildren(h("div.preview-empty", null, icon("folder", 28), h("p", null, why)));
      return;
    }
    list.replaceChildren(h("p.muted.pad", null, "Listing…"));
    try {
      const { stdout } = await app.docker(await c.ls(next), { timeoutMs: 30_000 });
      path = next;
      prefs.path = next;
      entries = parseLs(stdout, next);
      draw();
    } catch (error) {
      list.replaceChildren(
        h("p.error-text.pad", null, String(/** @type {any} */ (error)?.message ?? error)),
      );
    }
  };

  preview.replaceChildren(
    h("div.preview-empty", null, icon("file", 28), h("p", null, "Choose a file to read it here.")),
  );
  void go(path);
  return { element, dispose() {} };
}
