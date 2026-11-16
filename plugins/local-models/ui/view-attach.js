// The composer's attachments: a button that opens files, images pasted, files dropped from the desk;
// each waits as a chip (an image as its thumbnail) until the message goes, and can be taken off.
// A model that does not see images says so before the message is sent.

import { pastedImages, readAttachment } from "./attach.js";
import { fill, h, icon, iconButton } from "./dom.js";
import { modelKey } from "./models.js";

/** @typedef {import("./app.js").App} App @typedef {import("./attach.js").Attachment} Attachment */

/** @param {App} app @param {{ field: HTMLTextAreaElement, box: HTMLElement, onChange: () => void }} o */
export function attachView(app, o) {
  /** @type {Attachment[]} */
  let pending = [];
  const tray = h("div.lm-tray");
  const bridge = app.store.bridge;

  /** @param {string[]} paths */
  async function addPaths(paths) {
    for (const path of paths) {
      try {
        pending = [...pending, await readAttachment(bridge, path)];
      } catch (e) {
        app.toast(e instanceof Error ? e.message : String(e), "error");
      }
    }
    draw();
  }

  async function pick() {
    const answer = await bridge
      .call("dialog.open", { kind: "files", multiple: true, title: "Attach files" })
      .catch(() => undefined);
    if (answer?.paths?.length) await addPaths(answer.paths);
  }

  function draw() {
    const { thread, selected, models } = app.S.get();
    const model = models.find((m) => modelKey(m) === (thread?.model ?? selected));
    const images = pending.filter((a) => a.kind === "image");
    const blind = images.length && model && !model.caps.includes("vision");
    tray.hidden = !pending.length;
    fill(
      tray,
      pending.map((a, i) =>
        h(
          "div.lm-chip-file",
          {
            dataset: { kind: a.kind },
            title: a.kind === "doc" ? `${a.doc.chars.toLocaleString()} characters` : a.image.name,
          },
          a.kind === "image"
            ? h("img", { src: `data:${a.image.type};base64,${a.image.data}`, alt: a.image.name })
            : h("span.lm-chip-file-icon", null, icon("file")),
          h("span.lm-chip-file-name", null, a.kind === "image" ? a.image.name : a.doc.name),
          a.kind === "doc"
            ? h("span.lm-muted", null, `${Math.max(1, Math.round(a.doc.chars / 4000))}K tokens`)
            : null,
          iconButton("x", "Take it off", () => {
            pending = pending.filter((_, j) => j !== i);
            draw();
          }),
        ),
      ),
      blind
        ? h(
            "div.lm-tray-warn",
            null,
            icon("eye"),
            `${model?.name} may not see images: pick a vision model.`,
          )
        : null,
    );
    o.onChange();
  }

  o.field.addEventListener("paste", async (e) => {
    const images = await pastedImages(e);
    if (!images.length) return;
    e.preventDefault();
    pending = [...pending, ...images];
    draw();
  });
  app.dnd?.onDrop(
    o.box,
    async (drop) => {
      const paths = (drop.paths ?? [])
        .map((p) => (typeof p === "string" ? p : /** @type {any} */ (p).path))
        .filter(Boolean);
      if (paths.length) await addPaths(paths);
      else if (drop.text) {
        o.field.value += drop.text;
        o.field.dispatchEvent(new Event("input"));
      }
      return { effect: "copy" };
    },
    { accept: ["desk/paths", "desk/text"], effects: ["copy"] },
  );
  app.S.on(["selected", "thread"], () => pending.length && draw());

  const button = iconButton("paperclip", "Attach images or files", () => void pick(), {
    class: "lm-attach",
  });
  return {
    tray,
    button,
    /** Take what is waiting, for the message being sent. */
    take() {
      const out = pending;
      pending = [];
      draw();
      return {
        images: out.flatMap((a) => (a.kind === "image" ? [a.image] : [])),
        docs: out.flatMap((a) => (a.kind === "doc" ? [a.doc] : [])),
      };
    },
    get count() {
      return pending.length;
    },
    addPaths,
  };
}
