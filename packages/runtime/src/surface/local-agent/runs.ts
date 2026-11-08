/**
 * The work handed to a local agent, on its screen: every run, the person's and Eris's, going on
 * first, with what it was asked, how it stands, the start of its answer and Stop. A run that worked
 * in a session opens that session on a click.
 */
import type { LocalAgentRun } from "@endue-ai/bridge";
import type { ShellCtx } from "../../shell/context";
import type { Child } from "../../shell/dom";
import { h } from "../../shell/dom";
import { localText } from "./copy";
import { ago, runsOf, why } from "./model";

/** The runs shown at once; the rest stay in agents.runs. */
const SHOWN = 4;
/** How much of an answer the strip shows. */
const EXCERPT = 280;

const STATE = {
  running: "running",
  done: "done",
  failed: "failed",
  stopped: "stopped",
} as const;

export function runsStrip(
  ctx: ShellCtx,
  agent: string,
  open: (sessionId: string) => void,
  notice: (line: string) => void,
): Child[] {
  const s = ctx.store.get();
  const runs = runsOf(s.localRuns, agent).slice(0, SHOWN);
  if (!runs.length) return [];
  const lang = s.lang;
  const stop = (run: LocalAgentRun) => {
    const local = ctx.bridge.localAgents;
    if (!local) return;
    void local.stop(run.runId).catch((error: unknown) => notice(why(error)));
  };
  const row = (run: LocalAgentRun) => {
    const excerpt =
      run.text.length > EXCERPT ? `${run.text.slice(0, EXCERPT).trimEnd()}…` : run.text;
    const fromEris = s.erisRuns.includes(run.runId);
    return h(
      "li",
      { class: "local-run", "data-run": run.runId, "data-state": run.state },
      h(
        "div",
        { class: "local-run-head" },
        run.state === "running" ? h("span", { class: "dot dot-active" }) : null,
        h("span", { class: "tag" }, localText(lang, STATE[run.state])),
        fromEris ? h("span", { class: "tag local-eris" }, localText(lang, "fromEris")) : null,
        h("span", { class: "local-run-prompt" }, run.prompt),
        h(
          "span",
          { class: "local-run-meta pop-muted" },
          [
            run.tools ? localText(lang, "tools", { n: run.tools }) : "",
            ago(lang, run.startedAt, ctx.wall()),
          ]
            .filter(Boolean)
            .join(" · "),
        ),
        run.state === "running"
          ? h(
              "button",
              {
                class: "btn btn-xs btn-outline",
                type: "button",
                "data-key": `local-stop-${run.runId}`,
                onClick: () => stop(run),
              },
              localText(lang, "stop"),
            )
          : run.sessionId
            ? h(
                "button",
                {
                  class: "btn btn-xs",
                  type: "button",
                  "data-key": `local-open-${run.runId}`,
                  onClick: () => run.sessionId && open(run.sessionId),
                },
                localText(lang, "continuing", { title: run.sessionId.slice(0, 8) }),
              )
            : null,
      ),
      excerpt || run.error
        ? h("p", { class: "local-run-text" }, run.error && !excerpt ? run.error : excerpt)
        : null,
    );
  };
  return [
    h("div", { class: "section-title" }, localText(lang, "runs")),
    h("ul", { class: "local-runs-list", "aria-live": "polite" }, runs.map(row)),
  ];
}
