// Reasoning a model writes inline, between <think> and </think> (or <thinking>, <reasoning>) at the
// start of its answer, taken out of the answer so it shows folded. Servers that send reasoning in
// a field of its own (`reasoning_content`, Ollama's `thinking`) need none of this.

const OPEN = /^\s*<(think|thinking|reasoning)>/;

/**
 * Split an answer's text, as much of it as has arrived, into its reasoning and the rest.
 * `open` is true while the reasoning has started and not yet ended.
 * @param {string} text
 * @returns {{ reasoning: string, content: string, open: boolean }}
 */
export function splitThink(text) {
  const start = OPEN.exec(text);
  if (!start) {
    // A model whose template opened the tag itself sends only the closing one.
    const close = text.indexOf("</think>");
    if (close >= 0 && !text.slice(0, close).includes("<think>"))
      return {
        reasoning: text.slice(0, close).trim(),
        content: text.slice(close + 8).replace(/^\s+/, ""),
        open: false,
      };
    return { reasoning: "", content: text, open: false };
  }
  const tag = start[1];
  const body = text.slice(start[0].length);
  const end = body.indexOf(`</${tag}>`);
  if (end < 0) return { reasoning: body.replace(/^\s+/, ""), content: "", open: true };
  return {
    reasoning: body.slice(0, end).trim(),
    content: body.slice(end + tag.length + 3).replace(/^\s+/, ""),
    open: false,
  };
}

/** Whether a prefix of `text` could still turn into an opening tag. @param {string} text */
export function mayOpen(text) {
  const t = text.trimStart();
  return t.length < 12 && ["<think>", "<thinking>", "<reasoning>"].some((tag) => tag.startsWith(t));
}
