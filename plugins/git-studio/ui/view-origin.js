// Dashboard state is scoped to the visible checkout and its origin. Each read can fail and retry
// independently, and a result from a previous origin or filter cannot replace the current view.

import { messageOf } from "./app.js";
import { button, fill, h, icon } from "./dom.js";
import { originApi } from "./origin-api.js";
import { originControls } from "./origin-controls.js";
import { isOpen, parseOrigin, statusTone } from "./origin-model.js";
import { releaseRows, requestRows, runRows } from "./view-origin-rows.js";

/** @param {import("./app.js").App} app @param {import("./studio.js").Ctx["bridge"]} bridge
 * @param {HTMLElement} page @param {HTMLElement} layer */
export function createOriginView(app, bridge, page, layer) {
  page.classList.add("origin-page", "desk-pane");
  const targetLine = h("div.desk-header-desc");
  const heading = h("h1.desk-header-title", { tabindex: "-1" }, "Origin");
  const notice = h("div.origin-notice");
  const overview = h("nav.origin-summary", { "aria-label": "Origin overview" });
  const requests = h("section.origin-section.origin-requests", { id: "origin-requests" });
  const runs = h("section.origin-section", { id: "origin-runs" });
  const releases = h("section.origin-section", { id: "origin-releases" });
  const grid = h("div.origin-grid", null, requests, runs, releases);
  page.append(
    h(
      "header.desk-header.origin-header",
      null,
      h("div.desk-header-text", null, heading, targetLine),
      button({ label: "Refresh origin", icon: "refresh", onClick: refreshOrigin }),
    ),
    notice,
    overview,
    grid,
  );

  /** @type {import("./origin-controls.js").Target | null} */
  let target = null;
  /** @type {"open" | "all"} */
  let filter = "open";
  let requestPage = 1;
  let moreRequests = false;
  const requestData = section(/** @type {import("./origin-model.js").Request[]} */ ([]));
  const runData = section(/** @type {import("./origin-model.js").Run[]} */ ([]));
  const releaseData = section(/** @type {import("./origin-model.js").Release[]} */ ([]));
  const controls = originControls(app, layer, () => target, report, reload);

  /** @param {string} text @param {boolean} error */
  function report(text, error) {
    fill(
      notice,
      h(error ? "p.desk-error" : "p.origin-message", { role: error ? "alert" : "status" }, text),
    );
  }

  /** @param {string} url @param {string} text */
  function link(url, text) {
    return url
      ? h(
          "a.origin-link",
          {
            href: url,
            onClick: (/** @type {MouseEvent} */ event) => {
              event.preventDefault();
              void bridge
                .call("shell.open", {
                  target: url,
                  scope: { permission: "shell:open", schemes: ["https"] },
                })
                .catch(() =>
                  report(
                    "The link could not open. Check Desk’s link permission and try again.",
                    true,
                  ),
                );
            },
          },
          text,
        )
      : h("span", null, text);
  }

  function sync() {
    const state = app.get();
    const snapshot =
      state.center === "origin" && state.snapshot?.root === state.repo ? state.snapshot : null;
    const remote = snapshot?.remotes.find(({ name }) => name === "origin");
    const origin = parseOrigin(remote?.url);
    if (snapshot && origin && target?.root === snapshot.root && target.origin.web === origin.web)
      return;
    target =
      snapshot && origin ? { root: snapshot.root, origin, api: originApi(app.git, origin) } : null;
    filter = "open";
    requestData.clear();
    runData.clear();
    releaseData.clear();
    notice.replaceChildren();
    page.scrollTop = 0;
    const current = target;
    overview.hidden = !current;
    grid.hidden = !current;
    if (current) {
      fill(
        targetLine,
        icon("cloud", 14),
        link(current.origin.web, current.origin.path),
        current.origin.program === "gh" ? "GitHub" : "GitLab",
      );
      reload();
    } else if (state.center === "origin") {
      fill(targetLine, state.repo ?? "");
      report(
        !snapshot
          ? "Read the local repository before loading its origin."
          : remote
            ? "Origin must point to github.com or gitlab.com to show hosted activity."
            : "This repository has no remote named origin. Add an origin and refresh.",
        false,
      );
    }
  }

  function refreshOrigin() {
    const current = target;
    void app.refresh().then(() => {
      if (target === current && current) reload();
    });
  }

  function reload() {
    const current = target;
    if (!current) return;
    loadRequests();
    void runData.read(() => current.api.runs(), drawRuns);
    void releaseData.read(() => current.api.releases(), drawReleases);
  }

  /** @param {boolean} [append] */
  function loadRequests(append = false) {
    const current = target;
    if (!current) return;
    if (!append) {
      requestPage = 1;
      moreRequests = false;
    }
    const next = append ? requestPage + 1 : 1;
    const previous = append ? requestData.items : [];
    const mode = filter;
    void requestData.read(
      () => current.api.requests(mode, next),
      drawRequests,
      ({ items, more }) => {
        moreRequests = more;
        requestPage = next;
        return [...new Map([...previous, ...items].map((item) => [item.number, item])).values()];
      },
    );
  }

  function drawSummary() {
    const current = target;
    if (!current) return;
    const open = requestData.items.filter(isOpen).length;
    const failing = runData.items.filter((run) => statusTone(run.status) === "danger").length;
    const active = runData.items.filter((run) => statusTone(run.status) === "warning").length;
    fill(
      overview,
      jump(
        requests,
        `${open} open${moreRequests || filter === "all" ? " shown" : ""}`,
        current.origin.program === "gh" ? "Pull requests" : "Merge requests",
        requestData,
      ),
      jump(runs, `${failing} failed · ${active} active`, "Recent CI", runData),
      jump(releases, releaseData.items[0]?.tag ?? "None yet", "Latest release", releaseData),
    );
  }

  function drawRequests() {
    const current = target;
    if (!current) return;
    const github = current.origin.program === "gh";
    const noun = github ? "pull requests" : "merge requests";
    fill(
      requests,
      sectionHeader(
        github ? "Pull requests" : "Merge requests",
        button({
          label: github ? "Create PR" : "Create MR",
          icon: "plus",
          kind: "desk-btn-primary",
          onClick: () => controls.createRequest(current),
        }),
      ),
      h(
        "div.desk-chips.origin-filters",
        { "aria-label": "Request state" },
        .../** @type {const} */ (["open", "all"]).map((mode) =>
          h(
            "button.desk-chip.desk-btn",
            {
              type: "button",
              "aria-pressed": String(filter === mode),
              onClick: () => {
                if (filter === mode) return;
                filter = mode;
                requestData.clear();
                loadRequests();
                requests.querySelector('[aria-pressed="true"]')?.focus();
              },
            },
            mode === "open" ? "Open" : "All",
          ),
        ),
      ),
      requestData.feedback(`No ${filter === "open" ? "open " : ""}${noun} on origin.`, () =>
        loadRequests(moreRequests),
      ),
      requestData.items.length
        ? requestRows(requestData.items, github, link, (request, event) =>
            controls.requestMenu(current, request, event),
          )
        : null,
      moreRequests
        ? button({
            label: "Load more requests",
            disabled: requestData.loading,
            onClick: () => loadRequests(true),
          })
        : null,
    );
    drawSummary();
  }

  function drawRuns() {
    const current = target;
    if (!current) return;
    const github = current.origin.program === "gh";
    fill(
      runs,
      sectionHeader(
        github ? "GitHub Actions" : "GitLab pipelines",
        link(`${current.origin.web}/${github ? "actions" : "-/pipelines"}`, "View all"),
      ),
      runData.feedback(
        github ? "No workflow runs on origin." : "No pipelines on origin.",
        () => void runData.read(() => current.api.runs(), drawRuns),
      ),
      runData.items.length ? runRows(runData.items, link, current.api.jobs) : null,
    );
    drawSummary();
  }

  function drawReleases() {
    const current = target;
    if (!current) return;
    fill(
      releases,
      sectionHeader(
        "Releases",
        button({
          label: "Publish release",
          icon: "plus",
          onClick: () => controls.publish(current),
        }),
      ),
      releaseData.feedback(
        "No releases on origin.",
        () => void releaseData.read(() => current.api.releases(), drawReleases),
      ),
      releaseData.items.length
        ? releaseRows(releaseData.items, link, (release, event) =>
            controls.releaseMenu(current, release, event),
          )
        : null,
      h(
        "p.origin-message",
        null,
        link(
          `${current.origin.web}/${current.origin.program === "gh" ? "releases" : "-/releases"}`,
          "View all releases",
        ),
      ),
    );
    drawSummary();
  }

  app.subscribe((state, previous) => {
    if (
      state.center !== previous.center ||
      state.repo !== previous.repo ||
      state.snapshot !== previous.snapshot
    )
      sync();
  });
  return { focus: () => heading.focus() };
}

/** @template T @param {T[]} initial */
function section(initial) {
  let revision = 0;
  return {
    items: initial,
    loading: false,
    error: "",
    clear() {
      revision++;
      this.items = initial;
      this.loading = false;
      this.error = "";
    },
    /** @template R @param {() => Promise<R>} load @param {() => void} draw @param {(value: R) => T[]} [pick] */
    async read(load, draw, pick) {
      const seq = ++revision;
      this.loading = true;
      this.error = "";
      draw();
      try {
        const value = await load();
        if (seq === revision)
          this.items = pick ? pick(value) : /** @type {T[]} */ (/** @type {unknown} */ (value));
      } catch (error) {
        if (seq === revision) this.error = messageOf(error);
      } finally {
        if (seq === revision) {
          this.loading = false;
          draw();
        }
      }
    },
    /** @param {string} empty @param {() => void} retry */
    feedback(empty, retry) {
      if (this.error)
        return h(
          "div.desk-error",
          { role: "alert" },
          h("p", null, this.error),
          button({ label: "Retry", onClick: retry }),
        );
      if (this.loading)
        return h(
          "p.origin-message.desk-muted",
          { role: "status" },
          h("span.desk-spinner"),
          "Loading…",
        );
      return this.items.length ? null : h("p.origin-message.desk-muted", null, empty);
    },
  };
}

/** @param {HTMLElement} destination @param {string} value @param {string} label
 * @param {{ error: string, loading: boolean }} data */
function jump(destination, value, label, data) {
  return h(
    "button.desk-btn.origin-summary-item",
    {
      type: "button",
      onClick: () => {
        destination.scrollIntoView?.({ block: "start" });
        destination.querySelector("h2")?.focus({ preventScroll: true });
      },
    },
    h("span.desk-muted", null, label),
    h("strong", null, data.error ? "Unavailable" : data.loading ? "Loading…" : value),
  );
}

/** @param {string} title @param {HTMLElement} action */
function sectionHeader(title, action) {
  return h(
    "header.origin-section-head.desk-header",
    null,
    h("h2.desk-header-title", { tabindex: "-1" }, title),
    action,
  );
}
