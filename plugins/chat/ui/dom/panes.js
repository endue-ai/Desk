// The main area in each layout and the thread beside it. A pane is one conversation's messages
// with its header and composer (the open conversation, an Inbox card, a Column); the Timeline is
// one stream of every conversation. Panes and their rows are kept by key across redraws; a
// conversation read top to bottom stays at its end when it was there, and keeps its place when
// earlier messages load above.
import { badge } from "../format.js";
import { atEnd, h, keyed } from "./h.js";
import { messageNode } from "./message.js";

/**
 * @typedef {import("../present.js").Main} Main
 * @typedef {import("../present.js").Pane} Pane
 * @typedef {import("../present.js").Row} Row
 * @typedef {import("../present.js").ThreadModel} ThreadModel
 * @typedef {ReturnType<typeof import("./composer.js").createComposers>} Composers
 * @typedef {{ node: HTMLElement, log: HTMLElement, head: HTMLElement, foot: HTMLElement,
 *   rows: Map<string, { node: HTMLElement, signature: string }>, first: string, signature: string }} Held
 */

/** @param {Document} doc @param {Composers} composers @param {() => string[]} quick */
export function createPanes(doc, composers, quick) {
  const main = /** @type {HTMLElement} */ (doc.getElementById("main"));
  const aside = /** @type {HTMLElement} */ (doc.getElementById("thread"));
  /** @type {Map<string, Held>} */
  const panes = new Map();
  /** @type {Set<string>} */
  let targets = new Set();

  const rowNode = (
    /** @type {Row} */ row,
    /** @type {{ where?: boolean, root?: boolean }} */ o = {},
  ) => {
    if (row.type === "day")
      return h(
        doc,
        "div",
        { class: "day", role: "separator", "aria-label": row.label },
        h(doc, "span", { text: row.label }),
      );
    if (row.type === "new")
      return h(
        doc,
        "div",
        { class: "new-line", role: "separator", "aria-label": "New messages" },
        h(doc, "span", { text: "New" }),
      );
    return messageNode(doc, row.message, {
      ...o,
      root: row.key.startsWith("root:"),
      quick: quick(),
    });
  };

  /**
   * Fill a log with rows, keeping its place: at the end when it was there (or `fresh`), the same
   * distance from the end when rows arrived above, else where it was.
   * @param {Held} held
   * @param {Row[]} rows
   * @param {{ where?: boolean, stick: boolean }} o
   */
  const fill = (held, rows, o) => {
    const log = held.log;
    const end = o.stick && (atEnd(log) || log.dataset.fresh !== "0");
    const fromEnd = log.scrollHeight - log.scrollTop;
    const signature = `${quick().join("")}`;
    if (signature !== held.signature) held.rows.clear();
    held.signature = signature;
    keyed(
      log,
      rows,
      (r) => r.key,
      (r) => JSON.stringify(r),
      (r) => rowNode(r, o),
      held.rows,
    );
    const first = rows[0]?.key ?? "";
    if (o.stick) {
      if (end) log.scrollTop = log.scrollHeight;
      else if (first !== held.first && held.first !== "")
        log.scrollTop = log.scrollHeight - fromEnd;
    }
    held.first = first;
    log.dataset.fresh = "0";
  };

  /** A pane's frame, made once per key. */
  const frame = (
    /** @type {string} */ key,
    /** @type {string} */ kind,
    /** @type {string} */ label,
  ) => {
    const held = panes.get(key);
    if (held) return held;
    const head = h(doc, "header", { class: "pane-head" });
    const log = h(doc, "div", {
      class: "log",
      role: "log",
      "aria-label": label,
      tabindex: -1,
      "data-fresh": "1",
    });
    const foot = h(doc, "div", { class: "pane-foot" });
    const node = h(
      doc,
      "section",
      { class: `pane ${kind}`, "data-conv": key, "aria-label": label },
      head,
      log,
      foot,
    );
    const made = { node, log, head, foot, rows: new Map(), first: "", signature: "" };
    panes.set(key, made);
    return made;
  };

  /** A pane's header: service mark, name, where, counts and its tools. */
  const header = (
    /** @type {Pane} */ p,
    /** @type {"conversation" | "card" | "column"} */ kind,
  ) => {
    const name = p.kind === "dm" || p.kind === "group" ? p.name : `#${p.name}`;
    // A Column is narrow: its tools are glyphs, named by their label for every reader.
    const compact = kind === "column";
    const tool = (
      /** @type {string} */ act,
      /** @type {string} */ text,
      /** @type {string} */ glyph,
      /** @type {Record<string, string>} */ extra = {},
    ) =>
      h(
        doc,
        "button",
        {
          type: "button",
          class: compact ? "pane-tool icon" : "pane-tool",
          "data-act": act,
          "data-conv": p.key,
          title: text,
          "aria-label": text,
          ...extra,
        },
        compact ? h(doc, "span", { "aria-hidden": "true", text: glyph }) : text,
      );
    return [
      h(doc, "span", {
        class: `mark hue-${p.platform.hue}`,
        title: p.platform.name,
        "aria-hidden": "true",
        text: p.platform.mark,
      }),
      h(
        doc,
        "div",
        { class: "pane-title" },
        h(doc, kind === "conversation" ? "h2" : "h3", { text: name }),
        h(doc, "p", {
          class: "muted",
          text: [p.platform.name, p.workspace, p.topic].filter(Boolean).join(" · "),
        }),
      ),
      p.unread
        ? h(doc, "span", {
            class: "badge",
            "aria-label": `${p.unread} unread`,
            text: badge(p.unread),
          })
        : null,
      h(
        doc,
        "div",
        { class: "pane-tools", role: "toolbar", "aria-label": `${name} actions` },
        kind !== "conversation" ? tool("open-conversation", "Open", "↗") : null,
        p.unread ? tool("mark-read", "Mark read", "✓") : null,
        kind !== "card"
          ? tool("pin", p.pinned ? "Unpin" : "Pin as column", "▣", {
              "aria-pressed": String(p.pinned),
            })
          : null,
      ),
    ];
  };

  /** One pane drawn from its model. */
  const pane = (/** @type {Pane} */ p, /** @type {"conversation" | "card" | "column"} */ kind) => {
    const held = frame(
      `${kind}:${p.key}`,
      kind,
      p.kind === "dm" || p.kind === "group" ? p.name : `#${p.name}`,
    );
    held.head.replaceChildren(...header(p, kind).filter((n) => n !== null));
    const rows = p.rows.length > 0 || kind === "card" ? p.rows : [];
    fill(held, rows, { stick: kind !== "card" });
    const more =
      p.more && kind === "conversation"
        ? h(doc, "button", {
            type: "button",
            class: "earlier",
            "data-act": "more",
            "data-conv": p.key,
            text: p.loading ? "Loading…" : "Load earlier messages",
          })
        : null;
    const empty = rows.length === 0 ? h(doc, "p", { class: "empty", text: p.empty }) : null;
    if (more) held.log.prepend(more);
    if (empty) held.log.append(empty);
    targets.add(p.composer.target);
    held.foot.replaceChildren(composers.get(p.composer));
    held.node.setAttribute("aria-busy", String(p.loading));
    return held.node;
  };

  /** The words of an empty layout, and Connect an account when an installed connector can. */
  const emptyNode = (/** @type {Main} */ m) =>
    h(
      doc,
      "div",
      { class: "empty-state" },
      h(doc, "p", { text: m.empty }),
      m.connect
        ? h(doc, "button", {
            type: "button",
            class: "desk-btn desk-btn-primary",
            "data-act": "connect",
            text: "Connect an account",
          })
        : null,
    );

  return {
    /** @param {Main} m */
    main(m) {
      targets = new Set([...targets].filter((t) => t.startsWith("thread:")));
      main.dataset.layout = m.layout;
      if (m.layout === "conversation") {
        main.replaceChildren(m.pane ? pane(m.pane, "conversation") : emptyNode(m));
      } else if (m.layout === "inbox") {
        const cards = m.cards.map((c) => pane(c, "card"));
        main.replaceChildren(
          h(
            doc,
            "header",
            { class: "layout-head" },
            h(doc, "h2", { text: "Inbox" }),
            h(doc, "p", {
              class: "muted",
              text: m.cards.length
                ? `${m.cards.length} ${m.cards.length === 1 ? "conversation" : "conversations"} waiting`
                : "",
            }),
          ),
          m.cards.length ? h(doc, "div", { class: "cards" }, ...cards) : emptyNode(m),
        );
      } else if (m.layout === "timeline") {
        const held = frame("timeline", "timeline", m.title);
        held.head.replaceChildren(h(doc, "h2", { text: m.title }));
        fill(held, m.rows, { where: true, stick: false });
        if (m.rows.length === 0)
          held.log.append(
            m.connect ? emptyNode(m) : h(doc, "p", { class: "empty", text: m.empty }),
          );
        held.foot.replaceChildren(
          m.more
            ? h(doc, "button", {
                type: "button",
                class: "earlier",
                "data-act": "more-timeline",
                text: m.loading ? "Loading…" : "Show more",
              })
            : "",
        );
        held.node.setAttribute("aria-busy", String(m.loading));
        main.replaceChildren(held.node);
      } else {
        const columns = m.columns.map((c) => pane(c, "column"));
        main.replaceChildren(
          m.columns.length ? h(doc, "div", { class: "columns" }, ...columns) : emptyNode(m),
        );
      }
      const shown = new Set(
        [...main.querySelectorAll("[data-conv].pane")]
          .map((n) => n.closest(".pane"))
          .filter(Boolean),
      );
      for (const [key, held] of panes)
        if (!shown.has(held.node) && key !== "thread" && key !== "timeline") panes.delete(key);
      composers.keep(targets);
    },

    /** @param {ThreadModel | null} t */
    thread(t) {
      aside.hidden = t === null;
      doc.body.dataset.thread = t ? "open" : "closed";
      if (!t) {
        aside.replaceChildren();
        panes.delete("thread");
        targets = new Set([...targets].filter((x) => !x.startsWith("thread:")));
        composers.keep(targets);
        return;
      }
      const held = frame("thread", "thread", "Thread");
      held.head.replaceChildren(
        h(
          doc,
          "div",
          { class: "pane-title" },
          h(doc, "h2", { text: "Thread" }),
          h(doc, "p", { class: "muted", text: t.where }),
        ),
        h(doc, "button", {
          type: "button",
          class: "pane-tool",
          "data-act": "close-thread",
          "aria-label": "Close the thread (Escape)",
          text: "✕",
        }),
      );
      const rows = [
        { type: /** @type {const} */ ("message"), key: `root:${t.root.key}`, message: t.root },
        ...(t.rows.length
          ? []
          : [
              {
                type: /** @type {const} */ ("day"),
                key: "none",
                label: t.loading ? "Loading replies…" : "No replies yet",
              },
            ]),
        ...t.rows,
      ];
      fill(held, rows, { stick: true });
      targets.add(t.composer.target);
      held.foot.replaceChildren(composers.get(t.composer));
      if (!aside.contains(held.node)) aside.replaceChildren(held.node);
      composers.keep(targets);
    },
  };
}
