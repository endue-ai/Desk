// Find in a response: every match of a text in a drawn body marked, and server-sent events read
// out of an event-stream body.

import { h } from "./dom.js";

/** One server-sent event. @typedef {{ id: string, event: string, data: string, retry?: number }} StreamEvent */

/** The events of a text/event-stream body. @param {string} text @returns {StreamEvent[]} */
export function parseEvents(text) {
  /** @type {StreamEvent[]} */
  const out = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\n+/)) {
    if (!block.trim()) continue;
    /** @type {StreamEvent} */
    const ev = { id: "", event: "message", data: "" };
    /** @type {string[]} */
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon >= 0 ? line.slice(0, colon) : line;
      const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, "") : "";
      if (field === "data") data.push(value);
      else if (field === "event") ev.event = value;
      else if (field === "id") ev.id = value;
      else if (field === "retry" && /^\d+$/.test(value)) ev.retry = Number(value);
    }
    ev.data = data.join("\n");
    if (data.length || ev.id) out.push(ev);
  }
  return out;
}

/** @param {Element} root @param {string} query */
export function mark(root, query) {
  const needle = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(/** @type {Text} */ (n));
  let count = 0;
  for (const node of nodes) {
    const text = node.data;
    const lower = text.toLowerCase();
    let at = lower.indexOf(needle);
    if (at < 0) continue;
    const frag = document.createDocumentFragment();
    let from = 0;
    while (at >= 0 && count < 5000) {
      frag.append(text.slice(from, at), h("mark.as-hit", null, text.slice(at, at + query.length)));
      count++;
      from = at + query.length;
      at = lower.indexOf(needle, from);
    }
    frag.append(text.slice(from));
    node.replaceWith(frag);
  }
  return count;
}
