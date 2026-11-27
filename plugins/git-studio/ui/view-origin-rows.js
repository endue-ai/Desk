// Origin rows: a semantic nested merge stack, releases, and CI runs with lazy job details.

import { button, fill, h, icon } from "./dom.js";
import { isOpen, stackRequests, statusTone } from "./origin-model.js";

/** @typedef {(url: string, label: string) => HTMLElement} Link */

/** @param {string} status */
export function originStatus(status) {
  const text = status ? status.replaceAll("_", " ") : "Unknown";
  return h(
    "span.origin-status.desk-badge",
    null,
    h("span.desk-dot", { dataset: { tone: statusTone(status) }, "aria-hidden": "true" }),
    text[0]?.toUpperCase() + text.slice(1),
  );
}

/**
 * @param {import("./origin-model.js").Request[]} requests
 * @param {boolean} github
 * @param {Link} link
 * @param {(request: import("./origin-model.js").Request, children: import("./origin-model.js").Stack[], event: MouseEvent) => void} manage
 */
export function requestRows(requests, github, link, manage) {
  /** @param {import("./origin-model.js").Stack[]} stacks @param {number} depth @param {string} [parent] */
  function rows(stacks, depth, parent) {
    return h(
      "ul.origin-list",
      null,
      ...stacks.map(({ request, children }) => {
        const {
          number,
          title,
          url,
          state,
          source,
          sourceRepo,
          target,
          targetRepo,
          author,
          updated,
        } = request;
        const label = `${github ? "#" : "!"}${number}`;
        const fork = sourceRepo && sourceRepo !== targetRepo;
        return h(
          "li",
          null,
          h(
            "div.origin-row",
            null,
            h(
              "div.origin-row-text",
              null,
              h("div.origin-inline", null, originStatus(state), h("span.desk-muted", null, label)),
              link(url, title || label),
              h(
                "span.origin-branches",
                { title: fork && github ? sourceRepo : undefined },
                h("span", null, fork && github ? `${sourceRepo}:${source}` : source),
                h("span", { "aria-label": "merges into" }, "→"),
                h("span", null, target),
              ),
              h(
                "span.origin-inline.desk-muted",
                null,
                fork && !github ? "Fork" : null,
                author,
                date(updated),
                parent ? `Before ${parent}` : null,
              ),
            ),
            isOpen(request) || state === "Closed"
              ? manageButton(`Manage request ${label}`, (event) => manage(request, children, event))
              : null,
          ),
          children.length
            ? h(
                "div.origin-children",
                { class: depth >= 2 ? "origin-deep" : undefined },
                rows(children, depth + 1, label),
              )
            : null,
        );
      }),
    );
  }
  return rows(stackRequests(requests), 0);
}

/** @param {import("./origin-model.js").Release[]} releases @param {Link} link
 * @param {(release: import("./origin-model.js").Release, event: MouseEvent) => void} manage */
export function releaseRows(releases, link, manage) {
  return h(
    "ul.origin-list",
    null,
    ...releases.map((release) =>
      h(
        "li.origin-row",
        null,
        h(
          "div.origin-row-text",
          null,
          link(release.url, release.name),
          h(
            "span.origin-inline.desk-muted",
            null,
            originStatus(release.state),
            h("code", null, release.tag),
            date(release.date),
          ),
        ),
        manageButton(`Manage release ${release.tag}`, (event) => manage(release, event)),
      ),
    ),
  );
}

/**
 * @param {import("./origin-model.js").Run[]} runs
 * @param {Link} link
 * @param {(run: import("./origin-model.js").Run) => Promise<{ items: import("./origin-model.js").Job[], more: boolean }>} getJobs
 */
export function runRows(runs, link, getJobs) {
  return h(
    "ul.origin-list",
    null,
    ...runs.map((run) => {
      const detail = h("div.origin-jobs", { id: `origin-jobs-${run.id}`, hidden: true });
      let pinned = false;
      let hovered = false;
      let loaded = false;
      let pending = false;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const toggle = h(
        "button.desk-icon-btn.desk-btn-quiet.origin-manage",
        {
          type: "button",
          title: "Show jobs",
          "aria-label": `Show jobs for ${run.name} #${run.id}`,
          "aria-expanded": "false",
          "aria-controls": detail.id,
          onClick: () => {
            pinned = !pinned;
            reveal(pinned);
          },
        },
        icon("chevronDown", 15),
      );
      function reveal(/** @type {boolean} */ visible) {
        clearTimeout(timer);
        detail.hidden = !visible;
        toggle.setAttribute("aria-expanded", String(visible));
        if (visible && !loaded && !pending) void load();
      }

      async function load() {
        pending = true;
        fill(
          detail,
          h("p.origin-message", { role: "status" }, h("span.desk-spinner"), "Loading jobs…"),
        );
        try {
          const { items, more } = await getJobs(run);
          loaded = true;
          fill(
            detail,
            items.length
              ? h(
                  "ul.origin-list",
                  null,
                  ...items.map((job) =>
                    h(
                      "li.origin-job",
                      null,
                      h(
                        "div.origin-row-text",
                        null,
                        link(job.url, job.name),
                        h(
                          "span.origin-inline.desk-muted",
                          null,
                          job.stage,
                          duration(job.started, job.finished),
                        ),
                      ),
                      originStatus(job.status),
                    ),
                  ),
                )
              : h("p.origin-message.desk-muted", null, "No jobs have reported yet."),
            more
              ? h("p.origin-message.desk-muted", null, link(run.url, "Open the run for all jobs"))
              : null,
          );
        } catch (error) {
          loaded = true;
          fill(
            detail,
            h(
              "p.origin-message",
              { role: "alert" },
              error instanceof Error ? error.message : String(error),
            ),
            button({ label: "Retry jobs", kind: "desk-btn-quiet", onClick: () => void load() }),
          );
        } finally {
          pending = false;
        }
      }

      return h(
        "li.origin-run",
        {
          onKeydown: (/** @type {KeyboardEvent} */ event) => {
            if (event.key !== "Escape" || detail.hidden) return;
            event.stopPropagation();
            pinned = false;
            reveal(false);
            toggle.focus();
          },
          onMouseenter: () => {
            hovered = true;
            if (!pinned)
              timer = setTimeout(() => {
                if (detail.isConnected) reveal(true);
              }, 250);
          },
          onMouseleave: () => {
            hovered = false;
            clearTimeout(timer);
            if (!pinned && !detail.contains(detail.ownerDocument.activeElement)) reveal(false);
          },
          onFocusout: (/** @type {FocusEvent} */ event) => {
            if (
              !pinned &&
              !hovered &&
              !detail.contains(/** @type {Node | null} */ (event.relatedTarget))
            )
              reveal(false);
          },
        },
        h(
          "div.origin-row",
          null,
          h(
            "div.origin-row-text",
            null,
            h("div.origin-inline", null, originStatus(run.status), date(run.date)),
            link(run.url, run.name),
            h(
              "span.origin-inline.desk-muted",
              null,
              h("code", null, run.ref),
              run.sha ? h("code", null, run.sha.slice(0, 7)) : null,
            ),
          ),
          toggle,
        ),
        detail,
      );
    }),
  );
}

/** @param {string} label @param {(event: MouseEvent) => void} onClick */
function manageButton(label, onClick) {
  return h(
    "button.desk-icon-btn.desk-btn-quiet.origin-manage",
    {
      type: "button",
      "aria-label": label,
      title: label,
      "aria-haspopup": "menu",
      onClick,
    },
    icon("more", 16),
  );
}

/** @param {string} value */
function date(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const when = new Date(timestamp);
  return h(
    "time",
    { datetime: value, title: when.toLocaleString() },
    when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
  );
}

/** @param {string} started @param {string} finished */
function duration(started, finished) {
  const seconds = Math.round((Date.parse(finished) - Date.parse(started)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
