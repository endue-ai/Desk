// Compare's chooser: the other open images and the folder's, in a list beside the Compare button.
// Compare opens it with the focus in the list; Compare again, or Escape in the list or on the image,
// puts it away and ends a comparison, and the keys go back to the image (#162, draft 08 #18).

/**
 * @typedef {import("./images.js").ImagesState} ImagesState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/**
 * @param {Document} doc
 * @param {{ act: Act, comparing(): boolean, stage: HTMLElement }} parts
 */
export function createChooser(doc, { act, comparing, stage }) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const button = byId("compare");
  const picker = byId("compare-pick");
  const pick = /** @type {HTMLSelectElement} */ (byId("compare-with"));
  const expanded = (/** @type {boolean} */ open) => {
    picker.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };

  /** Put the chooser away and end a comparison; the image takes the keys again. */
  const leave = () => {
    expanded(false);
    act("compare", null);
    stage.focus();
  };
  button.addEventListener("click", () => {
    if (comparing() || !picker.hidden) return leave();
    expanded(true);
    pick.focus();
  });
  pick.addEventListener("change", () => act("compare", pick.value || null));
  // This build draws no list for a select field (#156): Escape in it is the way out it always has.
  pick.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    leave();
  });

  return {
    leave,
    /** Whether there is a chooser or a comparison to put away. */
    shown: () => comparing() || !picker.hidden,
    /** The choices, the image chosen, and no chooser while no image is open. */
    offer(/** @type {ImagesState} */ state) {
      if (!comparing() && !state.image) expanded(false);
      const first = /** @type {HTMLOptionElement} */ (pick.options[0]);
      pick.replaceChildren(
        first,
        ...state.choices.map(({ path: value, name }) => {
          const option = doc.createElement("option");
          option.value = value;
          option.textContent = name;
          return option;
        }),
      );
      pick.value = state.partner?.path ?? "";
    },
  };
}
