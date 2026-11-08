// desk.universal: universal views (ADR 0087) on one overlay, with the public SDK only, as a
// community plugin would. desk.universal.open { view | id | file | url | data, type?, title?, params?,
// notice? } draws one, or a page of them (ADR 0103); desk.universal.drafting and desk.universal.preview are Eris's (ADR 0073, 0102): the
// drafting state at once, then the preview's choice; desk.universal.build opens the view builder;
// desk.universal.folder { path } answers a folder as universal data.
import "@endue-ai/ui";
import { defineUiPlugin, parseYaml } from "@endue-ai/plugin-sdk";
import { createBuilder } from "./builder.js";
import { folderData } from "./folder.js";
import { isView, viewOf } from "./open.js";
import { createScreen } from "./screen.js";

const FS = /** @type {const} */ ("fs:read");

defineUiPlugin({
  mount(ctx) {
    const root = /** @type {HTMLElement} */ (document.getElementById("root"));
    const screen = createScreen(root, ctx);
    /** @param {boolean} building */
    const mode = (building) => {
      root.toggleAttribute("data-building", building);
      builder.element.hidden = !building;
    };
    const builder = createBuilder(root, ctx, {
      saved(view) {
        mode(false);
        const where = `~/.desk/views/${view.id}.yaml`;
        const action = { title: "Edit", command: "desk.universal.build", args: { id: view.id } };
        screen.open(view, { notice: { text: `Saved ${where}`, action } });
      },
      cancelled: () => close(),
    });
    mode(false);
    /** @param {string} path */
    const read = async (path) => {
      const scope = { permission: FS, paths: [path] };
      const file = await ctx.bridge.call("fs.read", { path, encoding: "utf8", scope });
      return file.encoding === "base64"
        ? new TextDecoder().decode(Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)))
        : file.content;
    };
    const io = { parse: parseYaml, read, get: (/** @type {string} */ id) => ctx.views.get(id) };
    const close = () => {
      mode(false);
      screen.close();
      ctx.surface.hide();
      return {};
    };
    /** @param {unknown} args */
    const argsOf = (args) => /** @type {Record<string, any>} */ (args ?? {});

    ctx.commands.on("desk.universal.open", async (args) => {
      const given = argsOf(args);
      // Opened again under the id it is drawn with (Apply): keep what is drawn, read nothing.
      const view =
        given.id !== undefined && screen.view?.id === given.id && !given.view
          ? screen.view
          : await viewOf(/** @type {import("./open.js").OpenArgs} */ (given), io);
      mode(false);
      const params = given.params && typeof given.params === "object" ? given.params : undefined;
      screen.open(view, {
        ...(given.notice ? { notice: given.notice } : {}),
        ...(params ? { params } : {}),
      });
      ctx.surface.show();
      return {
        opened: true,
        ...("sections" in view ? { sections: view.sections.length } : { type: view.type }),
      };
    });
    ctx.commands.on("desk.universal.close", (args) => {
      const { id } = argsOf(args);
      if (typeof id === "string" && screen.view?.id !== id) return { closed: false };
      close();
      return { closed: true };
    });
    ctx.commands.on("desk.universal.allow", () => screen.allow());
    ctx.commands.on("desk.universal.drafting", (args) => {
      mode(false);
      screen.drafting(String(argsOf(args).note ?? "Eris is making a view…"));
      ctx.surface.show();
      return { shown: true };
    });
    ctx.commands.on("desk.universal.preview", async (args) => {
      const { view, note } = argsOf(args);
      if (!isView(view))
        throw new Error("view: not a universal view (it needs a type and a source)");
      mode(false);
      ctx.surface.show();
      const choice = await screen.preview(view, String(note ?? "Eris made this."));
      // Discarded (the button, Escape, a newer preview): nothing stays drawn.
      if (choice.choice === "discard" && !screen.bar.waiting) close();
      return choice;
    });
    ctx.commands.on("desk.universal.build", async (args) => {
      const given = argsOf(args);
      const view =
        given.id !== undefined || given.view !== undefined
          ? await viewOf(/** @type {import("./open.js").OpenArgs} */ (given), io)
          : undefined;
      screen.close();
      mode(true);
      ctx.surface.show();
      await builder.start(view);
      return { building: true };
    });
    ctx.commands.on("desk.universal.folder", async (args) => {
      const path = String(argsOf(args).path ?? "");
      const scope = { permission: FS, paths: [path] };
      const listed = await ctx.bridge.call("fs.list", { path, scope });
      return folderData(path, listed.entries);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (screen.view || screen.bar.waiting || !builder.element.hidden) close();
    });
  },
});
