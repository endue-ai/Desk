// The person's yes or no, in the page's <desk-dialog id="ask-dialog">: the frame is sandboxed with
// scripts only, so window.confirm is not there. One question at a time; Escape or Cancel is no.

/**
 * @typedef {{ title: string, text: string, detail?: string, yes: string, danger?: boolean }} Question
 */

/** @param {Document} doc @returns {(question: Question) => Promise<boolean>} */
export function createAsk(doc) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const dialog = pick("ask-dialog");
  const yes = pick("ask-yes");
  /** @type {((answer: boolean) => void) | undefined} */
  let answer;

  const done = (/** @type {boolean} */ said) => {
    const reply = answer;
    answer = undefined;
    dialog.removeAttribute("open");
    reply?.(said);
  };
  yes.addEventListener("click", () => done(true));
  pick("ask-no").addEventListener("click", () => done(false));
  dialog.addEventListener("cancel", () => done(false));
  dialog.addEventListener("close", () => {
    if (answer) done(false);
  });

  return (question) => {
    answer?.(false);
    pick("ask-title").textContent = question.title;
    pick("ask-text").textContent = question.text;
    const detail = pick("ask-detail");
    detail.textContent = question.detail ?? "";
    detail.hidden = !question.detail;
    yes.textContent = question.yes;
    yes.className = `desk-btn ${question.danger ? "desk-btn-danger" : "desk-btn-primary"}`;
    dialog.setAttribute("label", question.title);
    return new Promise((resolve) => {
      answer = resolve;
      dialog.setAttribute("open", "");
    });
  };
}
