// Blame in the centre: each line of a file with the commit that last changed it. A run of lines
// from one commit shares one label (author, summary, age); a bar beside it is brighter the newer the
// change; a click on a label shows that commit in the graph.

import { spans, syntax } from "./diff-text.js";
import { button, fill, h, icon } from "./dom.js";
import {
  authorColor,
  chartColor,
  fullDate,
  initials,
  relativeTime,
  shortSha,
  splitPath,
} from "./format.js";
import { blame } from "./history.js";

const LIMIT = 6000;
const NOT_COMMITTED = /^0+$/;

/**
 * @typedef {{ onBack(): void, onReveal(sha: string): void, onHistory(path: string): void }} Hooks
 */

/** @param {import("./app.js").App} app @param {HTMLElement} host @param {Hooks} hooks */
export function createBlameView(app, host, hooks) {
  const head = h("div.diff-head");
  const body = h("div.blame-body", { tabindex: 0 });
  host.replaceChildren(h("div.diff", null, head, body));

  async function open(/** @type {string} */ path, /** @type {string | null} */ rev = null) {
    const repo = app.get().repo;
    if (!repo) return;
    const { dir, base } = splitPath(path);
    fill(
      head,
      button({
        label: "Back to the graph",
        icon: "arrowLeft",
        kind: "desk-btn-quiet",
        hideLabel: true,
        onClick: () => hooks.onBack(),
      }),
      h("span.hist-icon", null, icon("user", 16)),
      h("span.diff-path", null, h("span.file-dir", null, dir), h("b", null, base)),
      h("span.diff-badge.is-commit", null, rev ? `at ${shortSha(rev)}` : "working copy"),
      h("span.desk-bar-spacer"),
      button({
        label: "History",
        icon: "history",
        kind: "desk-btn-quiet",
        onClick: () => hooks.onHistory(path),
      }),
    );
    fill(body, h("p.diff-empty", null, "Reading who changed what…"));
    try {
      const { lines, commits } = await blame(app.git, repo, path, rev);
      const times = [...commits.values()].map((c) => c.time).filter(Boolean);
      const oldest = Math.min(...times);
      const newest = Math.max(...times);
      const age = (/** @type {number} */ t) =>
        newest === oldest ? 1 : (t - oldest) / (newest - oldest);
      const rows = [];
      let previous = "";
      for (const line of lines.slice(0, LIMIT)) {
        const commit = commits.get(line.sha);
        const first = line.sha !== previous;
        previous = line.sha;
        const pending = NOT_COMMITTED.test(line.sha);
        const heat = pending ? 100 : Math.round(15 + age(commit?.time ?? oldest) * 85);
        rows.push(
          h(
            "div.bl",
            {
              class: first ? "is-first" : "",
              style: {
                "--heat": `${heat}%`,
                "--who": chartColor(authorColor(commit?.email || commit?.author || "")),
              },
            },
            h(
              "span.bl-who",
              first
                ? {
                    title: pending
                      ? "Not committed yet"
                      : `${commit?.summary}\n${commit?.author} · ${fullDate(commit?.time ?? 0)} · ${shortSha(line.sha)}`,
                    onClick: () => !pending && hooks.onReveal(line.sha),
                  }
                : null,
              first
                ? pending
                  ? h("span.bl-pending", null, icon("edit", 12), "Not committed yet")
                  : [
                      h(
                        "span.avatar.tiny",
                        {
                          style: {
                            "--avatar": chartColor(
                              authorColor(commit?.email || commit?.author || ""),
                            ),
                          },
                        },
                        initials(commit?.author ?? "?"),
                      ),
                      h("span.bl-summary", null, commit?.summary ?? ""),
                      h("span.bl-when", null, relativeTime(commit?.time ?? 0)),
                    ]
                : null,
            ),
            h("span.bl-heat"),
            h("span.ln", null, line.line),
            h("span.code", null, spans(document, line.text, syntax(line.text, path), [])),
          ),
        );
      }
      if (lines.length > LIMIT)
        rows.push(h("p.diff-empty", null, `${lines.length - LIMIT} more lines are not shown.`));
      fill(body, ...rows);
    } catch (error) {
      fill(body, h("p.diff-empty", null, error instanceof Error ? error.message : String(error)));
    }
  }

  return { open };
}
