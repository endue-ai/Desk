// The Builds section: the builds running now, each step as it goes (cached, done with its time,
// failed with its output, the one running with its last lines), the build cache and what clearing
// it frees, and the last twenty builds to open, run, build again or forget.

import { button, h, icon, pill } from "./dom.js";
import { ago, bytes, duration } from "./format.js";

/** @typedef {import("./studio.js").App} App @typedef {import("./actions-build.js").BuildRecord} BuildRecord */

const STEP_ICON = /** @type {Record<string, import("./dom.js").IconName>} */ ({
  cached: "layers",
  done: "check",
  error: "x",
});

/** One step's row; the running or failed one shows its last lines. */
function stepRow(
  /** @type {import("./build.js").Step | BuildRecord["steps"][number]} */ s,
  /** @type {boolean} */ open,
) {
  const output = "output" in s ? s.output : [];
  return h(
    `li.build-step.s-${s.status}`,
    null,
    h(
      "span.step-icon",
      null,
      s.status === "running" ? h("span.spinner") : icon(STEP_ICON[s.status] ?? "info", 13),
    ),
    s.stage ? h("span.step-stage.mono", null, s.stage) : h("span.step-stage"),
    h("span.step-name.mono", { title: s.name }, s.name),
    h(
      "span.step-time",
      null,
      s.status === "cached" ? "cached" : s.seconds ? `${s.seconds.toFixed(1)} s` : "",
    ),
    open && output.length ? h("pre.step-out", null, output.slice(-12).join("\n")) : null,
  );
}

/** @param {App} app */
export function createBuildsPage(app) {
  const live = h("section.builds-live");
  const cache = h("article.card.cache-card");
  const history = h("article.card");
  /** @type {Set<string>} */
  const opened = new Set();
  const element = h("div.page", null, live, h("div.builds-grid", null, history, cache));

  const drawLive = () => {
    const now = Date.now();
    live.replaceChildren(
      ...app.builds.active().map(({ record, model }) =>
        h(
          "article.card.build-live",
          null,
          h(
            "header.card-head",
            null,
            h("span.spinner"),
            h("h2", null, `Building ${record.tag}`),
            h("span.card-sub.mono", null, record.context),
            h(
              "span.card-sub",
              null,
              `${model.steps.length} steps · ${duration(now - record.started)}`,
            ),
            button({
              label: "Cancel",
              icon: "x",
              kind: "desk-btn-quiet",
              onClick: () => app.builds.cancel(record.id),
            }),
          ),
          h(
            "ol.build-steps",
            null,
            model.steps.map((s) => stepRow(s, s.status === "running" || s.status === "error")),
          ),
        ),
      ),
    );
    live.hidden = app.builds.active().length === 0;
  };

  const drawCache = () => {
    const row = app.store.state.disk.find((d) => d.kind === "cache");
    cache.replaceChildren(
      h("header.card-head", null, h("h2", null, "Build cache")),
      h(
        "div.cache-body",
        null,
        h(
          "p.disk-total",
          null,
          h("b", null, row ? bytes(row.size) : "–"),
          h("span", null, " kept to make builds faster"),
        ),
        row
          ? h("p.muted", null, `${bytes(row.reclaimable)} of it is not used by any image now.`)
          : null,
        button({
          label: "Clear the build cache",
          icon: "broom",
          onClick: () => void app.builds.pruneCache(),
        }),
      ),
    );
  };

  const drawHistory = () => {
    const list = app.builds.history();
    history.replaceChildren(
      h(
        "header.card-head",
        null,
        h("h2", null, "Recent builds"),
        h("span.card-sub", null, String(list.length)),
      ),
      list.length
        ? h(
            "ul.rows.build-history",
            null,
            list.map((r) => {
              const open = opened.has(r.id);
              const model = app.builds.model(r.id);
              return h(
                "li.build-row",
                null,
                h(
                  "div.row",
                  null,
                  h(
                    `span.dot.st-${r.status === "ok" ? "running" : r.status === "failed" ? "failed" : "exited"}`,
                  ),
                  h(
                    "button.desk-btn.desk-btn-quiet.row-main",
                    {
                      type: "button",
                      "aria-expanded": open ? "true" : "false",
                      onClick: () => {
                        if (open) opened.delete(r.id);
                        else opened.add(r.id);
                        drawHistory();
                      },
                    },
                    h(
                      "b",
                      null,
                      r.tag,
                      " ",
                      r.status === "failed"
                        ? pill("Failed", "bad")
                        : r.status === "cancelled"
                          ? pill("Cancelled")
                          : pill("Built", "ok"),
                    ),
                    h(
                      "small",
                      null,
                      `${r.summary} · ${duration(r.ended - r.started)} · ${ago(r.ended)}`,
                    ),
                  ),
                  r.status === "ok" && r.image
                    ? button({
                        label: `Run ${r.image}`,
                        icon: "play",
                        hideLabel: true,
                        onClick: () => app.dialogs.run(r.image),
                      })
                    : null,
                  button({
                    label: `Build ${r.tag} again`,
                    icon: "restart",
                    hideLabel: true,
                    onClick: () =>
                      void app.builds
                        .start(r.form)
                        .catch((e) => app.toast(String(e?.message ?? e), "danger")),
                  }),
                  button({
                    label: "Forget this build",
                    icon: "x",
                    hideLabel: true,
                    onClick: () => app.builds.forget(r.id),
                  }),
                ),
                open
                  ? h(
                      "div.build-detail",
                      null,
                      r.error ? h("p.build-error", null, icon("alert", 14), r.error) : null,
                      h(
                        "ol.build-steps",
                        null,
                        (model?.steps ?? r.steps).map((s) => stepRow(s, s.status === "error")),
                      ),
                      r.error
                        ? button({
                            label: "Explain the failure",
                            icon: "sparkle",
                            kind: "desk-btn-quiet ai",
                            onClick: () => app.ai.explainBuild(r, model),
                          })
                        : null,
                    )
                  : null,
              );
            }),
          )
        : h(
            "div.table-empty",
            null,
            icon("build", 28),
            h("b", null, "No builds yet."),
            button({
              label: "Build an image",
              icon: "build",
              kind: "desk-btn-primary",
              onClick: () => app.dialogs.build(),
            }),
          ),
    );
  };

  const off = app.builds.on(() => {
    drawLive();
    drawHistory();
  });
  const timer = setInterval(drawLive, 1000);
  drawLive();
  drawHistory();
  drawCache();

  return {
    element,
    title: "Builds",
    get subtitle() {
      const n = app.builds.active().length;
      return n ? `${n} building now` : "Images built from a Dockerfile";
    },
    tools: () => [
      button({ label: "Write a Dockerfile", icon: "wand", onClick: () => app.dialogs.scaffold() }),
      button({
        label: "Build an image",
        icon: "build",
        kind: "desk-btn-primary",
        onClick: () => app.dialogs.build(),
      }),
    ],
    /** @param {any} _s @param {Set<string>} changed */
    update(_s, changed) {
      if (changed.has("disk")) drawCache();
    },
    dispose() {
      off();
      clearInterval(timer);
    },
  };
}
