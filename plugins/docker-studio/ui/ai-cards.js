// How AI's answers look: a few lines of markdown (paragraphs, lists, `code`, **bold**, code blocks)
// drawn as text nodes, never HTML; a diagnosis with its cause, evidence and fixes; issues found in
// logs; ways to slim an image; and docker commands to run, each asked first.

import { runSuggested } from "./ai-commands.js";
import { button, h, icon, pill } from "./dom.js";

/** @typedef {import("./studio.js").App} App */

/** Inline `code` and **bold** in a line of text. */
function inline(/** @type {string} */ text) {
  /** @type {Array<string | HTMLElement>} */
  const out = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? h("code", null, m[1]) : h("b", null, m[2] ?? ""));
    at = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(at));
  return out;
}

/** Markdown-lite as elements. */
export function prose(/** @type {string} */ text) {
  const root = h("div.prose");
  const blocks = text.replace(/\r/g, "").split(/```/);
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {
      root.append(h("pre.code-block", null, block.replace(/^[a-z]*\n/, "").trimEnd()));
      return;
    }
    /** @type {HTMLElement | null} */
    let list = null;
    for (const para of block.split(/\n{2,}/)) {
      for (const line of para.split("\n")) {
        const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
        if (item) {
          if (!list) {
            list = h("ul");
            root.append(list);
          }
          list.append(h("li", null, inline(item[1] ?? "")));
        } else if (line.trim()) {
          list = null;
          const heading = /^#{1,4}\s+(.*)$/.exec(line);
          root.append(
            heading ? h("h4", null, inline(heading[1] ?? "")) : h("p", null, inline(line)),
          );
        }
      }
      list = null;
    }
  });
  return root;
}

/** A docker command AI suggests, with Run (asked first) and its output under it. */
export function commandChip(
  /** @type {App} */ app,
  /** @type {{ title: string, args: string[] }} */ cmd,
) {
  const out = h("pre.cmd-out", { hidden: true });
  const line = `docker ${(cmd.args[0] === "docker" ? cmd.args.slice(1) : cmd.args).join(" ")}`;
  return h(
    "div.ai-command",
    null,
    h(
      "div.ai-command-head",
      null,
      icon("terminal", 14),
      h("span", null, cmd.title),
      h("span.grow"),
      button({
        label: "Copy",
        icon: "copy",
        hideLabel: true,
        onClick: () => void app.act.copy(line, "the command"),
      }),
      button({
        label: "Run",
        icon: "play",
        kind: "desk-btn-quiet",
        onClick: async () => {
          const said = await runSuggested(app, cmd.args, cmd.title);
          if (said !== null) {
            out.hidden = false;
            out.textContent = said;
          }
        },
      }),
    ),
    h("code.cmd-line", null, line),
    out,
  );
}

const fixes = (/** @type {App} */ app, /** @type {any[]} */ list) =>
  h(
    "ol.ai-fixes",
    null,
    (list ?? []).map((f) =>
      h(
        "li",
        null,
        h("b", null, f.title),
        prose(String(f.detail ?? "")),
        f.command?.args?.length ? commandChip(app, f.command) : null,
      ),
    ),
  );

/** A container's diagnosis. */
export function diagnosisCard(/** @type {App} */ app, /** @type {any} */ a) {
  return h(
    "div.ai-card",
    null,
    h(
      "h3.ai-headline",
      null,
      String(a.headline ?? ""),
      a.confidence
        ? pill(
            `${a.confidence} confidence`,
            a.confidence === "high" ? "ok" : a.confidence === "low" ? "warn" : "",
          )
        : null,
    ),
    prose(String(a.cause ?? "")),
    a.evidence?.length
      ? h(
          "div.ai-evidence",
          null,
          h("span.field-label", null, "Evidence"),
          ...a.evidence.map((/** @type {string} */ e) => h("code.evidence-line", null, e)),
        )
      : null,
    a.fixes?.length ? [h("span.field-label", null, "How to fix it"), fixes(app, a.fixes)] : null,
  );
}

/** Issues found in logs. */
export function logsCard(/** @type {App} */ _app, /** @type {any} */ a) {
  return h(
    "div.ai-card",
    null,
    prose(String(a.summary ?? "")),
    h(
      "ul.ai-issues",
      null,
      (a.issues ?? []).map((/** @type {any} */ i) =>
        h(
          `li.issue.sev-${i.severity}`,
          null,
          h(
            "div.issue-head",
            null,
            pill(
              i.severity,
              i.severity === "error" ? "bad" : i.severity === "warning" ? "warn" : "",
            ),
            h("b", null, i.title),
          ),
          ...(i.lines ?? []).map((/** @type {string} */ l) => h("code.evidence-line", null, l)),
          prose(String(i.suggestion ?? "")),
        ),
      ),
    ),
  );
}

/** Ways to make an image smaller, or to fix a failed build. */
export function fixesCard(/** @type {App} */ app, /** @type {any} */ a) {
  return h(
    "div.ai-card",
    null,
    a.headline ? h("h3.ai-headline", null, String(a.headline)) : null,
    prose(String(a.summary ?? a.cause ?? "")),
    a.savings ? h("p.ai-savings", null, icon("disk", 14), `Saves ${a.savings}`) : null,
    fixes(app, a.suggestions ?? a.fixes ?? []),
  );
}

/** An answer to a question, with commands to run. */
export function answerCard(/** @type {App} */ app, /** @type {any} */ a) {
  return h(
    "div.ai-card",
    null,
    prose(String(a.answer ?? "")),
    ...(a.commands ?? []).map((/** @type {any} */ c) => commandChip(app, c)),
  );
}

/** Docker files AI tailored, each to copy. */
export function filesCard(
  /** @type {App} */ _app,
  /** @type {any} */ a,
  /** @type {(files: Array<[string, string]>) => void} */ use,
) {
  const files = (a.files ?? []).map(
    (/** @type {any} */ f) => /** @type {[string, string]} */ ([String(f.name), String(f.content)]),
  );
  return h(
    "div.ai-card",
    null,
    prose(String(a.notes ?? "")),
    ...files.map(([name, content]) =>
      h(
        "details.ai-file",
        { open: name === "Dockerfile" },
        h("summary", null, icon("file", 13), name),
        h("pre.code-block", null, content),
      ),
    ),
    files.length
      ? button({
          label: "Use these files",
          icon: "check",
          kind: "desk-btn-primary",
          onClick: () => use(files),
        })
      : null,
  );
}
