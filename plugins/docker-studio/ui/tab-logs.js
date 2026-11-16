// The log viewer, for a container or a whole stack: lines that follow as they are written (a scroll
// up pauses, Jump to latest resumes), a search that marks what it finds, levels to show, times,
// wrapping, a colour per service, JSON lines as their message and fields, and AI that explains.

import { button, h, icon } from "./dom.js";
import { clock } from "./format.js";
import { createRing, filterLines, logArgs, sourcesOf } from "./logs.js";

/**
 * @typedef {import("./studio.js").App} App
 * @typedef {import("./logs.js").Line} Line
 * @typedef {import("./logs.js").Level} Level
 */

const LEVELS = /** @type {const} */ ([
  ["error", "Errors"],
  ["warn", "Warnings"],
  ["info", "Info"],
]);

/** @param {App} app @param {import("./logs.js").Target} target @param {{ name: string, running: boolean }} about */
export function createLogView(app, target, about) {
  const ring = createRing(app.settings.logMax ?? 5000);
  const prefs = app.prefs("logs", { times: true, wrap: false });
  let follow = true;
  let search = "";
  /** @type {Set<Level>} */
  const levels = new Set();
  /** @type {import("./run.js").StreamHandle | null} */
  let stream = null;
  /** @type {Line[]} */
  let pending = [];
  let queued = false;
  let ended = "";

  const lines = h("div.log-lines", {
    role: "log",
    "aria-label": `Logs of ${about.name}`,
    tabindex: "0",
  });
  const count = h("span.log-count");
  const jump = button({
    label: "Jump to latest",
    icon: "arrowDown",
    kind: "desk-btn-primary jump",
    onClick: () => resume(),
  });
  jump.hidden = true;
  const searchBox = /** @type {HTMLInputElement} */ (
    h("input.desk-field.log-search", {
      type: "search",
      placeholder: "Search the lines",
      "aria-label": "Search the lines",
      spellcheck: "false",
      onInput: () => {
        search = searchBox.value;
        redraw();
      },
    })
  );
  const chips = h("div.level-chips", { role: "group", "aria-label": "Levels" });
  const toggle = (
    /** @type {string} */ label,
    /** @type {import("./dom.js").IconName} */ name,
    /** @type {() => boolean} */ get,
    /** @type {() => void} */ flip,
  ) => {
    const b = button({
      label,
      icon: name,
      kind: "desk-btn-quiet toggle-btn",
      onClick: () => {
        flip();
        b.setAttribute("aria-pressed", String(get()));
      },
    });
    b.setAttribute("aria-pressed", String(get()));
    return b;
  };
  const bar = h(
    "div.log-bar",
    null,
    h("label.log-search-wrap", null, icon("search", 14), searchBox),
    chips,
    count,
    h("span.grow"),
    toggle(
      "Follow",
      "arrowDown",
      () => follow,
      () => (follow ? pause() : resume()),
    ),
    toggle(
      "Times",
      "clock",
      () => prefs.times,
      () => {
        prefs.times = !prefs.times;
        app.savePrefs("logs", prefs);
        redraw();
      },
    ),
    toggle(
      "Wrap",
      "wrap",
      () => prefs.wrap,
      () => {
        prefs.wrap = !prefs.wrap;
        app.savePrefs("logs", prefs);
        lines.classList.toggle("wrap", prefs.wrap);
      },
    ),
    button({
      label: "Copy the lines",
      icon: "copy",
      hideLabel: true,
      onClick: () =>
        void app.act.copy(
          shown()
            .map((l) => l.text)
            .join("\n"),
          "the lines",
        ),
    }),
    button({
      label: "Clear",
      icon: "x",
      hideLabel: true,
      onClick: () => {
        ring.clear();
        redraw();
      },
    }),
    button({
      label: "Explain",
      icon: "sparkle",
      kind: "desk-btn-quiet ai",
      onClick: () => app.ai.explainLogs(about.name, shown().slice(-200)),
    }),
  );
  const element = h("section.logs-view", null, bar, h("div.log-host", null, lines, jump));
  lines.classList.toggle("wrap", prefs.wrap);

  const shown = () => filterLines(ring.lines, search, levels);
  let sources = /** @type {string[]} */ ([]);

  const marked = (/** @type {string} */ text) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [text];
    /** @type {(string | HTMLElement)[]} */
    const out = [];
    let at = 0;
    const lower = text.toLowerCase();
    for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, at)) {
      out.push(text.slice(at, i), h("mark", null, text.slice(i, i + needle.length)));
      at = i + needle.length;
    }
    out.push(text.slice(at));
    return out;
  };

  const lineOf = (/** @type {Line} */ l) => {
    const src = l.source ? sources.indexOf(l.source) : -1;
    return h(
      `div.log-line${l.level ? `.lv-${l.level}` : ""}${l.stream === "stderr" ? ".err" : ""}`,
      null,
      prefs.times && l.time ? h("time.log-time", null, clock(l.time)) : null,
      src >= 0
        ? h(
            "span.log-source",
            { style: { "--series": `var(--desk-chart-${(src % 8) + 1})` } },
            l.source,
          )
        : null,
      l.level === "error" || l.level === "warn"
        ? h(`span.log-level.${l.level}`, null, l.level === "error" ? "ERR" : "WARN")
        : null,
      h(
        "span.log-text",
        null,
        l.fields.length
          ? [
              h("span.log-msg", null, marked(l.message)),
              ...l.fields
                .slice(0, 8)
                .map(([k, v]) => h("span.log-field", null, h("i", null, `${k}=`), marked(v))),
            ]
          : marked(l.text),
      ),
    );
  };

  const drawChips = () => {
    const all = ring.lines;
    chips.replaceChildren(
      ...LEVELS.map(([id, label]) => {
        const n = all.filter((l) => l.level === id).length;
        return h(
          `button.desk-btn.desk-btn-quiet.level-chip.lv-${id}`,
          {
            type: "button",
            "aria-pressed": levels.has(id) ? "true" : "false",
            onClick: () => {
              if (levels.has(id)) levels.delete(id);
              else levels.add(id);
              redraw();
            },
          },
          h("span.level-dot"),
          label,
          h("span.tab-count", null, String(n)),
        );
      }),
    );
  };

  const atBottom = () => lines.scrollHeight - lines.scrollTop - lines.clientHeight < 24;
  const toBottom = () => {
    lines.scrollTop = lines.scrollHeight;
  };

  const redraw = () => {
    sources = sourcesOf(ring.lines);
    const list = shown();
    lines.replaceChildren(...list.map(lineOf), ...(ended ? [h("p.log-ended", null, ended)] : []));
    if (list.length === 0)
      lines.append(
        h("p.log-empty", null, ring.lines.length ? "No line matches." : "No lines yet."),
      );
    count.textContent =
      search || levels.size
        ? `${list.length} of ${ring.lines.length}`
        : `${ring.lines.length} lines`;
    drawChips();
    if (follow) toBottom();
  };

  const flush = () => {
    queued = false;
    const fresh = pending;
    pending = [];
    if (fresh.length === 0) return;
    const before = sources.length;
    sources = sourcesOf(ring.lines);
    if (sources.length !== before || lines.querySelector(".log-empty")) return redraw();
    const stick = follow && atBottom();
    const keep = new Set(filterLines(fresh, search, levels));
    for (const l of fresh) if (keep.has(l)) lines.append(lineOf(l));
    while (lines.childElementCount > ring.lines.length + 1) lines.firstElementChild?.remove();
    count.textContent =
      search || levels.size
        ? `${shown().length} of ${ring.lines.length}`
        : `${ring.lines.length} lines`;
    drawChips();
    if (stick || follow) toBottom();
  };

  const pause = () => {
    follow = false;
    jump.hidden = false;
  };
  const resume = () => {
    follow = true;
    jump.hidden = true;
    toBottom();
  };
  lines.addEventListener("scroll", () => {
    if (!atBottom() && follow) pause();
    else if (atBottom() && !follow) resume();
  });

  const start = async () => {
    const prefixed = target.kind === "project";
    try {
      stream = await app.runner.stream(
        logArgs(target, { tail: app.settings.logTail, follow: about.running }),
        {
          onLine: (which, raw) => {
            pending.push(ring.push(raw, which, prefixed));
            if (!queued) {
              queued = true;
              requestAnimationFrame(flush);
            }
          },
          onExit: (outcome) => {
            ended =
              about.running && outcome.signal === null
                ? "The log ended: the container stopped."
                : "";
            stream = null;
            requestAnimationFrame(() => {
              flush();
              if (ended) lines.append(h("p.log-ended", null, ended));
            });
          },
        },
      );
    } catch (error) {
      lines.replaceChildren(
        h("p.log-empty", null, String(/** @type {any} */ (error)?.message ?? error)),
      );
    }
  };

  redraw();
  void start();
  return {
    element,
    focusSearch: () => searchBox.focus(),
    dispose() {
      void stream?.stop();
      stream = null;
    },
  };
}
