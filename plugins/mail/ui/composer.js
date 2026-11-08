// The composer: To, Cc, Bcc, Subject and the text, with Send and Discard. Fields report every
// change (the draft autosaves); problems before a send are listed in words above the fields.

/**
 * @typedef {import("./compose.js").Draft} Draft
 * @typedef {{ edit(fields: Record<string, string>): unknown, send(): unknown, discard(): unknown, close(): unknown }} Actions
 */

/**
 * @param {Document} doc
 * @param {HTMLElement} root
 * @param {Actions} actions
 */
export function createComposer(doc, root, actions) {
  const field = (/** @type {string} */ name) =>
    /** @type {HTMLInputElement | HTMLTextAreaElement} */ (root.querySelector(`[name=${name}]`));
  const fields = ["to", "cc", "bcc", "subject", "body"].map(field);
  const problems = /** @type {HTMLElement} */ (root.querySelector(".problems"));
  const heading = /** @type {HTMLElement} */ (root.querySelector("h2"));
  /** @type {string | undefined} */
  let shownId;

  for (const input of fields)
    input.addEventListener("input", () => actions.edit({ [input.name]: input.value }));
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    void actions.send();
  });
  /** @type {HTMLElement} */ (root.querySelector("[data-discard]")).addEventListener("click", () =>
    actions.discard(),
  );
  /** @type {HTMLElement} */ (root.querySelector("[data-close]")).addEventListener("click", () =>
    actions.close(),
  );
  root.addEventListener("keydown", (event) => {
    // Mod+Enter sends; Escape puts the composer away. Other chords reach the desk.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void actions.send();
    } else if (event.key === "Escape") {
      event.preventDefault();
      actions.close();
    }
  });

  return {
    focus: () => {
      const empty = fields.find((f) => f.name === "to" && f.value === "") ?? field("body");
      empty.focus();
    },

    /** @param {Draft | null} draft @param {string[]} items */
    show(draft, items) {
      root.hidden = draft === null;
      if (!draft) {
        shownId = undefined;
        return;
      }
      heading.textContent = draft.replyTo ? "Reply" : draft.calendar ? "Answer" : "New message";
      // Typing is not interrupted: only another draft replaces what the fields hold.
      if (shownId !== draft.id)
        for (const input of fields)
          input.value = /** @type {Record<string, string>} */ (draft)[input.name] ?? "";
      shownId = draft.id;
      problems.replaceChildren(
        ...items.map((text) => {
          const li = doc.createElement("li");
          li.textContent = text;
          return li;
        }),
      );
      problems.hidden = items.length === 0;
    },
  };
}
