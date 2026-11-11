// Where the plugin's page stands. It is a hidden overlay (the manifest's only surface), never a
// window, so no window close ends the prompter: a card brings it in front of everything with the
// keys, and when no card is left it goes again, unless the person had opened the list (the desk
// showed the page with no card for it: Permissions from the palette).

/**
 * @typedef {{ show(): void, hide(): void }} Surface
 * @typedef {{ sheet(open: boolean): void, status(text: string): void }} SheetView
 */

/**
 * @param {Surface} surface
 * @param {SheetView} view
 * @param {() => number} cards how many cards wait, the one on screen included
 */
export function createOverlay(surface, view, cards) {
  /** Whether the overlay is up, as far as this page knows. */
  let shown = false;
  /** Whether the person opened the list: it stays once the cards are answered. */
  let listOpen = false;

  /** Close the list; with no card left the overlay goes. */
  const close = () => {
    listOpen = false;
    view.sheet(false);
    if (cards() > 0) return;
    shown = false;
    surface.hide();
  };

  return {
    /** A card came: in front of everything, with the keys, every time one comes. */
    raise() {
      shown = true;
      surface.show();
    },
    /** No card is left: the overlay goes, unless the list is open. */
    lower() {
      if (listOpen || !shown) return;
      shown = false;
      surface.hide();
    },
    /**
     * The page was shown or focused; shown by the desk with no card, it shows the list, and shows
     * itself once more so that the keys come with it, as they come with a card.
     */
    opened() {
      if (shown) return;
      shown = true;
      if (cards() > 0) return;
      listOpen = true;
      view.status("");
      view.sheet(true);
      surface.show();
    },
    /** The desk hid the page: the next card shows it again. */
    hidden() {
      shown = false;
      listOpen = false;
      view.sheet(false);
    },
    close,
  };
}
