// The plugin's page on jsdom: index.html's body as the desk serves it (without its script), its
// stylesheets when a test reads computed styles, and the plugin mounted on the SDK's test host with
// view.js drawing into it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createView } from "../ui/view.js";
import { type MountOptions, mount } from "./harness";

const ui = (file: string) => readFileSync(join(import.meta.dirname, "../ui", file), "utf8");

/** A fresh body (no view of an earlier test still listens) and, with `styles`, the page's CSS. */
export function loadPage(doc: Document, { styles = false } = {}) {
  const parsed = new DOMParser().parseFromString(ui("index.html"), "text/html");
  for (const script of parsed.querySelectorAll("script")) script.remove();
  doc.documentElement.replaceChild(doc.importNode(parsed.body, true), doc.body);
  const style = doc.createElement("style");
  if (styles) style.textContent = ["style.css", "messages.css", "layouts.css"].map(ui).join("\n");
  doc.head.replaceChildren(style);
}

/** The plugin mounted with the DOM view drawing into the document. */
export async function drawn(options: MountOptions = {}) {
  return mount({
    ...options,
    dom: (app) =>
      createView(document, {
        command: (id, args) =>
          app()
            ?.command(id, args ?? {})
            .catch(() => {}),
        open: (k) =>
          app()
            ?.openConversation(k)
            .catch(() => {}),
        activate: (k) =>
          app()
            ?.activate(k)
            .catch(() => {}),
        select: (k) => app()?.select(k),
        key: (name, where) => app()?.key(name, where) ?? false,
        more: (where) => app()?.more(where),
        type: (target, text) => app()?.type(target, text),
        cancelEdit: () => app()?.cancelEdit() ?? false,
        closeThread: () => app()?.closeThread() ?? false,
        retry: (k) => app()?.retry(k),
        discard: (k) => app()?.discard(k),
        link: (url) => app()?.link(url),
      }),
  });
}
