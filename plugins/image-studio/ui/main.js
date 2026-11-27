import { byteSource, defineUiPlugin, startWorker } from "@endue-ai/plugin-sdk";
import "@endue-ai/ui";
import { createClient } from "./client.js";
import { createControls } from "./controls.js";
import { createFiles, nameOf } from "./files.js";
import { createSession } from "./session.js";

defineUiPlugin({
  async mount(ctx) {
    const byId = (id) => document.getElementById(id);
    const open = byId("open");
    const undo = byId("undo");
    const redo = byId("redo");
    const discard = byId("discard");
    const exportPng = byId("export");
    const preview = byId("preview");
    const empty = byId("empty");
    const edit = byId("edit");
    const operation = byId("operation");
    const controls = createControls(operation, byId("values"));
    const status = byId("status");
    const error = byId("error");
    const progress = document.querySelector("desk-progress");
    const confirmation = byId("confirm-discard");
    let busy = false;
    let discardTarget;

    const paint = (frame) => {
      preview.hidden = !frame;
      empty.hidden = Boolean(frame);
      if (frame) {
        const { width, height } = frame.preview;
        preview.width = width;
        preview.height = height;
        preview
          .getContext("2d")
          .putImageData(
            new ImageData(new Uint8ClampedArray(frame.data.buffer), width, height),
            0,
            0,
          );
      } else {
        preview.width = 0;
        preview.height = 0;
      }
    };
    const session = createSession(createFiles(ctx, byteSource), createClient(startWorker), paint);
    const update = () => {
      const info = session.inspect();
      open.disabled = busy;
      undo.disabled = busy || !info.canUndo;
      redo.disabled = busy || !info.canRedo;
      discard.hidden = !info.dirty;
      discard.disabled = busy;
      exportPng.disabled = busy || !info.document;
      edit.hidden = !info.document;
      for (const control of edit.elements) control.disabled = busy;
      status.textContent = info.document
        ? `${nameOf(info.path)} · ${info.width} × ${info.height} px${info.dirty ? " · Unexported edits" : ""}`
        : "";
    };
    const run = async (operation) => {
      if (busy) throw new Error("Wait for the current image operation to finish.");
      busy = true;
      error.hidden = true;
      progress.hidden = false;
      update();
      try {
        const result = await operation();
        controls.render(session.inspect());
        return result;
      } catch (reason) {
        error.textContent = reason.message;
        error.hidden = false;
        throw reason;
      } finally {
        busy = false;
        progress.hidden = true;
        update();
      }
    };
    const act = (operation) => {
      void run(operation).catch(() => {});
    };
    open.addEventListener("click", () => act(() => session.open()));
    undo.addEventListener("click", () => act(() => session.edit("undo", session.inspect())));
    redo.addEventListener("click", () => act(() => session.edit("redo", session.inspect())));
    exportPng.addEventListener("click", () => act(() => session.export()));
    discard.addEventListener("click", () => {
      discardTarget = session.inspect();
      confirmation.returnValue = "";
      confirmation.showModal();
    });
    confirmation.addEventListener("close", () => {
      if (confirmation.returnValue === "discard") act(() => session.discard(discardTarget));
    });
    operation.addEventListener("change", () => controls.render(session.inspect()));
    edit.addEventListener("submit", (event) => {
      event.preventDefault();
      act(() => session.edit("apply", { ...session.inspect(), operations: [controls.read()] }));
    });

    const on = (name, handler) => ctx.commands.on(`endue.image-studio.${name}`, handler);
    on("inspect", () => session.inspect());
    on("open", ({ path }) => run(() => session.open(path)));
    for (const name of ["apply", "undo", "redo"]) {
      on(name, (args) => run(() => session.edit(name, args)));
    }
    on("export", (_args, invocation) => {
      if (invocation?.caller !== "desk")
        throw new Error("Choose the export destination in Image Studio.");
      return run(() => session.export());
    });
    ctx.surface.onUnload(session.snapshot);
    update();
    if (ctx.surface.restored)
      await run(() => session.restore(ctx.surface.restored)).catch(() => {});
  },
});
