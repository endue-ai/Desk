// Compose up a file: the compose.yaml's path, a project name (or Compose's from the folder),
// build and pull switches, and Compose's own lines as it creates and starts each service.

import { upArgs } from "./compose.js";
import { button, h, icon } from "./dom.js";
import { check, field, input } from "./form.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app */
export function openComposeDialog(app) {
  const o = { file: "", project: "", build: false, pull: false };
  const out = h("pre.compose-out", { hidden: true });
  const line = h("code.cmd-line");
  const sync = () => {
    try {
      line.textContent = `docker ${upArgs(o).join(" ")}`;
      go.disabled = false;
    } catch (error) {
      line.textContent = String(/** @type {any} */ (error)?.message ?? error);
      go.disabled = true;
    }
  };
  const go = button({
    label: "Compose up",
    icon: "play",
    kind: "desk-btn-primary",
    onClick: async () => {
      go.disabled = true;
      out.hidden = false;
      out.textContent = "";
      const dir = o.file.slice(0, o.file.lastIndexOf("/")) || "/";
      try {
        await app.docker(upArgs(o), {
          cwd: dir,
          timeoutMs: 0,
          onLine: (_stream, text) => {
            out.textContent += `${text}\n`;
            out.scrollTop = out.scrollHeight;
          },
        });
        app.toast("The stack is up.", "success");
        void app.engine.load("projects");
        void app.engine.load("containers");
        dialog.close();
        app.go("compose");
      } catch (error) {
        out.textContent += `\n${String(/** @type {any} */ (error)?.message ?? error)}\n`;
        go.disabled = false;
      }
    },
  });
  const dialog = app.overlay.dialog({
    title: "Compose up a file",
    subtitle: "Create and start every service a compose.yaml describes",
    icon: "stack",
    wide: true,
    body: [
      field(
        "Compose file",
        input({
          placeholder: "/Users/you/code/app/compose.yaml",
          mono: true,
          label: "Compose file",
          onInput: (v) => {
            o.file = v.trim();
            sync();
          },
        }),
        "The whole path: Compose runs in its folder, where .env and relative paths are read",
      ),
      field(
        "Project name",
        input({
          placeholder: "Compose names it after the folder",
          label: "Project name",
          onInput: (v) => {
            o.project = v;
            sync();
          },
        }),
      ),
      h(
        "div.checks",
        null,
        check("Build images that have a build section first (--build)", false, (on) => {
          o.build = on;
          sync();
        }),
        check("Pull every image again (--pull always)", false, (on) => {
          o.pull = on;
          sync();
        }),
      ),
      h(
        "div.cmd-preview",
        null,
        h("span.field-label", null, "Command line"),
        h("div.cmd-box", null, icon("terminal", 14), line),
      ),
      out,
    ],
    actions: [
      button({ label: "Close", kind: "desk-btn-quiet", onClick: () => dialog.close() }),
      go,
    ],
  });
  sync();
}
