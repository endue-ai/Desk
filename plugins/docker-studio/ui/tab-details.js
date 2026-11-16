// The Details tab: what a container is made of, in cards: how it runs (image, command, user,
// folder, restart policy), its ports, environment (secret-looking values masked until shown), mounts,
// networks and labels. The Processes tab (`docker top`) is here too.

import { button, h, icon } from "./dom.js";
import { ago, short } from "./format.js";
import { portUrl } from "./model.js";
import { objectRef } from "./refs.js";

/** @typedef {import("./studio.js").App} App @typedef {import("./parse.js").Container} Container */

const SECRET = /pass|secret|token|key|credential|auth|private|cert|dsn|database_url|_url$/i;

/** A list of label and value rows. @param {Array<[string, import("./dom.js").Child | import("./dom.js").Child[]]>} rows */
export function facts(rows) {
  return h(
    "dl.facts",
    null,
    rows
      .filter(([, v]) => v !== "" && v !== null && v !== undefined)
      .flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]),
  );
}

/** @param {App} app @param {Container} c */
export function createDetailsView(app, c) {
  let reveal = false;
  const envCard = h("article.card");
  const drawEnv = () => {
    const rows = c.env.map((e) => {
      const eq = e.indexOf("=");
      return [eq < 0 ? e : e.slice(0, eq), eq < 0 ? "" : e.slice(eq + 1)];
    });
    envCard.replaceChildren(
      h(
        "header.card-head",
        null,
        h("h2", null, "Environment"),
        h("span.card-sub", null, String(rows.length)),
        button({
          label: reveal ? "Hide secrets" : "Show secrets",
          icon: reveal ? "lock" : "eye",
          kind: "desk-btn-quiet link",
          onClick: () => {
            reveal = !reveal;
            drawEnv();
          },
        }),
      ),
      h(
        "div.kv-list",
        null,
        rows.map(([k = "", v = ""]) => {
          const hidden = !reveal && SECRET.test(k);
          return h(
            "div.kv",
            null,
            h("span.kv-key.mono", null, k),
            h(`span.kv-value.mono${hidden ? ".masked" : ""}`, null, hidden ? "••••••••" : v),
            button({
              label: `Copy ${k}`,
              icon: "copy",
              hideLabel: true,
              onClick: () => void app.act.copy(v, k),
            }),
          );
        }),
      ),
    );
  };
  drawEnv();

  const run = h(
    "article.card",
    null,
    h("header.card-head", null, h("h2", null, "How it runs")),
    facts([
      [
        "Image",
        h(
          "button.desk-btn.desk-btn-quiet.cell-link",
          { type: "button", onClick: () => app.open({ kind: "image", id: c.imageId }) },
          c.image,
        ),
      ],
      ["Image id", h("span.mono", null, short(c.imageId))],
      [
        "Container id",
        h(
          "span.mono.copyable",
          null,
          c.id.slice(0, 24),
          "…",
          button({
            label: "Copy the id",
            icon: "copy",
            hideLabel: true,
            onClick: () => void app.act.copy(c.id, "the id"),
          }),
        ),
      ],
      ["Command", h("code", null, c.command || "–")],
      ["Entrypoint", c.entrypoint.length ? h("code", null, c.entrypoint.join(" ")) : ""],
      ["Folder", c.workdir],
      ["User", c.user || "root (the image's)"],
      ["Restart", c.restartPolicy || "no"],
      ["Restarts", c.restarts ? String(c.restarts) : ""],
      ["Created", ago(c.created)],
      ["Started", c.startedAt ? ago(c.startedAt) : "never"],
      ["Platform", c.platform],
      [
        "Stack",
        c.project
          ? h(
              "button.desk-btn.desk-btn-quiet.cell-link",
              { type: "button", onClick: () => app.open({ kind: "project", id: c.project }) },
              `${c.project} · ${c.service}`,
            )
          : "",
      ],
    ]),
  );

  const ports = h(
    "article.card",
    null,
    h("header.card-head", null, h("h2", null, "Ports")),
    c.ports.length || c.exposed.length
      ? h(
          "div.kv-list",
          null,
          c.ports.map((p) =>
            h(
              "div.kv",
              null,
              h("span.kv-key.mono", null, `${p.container}/${p.proto}`),
              h("span.kv-value.mono", null, `${p.ip || "0.0.0.0"}:${p.host}`),
              button({
                label: `Open ${portUrl(p)}`,
                icon: "external",
                hideLabel: true,
                onClick: () => void app.act.browse(portUrl(p)),
              }),
            ),
          ),
          c.exposed
            .filter((e) => !c.ports.some((p) => `${p.container}/${p.proto}` === e))
            .map((e) =>
              h(
                "div.kv",
                null,
                h("span.kv-key.mono", null, e),
                h("span.kv-value.muted", null, "not published"),
              ),
            ),
        )
      : h("p.card-empty", null, icon("info"), "No ports."),
  );

  const mounts = h(
    "article.card",
    null,
    h(
      "header.card-head",
      null,
      h("h2", null, "Mounts"),
      h("span.card-sub", null, String(c.mounts.length)),
    ),
    c.mounts.length
      ? h(
          "div.kv-list",
          null,
          c.mounts.map((m) =>
            h(
              "div.kv.mount",
              null,
              h("span.kv-key.mono", null, m.destination),
              h(
                "span.kv-value",
                null,
                h("span.pill", null, m.type),
                " ",
                m.type === "volume"
                  ? h(
                      "button.desk-btn.desk-btn-quiet.cell-link.inline",
                      { type: "button", onClick: () => app.open({ kind: "volume", id: m.name }) },
                      m.name,
                    )
                  : h("span.mono", null, m.source),
                m.rw ? "" : h("span.pill.warn", null, "read-only"),
              ),
            ),
          ),
        )
      : h(
          "p.card-empty",
          null,
          icon("info"),
          "Nothing mounted: what it writes lives in the container.",
        ),
  );

  const networks = h(
    "article.card",
    null,
    h("header.card-head", null, h("h2", null, "Networks")),
    c.networks.length
      ? h(
          "div.kv-list",
          null,
          c.networks.map((n) =>
            h(
              "div.kv",
              null,
              h("span.kv-key", null, n.name),
              h(
                "span.kv-value.mono",
                null,
                [n.ip, n.aliases.length ? `aliases ${n.aliases.join(", ")}` : ""]
                  .filter(Boolean)
                  .join(" · ") || "–",
              ),
            ),
          ),
        )
      : h(
          "p.card-empty",
          null,
          icon("info"),
          c.state === "running" ? "No network." : "Not running: no address.",
        ),
  );

  const labels = Object.entries(c.labels);
  const labelCard = h(
    "article.card",
    null,
    h(
      "header.card-head",
      null,
      h("h2", null, "Labels"),
      h("span.card-sub", null, String(labels.length)),
    ),
    labels.length
      ? h(
          "div.kv-list",
          null,
          labels.map(([k, v]) =>
            h("div.kv", null, h("span.kv-key.mono", null, k), h("span.kv-value.mono", null, v)),
          ),
        )
      : h("p.card-empty", null, icon("info"), "No labels."),
  );

  const element = h(
    "section.details-view",
    null,
    h("div.details-col", null, run, ports, networks),
    h("div.details-col", null, envCard, mounts, labelCard),
  );
  return { element, dispose() {} };
}

/** @param {App} app @param {Container} c */
export function createTopView(app, c) {
  const body = h("div.top-host");
  const element = h("section.top-view", null, body);
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  const read = async () => {
    if (c.state !== "running") {
      body.replaceChildren(
        h("div.preview-empty", null, icon("pulse", 28), h("p", null, "Not running: no processes.")),
      );
      return;
    }
    try {
      const { stdout } = await app.docker(["top", "--", objectRef(c.id)], { timeoutMs: 10_000 });
      const [head = "", ...rows] = stdout.split("\n").filter((l) => l.trim());
      const cols = head.trim().split(/\s+/);
      body.replaceChildren(
        h(
          "table.dtable.top-table",
          null,
          h(
            "thead",
            null,
            h(
              "tr",
              null,
              cols.map((col) => h("th", null, col)),
            ),
          ),
          h(
            "tbody",
            null,
            rows.map((row) => {
              const parts = row.trim().split(/\s+/);
              const cells = [
                ...parts.slice(0, cols.length - 1),
                parts.slice(cols.length - 1).join(" "),
              ];
              return h(
                "tr",
                null,
                cells.map((cell, i) => h(`td${i === cells.length - 1 ? ".mono" : ""}`, null, cell)),
              );
            }),
          ),
        ),
      );
    } catch (error) {
      body.replaceChildren(
        h("p.error-text.pad", null, String(/** @type {any} */ (error)?.message ?? error)),
      );
    }
  };
  void read();
  timer = setInterval(() => void read(), 5000);
  return { element, dispose: () => clearInterval(timer) };
}
