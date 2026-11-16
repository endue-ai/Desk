// The band over the graph while a merge, rebase, cherry-pick or revert is stopped half way: what is
// in progress, how many files still conflict (each opens the conflict tool), and Continue, Skip and
// Abort. Continue waits until nothing conflicts.

import { fill, h, icon } from "./dom.js";
import { shortSha } from "./format.js";

/**
 * @param {import("./app.js").App} app @param {HTMLElement} host
 * @param {{ onProceed(how: "continue" | "skip" | "abort"): void, onResolve(path: string): void }} hooks
 */
export function createBanner(app, host, hooks) {
  function draw() {
    const s = app.get().snapshot;
    const op = s?.operation ?? null;
    host.hidden = !op;
    if (!s || !op) return;
    const conflicts = s.status.conflicts;
    const words = {
      merge: "Merging",
      rebase: "Rebasing",
      "cherry-pick": "Cherry-picking",
      revert: "Reverting",
    };
    fill(
      host,
      icon(conflicts.length ? "alert" : "merge", 18),
      h(
        "div.banner-text",
        null,
        h("b", null, `${words[op]}${s.operationHead ? ` ${shortSha(s.operationHead)}` : ""}`),
        conflicts.length
          ? h(
              "span",
              null,
              ` — ${conflicts.length} file${conflicts.length === 1 ? "" : "s"} in conflict: `,
              ...conflicts
                .slice(0, 4)
                .map((c, i) =>
                  h(
                    "span",
                    null,
                    i ? ", " : "",
                    h(
                      "button.desk-btn.desk-btn-quiet.banner-file",
                      { type: "button", onClick: () => hooks.onResolve(c.path) },
                      c.path,
                    ),
                  ),
                ),
              conflicts.length > 4 ? ` and ${conflicts.length - 4} more` : "",
            )
          : h("span", null, " — every conflict is resolved. Continue when ready."),
      ),
      op === "rebase" || op === "cherry-pick"
        ? h(
            "button.desk-btn.desk-btn-quiet",
            { type: "button", onClick: () => hooks.onProceed("skip") },
            "Skip",
          )
        : null,
      h(
        "button.desk-btn.desk-btn-quiet",
        { type: "button", onClick: () => hooks.onProceed("abort") },
        "Abort",
      ),
      h(
        "button.desk-btn.desk-btn-primary",
        {
          type: "button",
          disabled: conflicts.length > 0,
          title: conflicts.length ? "Resolve every conflict first" : undefined,
          onClick: () => hooks.onProceed("continue"),
        },
        icon("check", 14),
        "Continue",
      ),
    );
  }
  app.subscribe((state, previous) => {
    if (state.snapshot !== previous.snapshot) draw();
  });
  draw();
}
