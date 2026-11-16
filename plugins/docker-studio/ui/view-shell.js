// The frame every page sits in: the sidebar (the mark, the engine card, the sections with their
// counts, the assistant and clean-up at the bottom), the top bar (the page's title, the search,
// the page's own buttons) and the status bar (engine, resource use, disk, live).

import { button, dot, fill, h, icon } from "./dom.js";
import { bytes, memory, percent } from "./format.js";

/**
 * @typedef {import("./dom.js").IconName} IconName
 * @typedef {{ id: string, title: string, icon: IconName, group: string, count?(state: any): string }} Section
 */

/** @type {Section[]} */
export const SECTIONS = [
  { id: "dashboard", title: "Dashboard", icon: "dashboard", group: "" },
  {
    id: "containers",
    title: "Containers",
    icon: "container",
    group: "Engine",
    count: (s) => {
      const running = s.containers.filter((/** @type {any} */ c) => c.state === "running").length;
      return s.containers.length ? `${running}/${s.containers.length}` : "";
    },
  },
  { id: "images", title: "Images", icon: "image", group: "Engine", count: (s) => num(s.images) },
  {
    id: "volumes",
    title: "Volumes",
    icon: "volume",
    group: "Engine",
    count: (s) => num(s.volumes),
  },
  {
    id: "networks",
    title: "Networks",
    icon: "network",
    group: "Engine",
    count: (s) => num(s.networks),
  },
  { id: "compose", title: "Compose", icon: "stack", group: "Engine", count: (s) => stacks(s) },
  { id: "builds", title: "Builds", icon: "build", group: "Build and ship" },
  { id: "hub", title: "Explore images", icon: "hub", group: "Build and ship" },
  { id: "contexts", title: "Contexts", icon: "server", group: "Connection" },
];

const num = (/** @type {unknown[]} */ list) => (list.length ? String(list.length) : "");
const stacks = (/** @type {any} */ s) => {
  const names = new Set([
    ...s.projects.map((/** @type {any} */ p) => p.name),
    ...s.containers.map((/** @type {any} */ c) => c.project).filter(Boolean),
  ]);
  return names.size ? String(names.size) : "";
};

/**
 * @param {Document} doc
 * @param {{ go(page: string): void, assistant(): void, cleanup(): void, settings(): void,
 *   refresh(): void, search(text: string): void }} on
 */
export function createShell(doc, on) {
  const nav = h("nav.side-nav", { "aria-label": "Sections" });
  const engineCard = h("button.desk-btn.desk-btn-quiet.engine-card", {
    type: "button",
    title: "Contexts and the engine",
    onClick: () => on.go("contexts"),
  });
  const cleanupNote = h("small.side-note");
  const side = h(
    "aside.side",
    { "aria-label": "Docker Studio" },
    h(
      "div.brand",
      null,
      h("span.brand-mark", null, icon("mark", 20)),
      h(
        "div.brand-text",
        null,
        h("b", null, "Docker Studio"),
        h("small", null, "Containers, images, stacks"),
      ),
    ),
    engineCard,
    nav,
    h("div.side-spacer"),
    h(
      "div.side-foot",
      null,
      h(
        "button.desk-btn.desk-btn-quiet.side-item.ai-item",
        { type: "button", onClick: () => on.assistant() },
        icon("sparkle"),
        h("span.side-label", null, "Ask AI"),
        h("kbd", null, "A"),
      ),
      h(
        "button.desk-btn.desk-btn-quiet.side-item",
        { type: "button", onClick: () => on.cleanup() },
        icon("broom"),
        h("span.side-label", null, "Clean up"),
        cleanupNote,
      ),
      h(
        "button.desk-btn.desk-btn-quiet.side-item",
        { type: "button", onClick: () => on.settings() },
        icon("settings"),
        h("span.side-label", null, "Settings"),
      ),
    ),
  );

  const title = h("h1.page-title");
  const subtitle = h("p.page-sub");
  const tools = h("div.page-tools");
  const search = /** @type {HTMLInputElement} */ (
    h("input.desk-field.top-search", {
      type: "search",
      placeholder: "Search containers, images, volumes…",
      "aria-label": "Search",
      spellcheck: "false",
      autocomplete: "off",
      onInput: () => on.search(search.value),
    })
  );
  const top = h(
    "header.top",
    null,
    h("div.page-head", null, title, subtitle),
    h("label.search-wrap", null, icon("search"), search, h("kbd", null, "/")),
    tools,
  );
  const banner = h("div.banner", { hidden: true, role: "alert" });
  const content = h("main.content", { tabindex: "-1" });
  const status = h("footer.statusbar", { role: "status" });
  const root = h("div.studio", null, side, h("div.main", null, top, banner, content), status);
  doc.body.append(root);

  /** @type {Map<string, HTMLElement>} */
  const items = new Map();
  let group = "";
  for (const section of SECTIONS) {
    if (section.group !== group) {
      group = section.group;
      nav.append(h("p.side-group", null, group));
    }
    const badge = h("span.side-count");
    const item = h(
      "button.desk-btn.desk-btn-quiet.side-item",
      { type: "button", dataset: { page: section.id }, onClick: () => on.go(section.id) },
      icon(section.icon),
      h("span.side-label", null, section.title),
      badge,
    );
    items.set(section.id, item);
    nav.append(item);
  }

  return {
    content,
    tools,
    search,
    /** @param {string} page */
    current(page) {
      for (const [id, item] of items) {
        item.classList.toggle("active", id === page);
        if (id === page) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      }
    },
    /** @param {string} text @param {string} [sub] */
    heading(text, sub = "") {
      title.textContent = text;
      subtitle.textContent = sub;
      subtitle.hidden = sub === "";
    },
    /** @param {any} state */
    counts(state) {
      for (const section of SECTIONS) {
        const badge = items.get(section.id)?.querySelector(".side-count");
        if (badge) badge.textContent = section.count?.(state) ?? "";
      }
      const reclaim = state.disk.reduce(
        (/** @type {number} */ sum, /** @type {any} */ d) => sum + d.reclaimable,
        0,
      );
      cleanupNote.textContent = reclaim > 0 ? bytes(reclaim) : "";
    },
    /** @param {any} state */
    engine(state) {
      const e = state.engine;
      const info = e.info;
      const label =
        e.status === "up" ? "Running" : e.status === "down" ? "Not reachable" : "Connecting";
      fill(
        engineCard,
        dot(e.status === "up" ? "running" : e.status === "down" ? "dead" : "created", label),
        h(
          "span.engine-text",
          null,
          h("b", null, `Engine ${label.toLowerCase()}`),
          h(
            "small",
            null,
            [state.context || info?.context || "default", info?.server ? `v${info.server}` : ""]
              .filter(Boolean)
              .join(" · "),
          ),
        ),
        icon("chevronRight", 14),
      );
      if (e.status === "down" && e.problem) {
        fill(
          banner,
          icon("alert", 18),
          h("p", null, e.problem),
          button({ label: "Try again", icon: "restart", onClick: () => on.refresh() }),
        );
        banner.hidden = false;
      } else banner.hidden = true;
    },
    /**
     * @param {any} state
     * @param {{ cpu: number[], mem: number[] }} total
     */
    status(state, total) {
      const e = state.engine;
      const info = e.info;
      const running = state.containers.filter(
        (/** @type {any} */ c) => c.state === "running",
      ).length;
      const cpu = total.cpu.at(-1);
      const mem = total.mem.at(-1);
      const diskTotal = state.disk.reduce(
        (/** @type {number} */ s, /** @type {any} */ d) => s + d.size,
        0,
      );
      fill(
        status,
        h(
          "span.sb-item",
          null,
          dot(e.status === "up" ? "running" : e.status === "down" ? "dead" : "created"),
          e.status === "up"
            ? "Engine running"
            : e.status === "down"
              ? "Engine not reachable"
              : "Connecting…",
        ),
        info
          ? h("span.sb-item", null, icon("server", 13), state.context || info.context || "default")
          : null,
        e.status === "up"
          ? [
              h(
                "span.sb-item",
                { title: "CPU used by containers, of every core" },
                icon("cpu", 13),
                cpu === undefined ? "CPU –" : `CPU ${percent(cpu / Math.max(1, info?.cpus ?? 1))}`,
              ),
              h(
                "span.sb-item",
                { title: "Memory used by containers" },
                icon("memory", 13),
                mem === undefined ? "Memory –" : `${memory(mem)} of ${memory(info?.memory ?? 0)}`,
              ),
              diskTotal > 0
                ? h(
                    "span.sb-item",
                    { title: "Disk used by Docker" },
                    icon("disk", 13),
                    bytes(diskTotal),
                  )
                : null,
              h("span.sb-item", null, icon("container", 13), `${running} running`),
            ]
          : null,
        h("span.sb-spacer"),
        state.busy > 0 ? h("span.sb-item.sb-busy", null, h("span.spinner"), "Working") : null,
        e.status === "up"
          ? h(
              "span.sb-item.live",
              { title: "Following the engine's events" },
              h("span.live-dot"),
              "Live",
            )
          : null,
        info
          ? h("span.sb-item.muted", null, `Docker ${info.server} · ${info.os || info.platform}`)
          : null,
      );
    },
    /** The top bar's buttons of the page on screen. @param {...HTMLElement} buttons */
    pageTools(...buttons) {
      fill(tools, ...buttons);
    },
  };
}

/** @typedef {ReturnType<typeof createShell>} Shell */
