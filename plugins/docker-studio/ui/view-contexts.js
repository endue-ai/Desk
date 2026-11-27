// Contexts: every engine the docker program knows (docker context ls), the one the CLI uses by
// default and the one the studio uses (for itself only: the person's CLI is left as it is), a
// check that says whether each answers and with which version, and Use to switch the studio to it.

import { button, h, icon, pill } from "./dom.js";
import { contextName } from "./refs.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app */
export function createContexts(app) {
  /** @type {Map<string, { ok: boolean, text: string } | "checking">} */
  const checks = new Map();
  const list = h("div.context-list");
  const element = h(
    "div.page",
    null,
    h(
      "p.muted.head-note",
      null,
      "A context is an engine the docker program can talk to: this computer's, a remote one over SSH, a cloud one. The studio's choice is its own; your terminal's docker is left as it is.",
    ),
    list,
  );

  const check = async (/** @type {string} */ name) => {
    checks.set(name, "checking");
    draw();
    try {
      const { stdout } = await app.runner.run(["version", "--format", "{{.Server.Version}}"], {
        timeoutMs: 15_000,
        context: contextName(name),
      });
      checks.set(name, { ok: true, text: `Engine ${stdout.trim()} answers` });
    } catch (error) {
      checks.set(name, { ok: false, text: String(/** @type {any} */ (error)?.message ?? error) });
    }
    draw();
  };

  const draw = () => {
    const { contexts, context } = app.store.state;
    const using = context || contexts.find((c) => c.current)?.name || "default";
    list.replaceChildren(
      ...contexts.map((c) => {
        const result = checks.get(c.name);
        const mine = c.name === using;
        const remote = /^(ssh|tcp|https?):/.test(c.endpoint);
        return h(
          `article.card.context-card${mine ? ".mine" : ""}`,
          null,
          h("span.hero-icon", null, icon(remote ? "globe" : "server", 22)),
          h(
            "div.context-text",
            null,
            h(
              "h3",
              null,
              c.name,
              mine ? pill("The studio uses it", "ok") : null,
              c.current ? pill("The CLI's default") : null,
            ),
            h(
              "p.muted",
              null,
              c.description || (remote ? "A remote engine" : "An engine on this computer"),
            ),
            h("code.mono", null, c.endpoint),
            result === "checking"
              ? h("p.context-check", null, h("span.spinner"), " Checking…")
              : result
                ? h(
                    `p.context-check.${result.ok ? "ok" : "bad"}`,
                    null,
                    icon(result.ok ? "check" : "alert", 13),
                    ` ${result.text}`,
                  )
                : c.error
                  ? h("p.context-check.bad", null, icon("alert", 13), ` ${c.error}`)
                  : null,
          ),
          h(
            "div.context-actions",
            null,
            button({
              label: "Check",
              icon: "pulse",
              kind: "desk-btn-quiet",
              onClick: () => void check(c.name),
            }),
            mine
              ? null
              : button({
                  label: "Use",
                  icon: "plug",
                  kind: "desk-btn-primary",
                  onClick: () => app.useContext(c.name),
                }),
          ),
        );
      }),
    );
    if (contexts.length === 0)
      list.append(
        h("p.card-empty", null, icon("info"), "docker knows no contexts, or does not answer."),
      );
  };

  draw();
  void app.engine.load("contexts").catch(() => {});
  return {
    element,
    title: "Contexts",
    get subtitle() {
      return `The studio uses ${app.store.state.context || "the CLI's default"}`;
    },
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("contexts") || changed.has("context")) draw();
    },
  };
}
