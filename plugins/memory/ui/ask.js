// The person's yes or no, in the page's <desk-dialog id="ask-dialog">: a plugin's page is sandboxed
// with scripts only, so window.confirm is never shown and always answers no. One question at a time;
// Cancel, Escape and a second question are no. The dialog opens with the focus on Cancel.

/** @typedef {{ title: string, text: string, yes: string }} Question */

/** @param {Document} doc @returns {(question: Question) => Promise<boolean>} */
export function createAsk(doc) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const dialog = pick("ask-dialog");
  /** @type {((said: boolean) => void) | undefined} */
  let answer;

  const done = (/** @type {boolean} */ said) => {
    const reply = answer;
    answer = undefined;
    dialog.removeAttribute("open");
    reply?.(said);
  };
  pick("ask-yes").addEventListener("click", () => done(true));
  pick("ask-no").addEventListener("click", () => done(false));
  dialog.addEventListener("cancel", () => done(false));
  dialog.addEventListener("close", () => {
    if (answer) done(false);
  });

  return (question) => {
    answer?.(false);
    pick("ask-title").textContent = question.title;
    pick("ask-text").textContent = question.text;
    pick("ask-yes").textContent = question.yes;
    dialog.setAttribute("label", question.title);
    return new Promise((resolve) => {
      answer = resolve;
      dialog.setAttribute("open", "");
    });
  };
}
