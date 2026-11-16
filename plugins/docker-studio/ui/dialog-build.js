// Build an image: the context folder, the Dockerfile (the folder's own when empty), a tag, a stage,
// platforms, build arguments, --no-cache and --pull, and the command line it makes; the build then
// runs on the Builds page, its steps shown as they go.

import { buildArgs, buildForm } from "./build.js";
import { button, h, icon } from "./dom.js";
import { check, field, input, rows, select } from "./form.js";
import { shellLine } from "./images.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app @param {Partial<import("./build.js").BuildForm>} [preset] */
export function openBuildDialog(app, preset = {}) {
  const form = { ...buildForm(), ...preset };
  const line = h("code.cmd-line");
  const problem = h("p.form-error", { role: "alert" });
  const go = button({
    label: "Build",
    icon: "build",
    kind: "desk-btn-primary",
    onClick: () => {
      try {
        buildArgs(form);
      } catch {
        return;
      }
      dialog.close();
      app.go("builds");
      void app.builds
        .start(form)
        .catch((/** @type {any} */ e) => app.toast(String(e?.message ?? e), "danger"));
    },
  });
  const changed = () => {
    try {
      line.textContent = shellLine(buildArgs(form));
      problem.textContent = "";
      go.disabled = false;
    } catch (error) {
      line.textContent = "";
      problem.textContent = form.context
        ? String(/** @type {any} */ (error)?.message ?? error)
        : "";
      go.disabled = true;
    }
  };
  const text = (
    /** @type {keyof typeof form} */ key,
    /** @type {string} */ placeholder,
    mono = true,
  ) =>
    input({
      value: String(form[key] ?? ""),
      placeholder,
      mono,
      label: String(key),
      onInput: (v) => {
        /** @type {any} */ (form)[key] = v;
        changed();
      },
    });
  const dialog = app.overlay.dialog({
    title: "Build an image",
    subtitle: "From a folder with a Dockerfile, with BuildKit",
    icon: "build",
    wide: true,
    body: h(
      "div.run-form",
      null,
      h(
        "div.form-grid",
        null,
        field(
          "Context folder",
          text("context", "/Users/you/code/app"),
          "Everything the Dockerfile may COPY is under it",
          "span2",
        ),
        field("Dockerfile", text("dockerfile", "The folder's Dockerfile when empty")),
        field("Tag", text("tag", "app:dev")),
        field(
          "Stage",
          text("target", "The last one when empty"),
          "--target, for a multi-stage Dockerfile",
        ),
        field(
          "Platform",
          select(
            [
              ["", "This engine's"],
              ["linux/amd64", "linux/amd64"],
              ["linux/arm64", "linux/arm64"],
              ["linux/amd64,linux/arm64", "Both (needs a builder that can)"],
            ],
            form.platform,
            (v) => {
              form.platform = v;
              changed();
            },
            "Platform",
          ),
        ),
      ),
      rows({
        title: "Build arguments",
        items: form.args,
        make: () => ({ key: "", value: "" }),
        add: "Add a build argument",
        changed,
        row: (a, ch) => [
          input({
            value: a.key,
            placeholder: "NAME",
            mono: true,
            label: "Name",
            onInput: (v) => {
              a.key = v;
              ch();
            },
          }),
          h("span.rows-arrow", null, "="),
          input({
            value: a.value,
            placeholder: "value",
            mono: true,
            label: "Value",
            onInput: (v) => {
              a.value = v;
              ch();
            },
          }),
        ],
      }),
      h(
        "div.checks",
        null,
        check("Build every step again (--no-cache)", form.noCache, (on) => {
          form.noCache = on;
          changed();
        }),
        check("Pull newer base images (--pull)", form.pull, (on) => {
          form.pull = on;
          changed();
        }),
      ),
      h(
        "div.cmd-preview",
        null,
        h("span.field-label", null, "Command line"),
        h("div.cmd-box", null, icon("terminal", 14), line),
      ),
      problem,
    ),
    actions: [
      button({ label: "Cancel", kind: "desk-btn-quiet", onClick: () => dialog.close() }),
      go,
    ],
  });
  changed();
}
