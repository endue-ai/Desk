// Settings: where docker is found, how long a stop waits, how many log lines open and are kept,
// the shell a terminal or the Exec tab starts, and whether removing asks first. Each change is the
// desk's own setting (endue.docker-studio.*), so it holds on every desk the person uses.

import { button, h, icon } from "./dom.js";
import { check, field, input } from "./form.js";
import { KEYS, settle } from "./settings.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app */
export function createSettings(app) {
  const save = async (/** @type {keyof typeof KEYS} */ key, /** @type {unknown} */ raw) => {
    const value = settle(key, raw);
    /** @type {any} */ (app.settings)[key] = value;
    try {
      await app.ctx.settings?.set?.(KEYS[key], value);
      saved.textContent = "Saved.";
    } catch (error) {
      saved.textContent = String(/** @type {any} */ (error)?.message ?? error);
    }
  };
  const saved = h("span.muted.saved", { role: "status" });
  const num = (
    /** @type {keyof typeof KEYS} */ key,
    /** @type {string} */ label,
    /** @type {string} */ hint,
  ) =>
    field(
      label,
      input({
        value: String(app.settings[key]),
        mono: true,
        label,
        onInput: (v) => void save(key, Number(v)),
      }),
      hint,
    );
  const engineLine = h("p.muted");
  const drawEngine = () => {
    const info = app.store.state.engine.info;
    engineLine.replaceChildren(
      icon("info", 13),
      ` ${info ? `docker ${info.client} talks to engine ${info.server} (API ${info.api}) through ${app.store.state.context || info.context || "the default context"}.` : "No engine answers now."}`,
    );
  };
  drawEngine();
  const element = h(
    "div.page.settings",
    null,
    h(
      "article.card",
      null,
      h("header.card-head", null, h("h2", null, "The docker program"), saved),
      h(
        "div.settings-body",
        null,
        field(
          "Where docker is",
          input({
            value: app.settings.path,
            mono: true,
            placeholder: "The desk's PATH, then where docker is usually installed",
            label: "PATH",
            onInput: (v) => void save("path", v),
          }),
          "Folders separated by :, for a desk started without the shell's PATH",
        ),
        engineLine,
        button({
          label: "Contexts",
          icon: "server",
          kind: "desk-btn-quiet",
          onClick: () => app.go("contexts"),
        }),
      ),
    ),
    h(
      "article.card",
      null,
      h("header.card-head", null, h("h2", null, "Containers and logs")),
      h(
        "div.settings-body.grid2",
        null,
        num("stopTimeout", "Seconds a stop waits", "Before docker kills the container (0 to 600)"),
        field(
          "Shell in a container",
          input({
            value: app.settings.shell,
            mono: true,
            label: "Shell",
            onInput: (v) => void save("shell", v),
          }),
          "/bin/sh, or /bin/bash where the image has it",
        ),
        num(
          "logTail",
          "Log lines to open with",
          "The last lines read when logs open (0 to 100000)",
        ),
        num("logMax", "Log lines to keep", "While following (100 to 100000)"),
      ),
    ),
    h(
      "article.card",
      null,
      h("header.card-head", null, h("h2", null, "Asking first")),
      h(
        "div.settings-body",
        null,
        check(
          "Ask before removing, killing, taking down or pruning",
          app.settings.confirm,
          (on) => void save("confirm", on),
        ),
        h(
          "p.muted",
          null,
          "A command AI suggests is always shown and asked first, whatever this says.",
        ),
      ),
    ),
  );
  return {
    element,
    title: "Settings",
    subtitle: "Docker Studio",
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("engine") || changed.has("context")) drawEngine();
    },
  };
}
