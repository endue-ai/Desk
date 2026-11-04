// desk.universal: opens universal views (ADR 0084) on one overlay, with the public SDK only, as a
// community plugin would: desk.universal.open { view | file | url | data, type?, title? }.
import "@endue-ai/ui";
import { defineUiPlugin, parseYaml } from "@endue-ai/plugin-sdk";
import { viewOf } from "./open.js";
import { createScreen } from "./screen.js";

defineUiPlugin({
  mount(ctx) {
    const root = /** @type {HTMLElement} */ (document.getElementById("root"));
    const screen = createScreen(root, ctx);
    /** @param {string} path */
    const read = async (path) => {
      const scope = { permission: /** @type {const} */ ("fs:read"), paths: [path] };
      const file = await ctx.bridge.call("fs.read", { path, encoding: "utf8", scope });
      return file.encoding === "base64"
        ? new TextDecoder().decode(Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)))
        : file.content;
    };
    const close = () => {
      screen.close();
      ctx.surface.hide();
      return {};
    };
    ctx.commands.on("desk.universal.open", async (args) => {
      const view = await viewOf(/** @type {import("./open.js").OpenArgs} */ (args ?? {}), {
        parse: parseYaml,
        read,
      });
      screen.open(view);
      ctx.surface.show();
      return { opened: true, type: view.type };
    });
    ctx.commands.on("desk.universal.close", close);
    ctx.commands.on("desk.universal.allow", () => screen.allow());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.defaultPrevented && screen.view) close();
    });
  },
});
