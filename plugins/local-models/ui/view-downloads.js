// The downloads under Discover: each with its progress, speed and time left, paused, resumed,
// cancelled or cleared; a finished file loads from here.
import { fill, h, icon, iconButton } from "./dom.js";
import { formatBytes } from "./models.js";

/** @typedef {import("./app.js").App} App */

/** "3 min left". @param {number} seconds */
export function timeLeft(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.ceil(seconds)} s left`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min left`;
  return `${(seconds / 3600).toFixed(1)} h left`;
}

/** @param {App} app */
export function downloadsView(app) {
  const { S } = app;
  const el = h("section.lm-downloads", { "aria-label": "Downloads" });

  function draw() {
    const list = S.get().downloads;
    el.hidden = !list.length;
    if (!list.length) return;
    const running = list.filter((d) => d.state === "running").length;
    fill(
      el,
      h(
        "header.lm-downloads-head",
        null,
        icon("download"),
        h("strong", null, "Downloads"),
        running ? h("span.lm-muted", null, `${running} running`) : null,
      ),
      h(
        "div.lm-downloads-list",
        null,
        list.map((d) => {
          const share = d.total ? Math.min(1, d.received / d.total) : 0;
          const left = d.speed && d.total ? timeLeft((d.total - d.received) / d.speed) : "";
          const words =
            d.state === "done"
              ? "Done"
              : d.state === "failed"
                ? (d.error ?? "Failed")
                : d.state === "paused"
                  ? "Paused"
                  : d.state === "queued"
                    ? "Waiting"
                    : [
                        d.status,
                        `${formatBytes(d.received)} of ${formatBytes(d.total)}`,
                        d.speed ? `${formatBytes(d.speed)}/s` : "",
                        left,
                      ]
                        .filter(Boolean)
                        .join(" · ");
          const local =
            d.kind === "file" && d.state === "done"
              ? S.get().local.find((m) => m.path === d.path)
              : undefined;
          return h(
            "div.lm-download",
            { dataset: { state: d.state } },
            h("div.lm-download-icon", null, icon(d.kind === "ollama" ? "server" : "cube")),
            h(
              "div.lm-download-main",
              null,
              h(
                "div.lm-download-name",
                null,
                h("strong", null, d.repo ? d.repo.split("/")[1] : d.name),
                d.repo
                  ? h("span.desk-badge", null, d.quant ?? d.name)
                  : h("span.lm-muted", null, "into Ollama"),
              ),
              h(
                "div.desk-progress.lm-download-bar",
                null,
                h("span", { style: { width: `${Math.round(share * 100)}%` } }),
              ),
              h("div.lm-download-words", null, words),
            ),
            h(
              "div.lm-download-actions",
              null,
              local
                ? h(
                    "button.desk-btn",
                    { type: "button", onClick: () => void app.local.load(local) },
                    icon("play"),
                    "Load",
                  )
                : null,
              d.state === "running"
                ? iconButton("stop", "Pause", () => app.local.downloads.pause(d.id))
                : null,
              d.state === "paused" || d.state === "failed"
                ? iconButton("play", "Resume", () => app.local.downloads.resume(d.id))
                : null,
              d.state === "done"
                ? iconButton("x", "Clear", () => app.local.downloads.clear(d.id))
                : iconButton(
                    "trash",
                    "Cancel and remove what came",
                    () => void app.local.downloads.cancel(d.id),
                  ),
            ),
          );
        }),
      ),
    );
  }

  S.on(["downloads", "local"], draw);
  draw();
  return { el };
}
