// The navigation: the services as chips (All, then each with its unread count), the smart filters,
// and the conversations grouped by workspace with direct messages last, as one listbox whose
// options move with the arrow keys (roving tabindex) and open with Enter or a click.
import { badge } from "../format.js";
import { h, keyed } from "./h.js";

/**
 * @typedef {import("../present.js").Chrome} Chrome
 * @typedef {ReturnType<typeof import("../present.js").sidebarOf>} Sidebar
 * @typedef {import("../present.js").ConversationRow} ConversationRow
 */

const GLYPHS = /** @type {Record<string, string>} */ ({
  channel: "#",
  private: "🔒",
  dm: "@",
  group: "👥",
});

/** @param {Document} doc */
export function createNav(doc) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const platforms = byId("platforms");
  const filters = byId("filters");
  const groups = byId("groups");
  /** @type {Map<string, { node: HTMLElement, signature: string }>} */
  const rows = new Map();
  /** @type {string | null} */
  let focused = null;

  const chip = (
    /** @type {string} */ id,
    /** @type {string} */ name,
    /** @type {string} */ mark,
    /** @type {number} */ hue,
    /** @type {number} */ unread,
    /** @type {boolean} */ on,
    /** @type {string} */ label,
  ) =>
    h(
      doc,
      "button",
      {
        type: "button",
        class: `chip hue-${hue}`,
        "data-platform": id,
        "aria-pressed": String(on),
        "aria-label": label,
      },
      h(doc, "span", { class: "mark", "aria-hidden": "true", text: mark }),
      h(doc, "span", { class: "name", text: name }),
      unread
        ? h(doc, "span", { class: "count", "aria-hidden": "true", text: badge(unread) })
        : null,
    );

  const option = (/** @type {ConversationRow} */ r) => {
    const label = [
      `${r.kind === "dm" || r.kind === "group" ? "" : "#"}${r.name}`,
      `${r.platform.name} · ${r.workspace}`,
      r.label,
      r.pinned ? "pinned" : "",
    ]
      .filter(Boolean)
      .join(", ");
    return h(
      doc,
      "div",
      {
        role: "option",
        class: `conv${r.unread ? " has-unread" : ""}${r.mentions ? " has-mentions" : ""}`,
        "data-conv": r.key,
        "aria-selected": String(r.active),
        "aria-label": label,
        title: r.preview,
        tabindex: -1,
      },
      h(doc, "span", {
        class: `glyph hue-${r.platform.hue}`,
        "aria-hidden": "true",
        text: GLYPHS[r.kind] ?? "#",
      }),
      h(doc, "span", { class: "name", text: r.name }),
      r.pinned ? h(doc, "span", { class: "pin", "aria-hidden": "true", text: "▣" }) : null,
      r.mentions
        ? h(doc, "span", { class: "badge loud", "aria-hidden": "true", text: badge(r.mentions) })
        : r.unread
          ? h(doc, "span", { class: "badge", "aria-hidden": "true", text: badge(r.unread) })
          : null,
    );
  };

  /** The option that holds the roving tab stop: the focused one, else the open one, else the first. */
  const rove = () => {
    const options = [...groups.querySelectorAll("[role=option]")];
    const stop =
      options.find((o) => o.getAttribute("data-conv") === focused) ??
      options.find((o) => o.getAttribute("aria-selected") === "true") ??
      options[0];
    for (const o of options) o.setAttribute("tabindex", o === stop ? "0" : "-1");
    groups.tabIndex = stop ? -1 : 0;
  };

  return {
    /** @param {Chrome} c */
    chrome(c) {
      const total = c.platforms.reduce((n, p) => n + p.unread, 0);
      platforms.replaceChildren(
        chip(
          "all",
          "All",
          "∗",
          8,
          total,
          c.platform === null,
          total ? `All services, ${total} unread` : "All services",
        ),
        ...c.platforms.map((p) =>
          chip(p.id, p.name, p.mark, p.hue, p.unread, c.platform === p.id, p.label),
        ),
      );
      platforms.hidden = c.platforms.length < 2;
      filters.replaceChildren(
        ...c.filters.map((f) =>
          h(
            doc,
            "li",
            {},
            h(
              doc,
              "button",
              {
                type: "button",
                "data-filter": f.id,
                "aria-pressed": String(c.filter === f.id),
                "aria-label": f.count ? `${f.title}, ${f.count}` : f.title,
              },
              h(doc, "span", { text: f.title }),
              f.count
                ? h(doc, "span", {
                    class: f.id === "mentions" || f.id === "direct" ? "badge loud" : "badge",
                    "aria-hidden": "true",
                    text: f.count,
                  })
                : null,
            ),
          ),
        ),
      );
    },

    /** @param {Sidebar} s */
    sidebar(s) {
      const flat = s.groups.flatMap((g) => [
        { type: "group", key: `group:${g.id}`, g },
        ...g.rows.map((r) => ({ type: "row", key: r.key, r })),
      ]);
      keyed(
        groups,
        flat,
        (x) => x.key,
        (x) => JSON.stringify(x.type === "group" ? [x.g.title, x.g.platform?.id] : x.r),
        (x) =>
          x.type === "group"
            ? h(
                doc,
                "div",
                { class: "group-title", role: "presentation" },
                x.g.platform
                  ? h(doc, "span", {
                      class: `mark hue-${x.g.platform.hue}`,
                      "aria-hidden": "true",
                      text: x.g.platform.mark,
                    })
                  : null,
                h(doc, "span", { text: x.g.title }),
              )
            : option(/** @type {ConversationRow} */ (x.r)),
        rows,
      );
      rove();
    },

    /** Move the focus among the options; resolves the key it lands on. */
    move(/** @type {string} */ key) {
      const options = [...groups.querySelectorAll("[role=option]")];
      if (options.length === 0) return undefined;
      const at = options.indexOf(/** @type {Element} */ (doc.activeElement));
      const to =
        key === "Home"
          ? 0
          : key === "End"
            ? options.length - 1
            : key === "ArrowUp" || key === "k"
              ? Math.max(0, at - 1)
              : Math.min(options.length - 1, at + 1);
      const target = /** @type {HTMLElement | undefined} */ (
        options[at < 0 && (key === "ArrowUp" || key === "k") ? options.length - 1 : to]
      );
      focused = target?.getAttribute("data-conv") ?? null;
      rove();
      target?.focus();
      target?.scrollIntoView?.({ block: "nearest" });
      return focused ?? undefined;
    },

    /** Put the focus on the open conversation's option, or the list. */
    focus() {
      const stop = /** @type {HTMLElement | null} */ (
        groups.querySelector("[role=option][tabindex='0']")
      );
      (stop ?? groups).focus();
    },

    /** The conversation keys in the order they show. */
    order: () =>
      [...groups.querySelectorAll("[role=option]")].map((o) => o.getAttribute("data-conv") ?? ""),
  };
}
