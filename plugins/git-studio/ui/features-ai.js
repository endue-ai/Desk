// The AI features on the studio's hooks: the commit message from the staged changes, a commit
// explained in the right panel, a conflict resolved from both sides, and a branch described as a
// pull request. Each says plainly when the brain can't be asked or doesn't answer.

import {
  BRANCH_TOOL,
  branchPrompt,
  COMMIT_TOOL,
  commitPrompt,
  createAsker,
  EXPLAIN_TOOL,
  explainPrompt,
  RESOLVE_TOOL,
  resolvePrompt,
  text,
} from "./ai.js";
import { h, icon } from "./dom.js";
import { ask } from "./overlay.js";

/**
 * @typedef {{ state: "asking" } | { state: "done", summary: string, points: string[], risk: string, riskReason: string }
 *   | { state: "failed", message: string }} Explanation
 */

/**
 * @param {ReturnType<typeof import("./studio.js").createStudio>} studio
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call" | "onEvent">} bridge
 * @param {{ labels(): { ours: string, theirs: string } }} conflictLabels
 */
export function installAi(studio, bridge, conflictLabels) {
  const { app, extra, layer } = studio;
  const asker = createAsker(bridge);
  const git = (/** @type {string[]} */ args) =>
    app.git.run(args, { cwd: /** @type {string} */ (app.get().repo) }).then((o) => o.stdout);
  const fail = (/** @type {unknown} */ error) => {
    app.say(error instanceof Error ? error.message : String(error), "danger");
    return null;
  };
  /** @type {Map<string, Explanation>} */
  const explained = new Map();

  extra.writeMessage = async () => {
    const s = app.get().snapshot;
    if (!s?.status.staged.length) {
      app.say("Stage some changes first: the message is written from them.");
      return null;
    }
    app.say("Writing the message…");
    try {
      const [diff, stat, recent] = await Promise.all([
        git(["diff", "--cached", "--no-color", "--no-ext-diff", "-U2"]),
        git(["diff", "--cached", "--stat=100"]),
        git(["log", "-12", "--format=%s"]).catch(() => ""),
      ]);
      const answer = await asker.ask(
        commitPrompt({
          diff,
          stat,
          branch: s.status.branch,
          recent: recent.split("\n").filter(Boolean),
        }),
        COMMIT_TOOL,
      );
      const summary = text(answer?.summary);
      if (!summary) throw new Error("The brain answered without a message.");
      app.say("Message written: read it before committing.", "success");
      const body = text(answer?.body);
      return body ? `${summary}\n\n${body}` : summary;
    } catch (error) {
      return fail(error);
    }
  };

  extra.explain = (sha) => {
    if (!sha) return;
    if (app.get().selected !== sha) void app.select(sha);
    if (explained.get(sha)?.state === "done") return;
    explained.set(sha, { state: "asking" });
    studio.detail.draw();
    void (async () => {
      try {
        const [message, show] = await Promise.all([
          git(["show", "-s", "--format=%B", sha]),
          git(["show", "--no-color", "--stat=100", "--patch", "-U2", "--format=", sha]),
        ]);
        const author = app.get().snapshot?.commits.find((c) => c.sha === sha)?.author ?? "";
        const answer = await asker.ask(explainPrompt({ message, author, show }), EXPLAIN_TOOL);
        if (!answer) throw new Error("The brain answered without an explanation.");
        const points = Array.isArray(answer.points) ? answer.points.map(text).filter(Boolean) : [];
        explained.set(sha, {
          state: "done",
          summary: text(answer.summary),
          points,
          risk: text(answer.risk) || "low",
          riskReason: text(answer.riskReason),
        });
      } catch (error) {
        explained.set(sha, {
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      studio.detail.draw();
    })();
  };

  /** The card the commit panel shows for `sha` while it is explained, or after. */
  extra.aiCard = (/** @type {string} */ sha) => {
    const e = explained.get(sha);
    if (!e) return null;
    const head = h(
      "div.ai-head",
      null,
      icon("sparkle", 14),
      h("span", null, "Explained by AI"),
      h("span.desk-bar-spacer"),
      e.state === "done"
        ? h("span.ai-risk", { class: `is-${e.risk}`, title: e.riskReason }, `${e.risk} risk`)
        : null,
      h(
        "button.desk-icon-btn.mini-icon",
        {
          type: "button",
          title: "Close",
          "aria-label": "Close the explanation",
          onClick: () => {
            explained.delete(sha);
            studio.detail.draw();
          },
        },
        icon("x", 12),
      ),
    );
    if (e.state === "asking")
      return h("div.ai-card.is-asking", null, head, h("div.ai-shimmer"), h("div.ai-shimmer.short"));
    if (e.state === "failed")
      return h("div.ai-card.is-failed", null, head, h("p", null, e.message));
    return h(
      "div.ai-card",
      null,
      head,
      h("p.ai-summary", null, e.summary),
      e.points.length ? h("ul.ai-points", null, ...e.points.map((p) => h("li", null, p))) : null,
      e.riskReason ? h("p.ai-reason", null, e.riskReason) : null,
    );
  };

  /** A suggestion for one conflict, from both sides and the lines around it. */
  extra.resolveWithAi = async (
    /** @type {import("./conflict.js").ConflictFile} */ file,
    /** @type {import("./conflict.js").ConflictChunk} */ chunk,
  ) => {
    const at = file.chunks.indexOf(chunk);
    const near = (/** @type {number} */ i, /** @type {boolean} */ end) => {
      const c = file.chunks[i];
      if (c?.kind !== "same") return [];
      return end ? c.lines.slice(-12) : c.lines.slice(0, 12);
    };
    app.say(`Asking how to resolve conflict ${chunk.index + 1}…`);
    try {
      const answer = await asker.ask(
        resolvePrompt({
          path: file.path,
          before: near(at - 1, true),
          after: near(at + 1, false),
          ours: chunk.ours,
          base: chunk.base,
          theirs: chunk.theirs,
          labels: conflictLabels.labels(),
        }),
        RESOLVE_TOOL,
      );
      if (!answer || !Array.isArray(answer.lines))
        throw new Error("The brain answered without lines.");
      app.say(text(answer.reasoning) || "Suggested: check it before marking resolved.", "success");
      return answer.lines.map((l) => (typeof l === "string" ? l : String(l)));
    } catch (error) {
      return fail(error);
    }
  };

  /** The current branch as a pull request against the main line, in a dialog to copy from. */
  extra.describeBranch = async () => {
    const s = app.get().snapshot;
    const branch = s?.status.branch;
    if (!s || !branch) return app.say("Switch to a branch to describe it.");
    const names = new Set(s.refs.map((r) => r.name));
    const base = [
      "origin/main",
      "main",
      "origin/master",
      "master",
      "origin/develop",
      "develop",
    ].find((n) => names.has(n) && n !== branch && n !== s.status.upstream);
    if (!base) return app.say("Found no main branch to compare with.");
    app.say(`Describing ${branch} against ${base}…`);
    try {
      const range = `${base}...HEAD`;
      const [log, stat, diff] = await Promise.all([
        git(["log", "--no-merges", "--format=- %s (%an)", `${base}..HEAD`]),
        git(["diff", "--stat=100", range]),
        git(["diff", "--no-color", "-U2", range]),
      ]);
      if (!log.trim()) return app.say(`${branch} has no commits that ${base} lacks.`);
      const answer = await asker.ask(branchPrompt({ branch, base, log, stat, diff }), BRANCH_TOOL);
      if (!answer) throw new Error("The brain answered without a description.");
      const values = await ask(layer, {
        title: `Pull request: ${branch} → ${base}`,
        icon: "sparkle",
        body: `Written from ${log.trim().split("\n").length} commits. Edit, then copy.`,
        fields: [
          { name: "title", label: "Title", value: text(answer.title) },
          { name: "body", label: "Description", kind: "textarea", value: text(answer.body) },
        ],
        confirm: "Copy",
      });
      if (values) {
        await navigator.clipboard?.writeText(`${values.title}\n\n${values.body}`).catch(() => {});
        app.say("Copied the pull request's title and description.", "success");
      }
    } catch (error) {
      fail(error);
    }
  };

  return { asker };
}
