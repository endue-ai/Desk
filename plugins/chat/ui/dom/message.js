// One message as the person sees it: the avatar and name (once per run), the time, its text drawn
// from the parsed blocks node by node, its files, reactions and replies, its state while it is
// being sent, and the tools that appear on hover or focus. Buttons carry `data-act` and the
// message's key; view.js answers them all with one listener.
import { h } from "./h.js";

/**
 * @typedef {import("../present.js").MessageModel} MessageModel
 * @typedef {import("../markup.js").Block} Block
 * @typedef {import("../markup.js").Inline} Inline
 */

/** @param {Document} doc @param {Inline[]} nodes @returns {Array<Node | string>} */
function inlines(doc, nodes) {
  return nodes.map((n) => {
    switch (n.t) {
      case "text":
        return n.v;
      case "br":
        return h(doc, "br");
      case "code":
        return h(doc, "code", { text: n.v });
      case "strong":
        return h(doc, "strong", {}, ...inlines(doc, n.c));
      case "em":
        return h(doc, "em", {}, ...inlines(doc, n.c));
      case "del":
        return h(doc, "del", {}, ...inlines(doc, n.c));
      case "link":
        return h(
          doc,
          "a",
          { href: n.href, "data-act": "link", "data-href": n.href, rel: "noreferrer" },
          ...inlines(doc, n.c),
        );
      case "mention":
        return h(doc, "span", { class: n.broad ? "mention broad" : "mention", text: `@${n.v}` });
      case "channel":
        return h(doc, "span", { class: "channel-ref", text: `#${n.v}` });
      case "emoji":
        return h(doc, "span", { class: "emoji", title: `:${n.name}:`, text: n.v });
      default:
        return "";
    }
  });
}

/** A message's text, block by block. @param {Document} doc @param {Block[]} blocks */
export function textOf(doc, blocks) {
  return h(
    doc,
    "div",
    { class: "text" },
    ...blocks.map((b) => {
      if (b.t === "pre")
        return h(
          doc,
          "pre",
          { ...(b.lang ? { "data-lang": b.lang } : {}) },
          h(doc, "code", { text: b.v }),
        );
      if (b.t === "quote") return h(doc, "blockquote", {}, ...inlines(doc, b.c));
      return h(doc, "p", {}, ...inlines(doc, b.c));
    }),
  );
}

/** The tools of a message: quick reactions, reply, save, edit, delete, the original. */
function tools(
  /** @type {Document} */ doc,
  /** @type {MessageModel} */ m,
  /** @type {string[]} */ quick,
) {
  const key = m.key;
  const tool = (
    /** @type {string} */ act,
    /** @type {string} */ label,
    /** @type {string} */ glyph,
    extra = {},
  ) =>
    h(
      doc,
      "button",
      {
        type: "button",
        class: "tool",
        "data-act": act,
        "data-key": key,
        title: label,
        "aria-label": label,
        tabindex: -1,
        ...extra,
      },
      h(doc, "span", { "aria-hidden": "true", text: glyph }),
    );
  return h(
    doc,
    "div",
    { class: "tools", role: "toolbar", "aria-label": "Message actions" },
    ...(m.can.react
      ? quick.slice(0, 3).map((e) => tool("react", `React ${e}`, e, { "data-emoji": e }))
      : []),
    m.can.react ? tool("react-pick", "Add a reaction (+)", "☺") : null,
    m.can.reply ? tool("reply", "Reply in thread (r)", "↩") : null,
    tool("save", m.saved ? "Remove from Saved (s)" : "Save for later (s)", m.saved ? "★" : "☆", {
      "aria-pressed": String(m.saved),
    }),
    m.can.edit ? tool("edit", "Edit (e)", "✎") : null,
    m.can.delete ? tool("delete", "Delete (Delete)", "🗑") : null,
    m.deepLink
      ? tool("original", "Open in the app it came from", "↗", { "data-href": m.deepLink })
      : null,
  );
}

/**
 * One message.
 * @param {Document} doc
 * @param {MessageModel} m
 * @param {{ where?: boolean, quick: string[], root?: boolean }} o `where` shows the conversation
 * it was written in (the Timeline); `root` draws a thread's first message.
 */
export function messageNode(doc, m, o) {
  const continued = m.continued && !o.where && !o.root;
  const classes = [
    "msg",
    continued ? "continued" : "",
    m.self ? "self" : "",
    m.mentioned ? "mentioned" : "",
    m.unread ? "unread" : "",
    m.pending ? `pending ${m.pending}` : "",
    o.root ? "root" : "",
    m.selected ? "selected" : "",
    m.editing ? "editing" : "",
  ].filter(Boolean);
  const label = `${m.author}, ${m.time}${m.mentioned ? ", mentions you" : ""}${m.unread ? ", unread" : ""}`;
  const head = continued
    ? null
    : h(
        doc,
        "header",
        { class: "head" },
        h(doc, "span", { class: "author", text: m.author }),
        m.bot ? h(doc, "span", { class: "tag", text: "Bot" }) : null,
        m.pinned ? h(doc, "span", { class: "tag", text: "Pinned" }) : null,
        h(doc, "time", { datetime: m.at, title: m.full, text: m.time }),
        m.edited ? h(doc, "span", { class: "muted", text: "(edited)" }) : null,
        o.where
          ? h(doc, "button", {
              type: "button",
              class: `where hue-${m.platform.hue}`,
              "data-act": "open-conversation",
              "data-conv": m.conversation,
              "data-key": m.key,
              text: m.where,
            })
          : null,
      );
  const reactions = m.reactions.length
    ? h(
        doc,
        "div",
        { class: "reactions", role: "group", "aria-label": "Reactions" },
        ...m.reactions.map((r) =>
          h(
            doc,
            "button",
            {
              type: "button",
              class: r.self ? "reaction mine" : "reaction",
              "data-act": "react",
              "data-key": m.key,
              "data-emoji": r.emoji,
              "aria-pressed": String(r.self),
              "aria-label": r.label,
              disabled: !m.can.react,
            },
            h(doc, "span", { class: "emoji", text: r.emoji }),
            h(doc, "span", { class: "count", text: String(r.count) }),
          ),
        ),
      )
    : null;
  const files = m.attachments.length
    ? h(
        doc,
        "ul",
        { class: "files", "aria-label": "Files" },
        ...m.attachments.map((a) =>
          h(
            doc,
            "li",
            {},
            a.url
              ? h(doc, "a", { href: a.url, "data-act": "link", "data-href": a.url, text: a.name })
              : h(doc, "span", { text: a.name }),
            a.size ? h(doc, "span", { class: "muted", text: ` ${a.size}` }) : null,
          ),
        ),
      )
    : null;
  const replies =
    m.replies > 0 && !o.root
      ? h(doc, "button", {
          type: "button",
          class: "replies",
          "data-act": "reply",
          "data-key": m.key,
          text: `${m.replies} ${m.replies === 1 ? "reply" : "replies"}`,
        })
      : null;
  const failed =
    m.pending === "failed"
      ? h(
          doc,
          "div",
          { class: "failed", role: "alert" },
          h(doc, "span", { text: `Not sent. ${m.error ?? ""}`.trim() }),
          h(doc, "button", {
            type: "button",
            "data-act": "retry",
            "data-key": m.key,
            text: "Retry",
          }),
          h(doc, "button", {
            type: "button",
            "data-act": "discard",
            "data-key": m.key,
            text: "Discard",
          }),
        )
      : m.pending === "sending"
        ? h(doc, "div", { class: "muted", text: "Sending…" })
        : null;
  return h(
    doc,
    "article",
    {
      class: classes.join(" "),
      "data-key": m.key,
      tabindex: m.selected ? 0 : -1,
      "aria-label": label,
      "aria-current": m.selected ? "true" : false,
    },
    continued
      ? h(doc, "time", { class: "gutter", datetime: m.at, title: m.full, text: m.time })
      : h(doc, "div", { class: `avatar hue-${m.hue}`, "aria-hidden": "true", text: m.initials }),
    h(
      doc,
      "div",
      { class: "content" },
      head,
      textOf(doc, m.blocks),
      files,
      reactions,
      replies,
      failed,
    ),
    m.pending ? null : tools(doc, m, o.quick),
  );
}
