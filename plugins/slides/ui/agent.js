// What an agent reads through Slides (ADR 0088): the deck on screen, or another one Slides has open,
// slide by slide: each one's title, the text of its shapes and tables in the order they are drawn,
// and its speaker notes. It leaves the screen as it is. Slides opens a file only through the desk
// (desk.files.open), so an agent opens one there first.

/**
 * @typedef {import("./deck.js").Element} Element
 * @typedef {import("./deck.js").TextBody} TextBody
 * @typedef {import("./deck.js").Slide} Slide
 * @typedef {{ buffer: string, path: string, name: string, opened: import("./open.js").Opened }} Open
 */

/** Slides one read answers by default and at most. */
export const SLIDES = { usual: 20, most: 200 };

/** A text body's lines, a bullet's text before an item. */
const bodyLines = (/** @type {TextBody} */ body) =>
  body.paragraphs
    .map((p) => {
      const text = p.runs.map((r) => (r.lineBreak ? "\n" : r.text)).join("");
      const lead = p.bullet ? `${"  ".repeat(p.level)}${p.bullet.text || "•"} ` : "";
      return text.trim() ? `${lead}${text}` : "";
    })
    .filter(Boolean);

/** The lines of a slide's elements, groups and tables included. @returns {string[]} */
export function elementLines(/** @type {Element[]} */ elements) {
  return elements.flatMap((e) => {
    if (e.type === "shape") return e.text ? bodyLines(e.text) : [];
    if (e.type === "group") return elementLines(e.children);
    if (e.type === "table")
      return e.rows.map(
        (row) => `| ${row.cells.map((c) => bodyLines(c.text).join(" ")).join(" | ")} |`,
      );
    if (e.type === "picture") return e.name ? [`[picture: ${e.name}]`] : [];
    return [];
  });
}

/** A slide as an agent reads it. */
export function slideAnswer(/** @type {Slide} */ slide) {
  return {
    number: slide.number,
    title: slide.title,
    hidden: slide.hidden,
    text: elementLines(slide.elements).join("\n"),
    notes: slide.notes,
  };
}

/**
 * @param {{ on(name: string, handler: (args: unknown) => unknown): unknown }} commands
 * @param {{ open(): Open[], shown(): string | null, view: import("./slides.js").View }} deps
 */
export function answerAgents(commands, deps) {
  commands.on("endue.slides.read", (raw) => {
    const a = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
    const open = deps.open();
    const decks = open.map((f) => ({
      path: f.path,
      name: f.name,
      onScreen: f.buffer === deps.shown(),
    }));
    const asked = typeof a.path === "string" && a.path !== "" ? a.path : undefined;
    const file = asked
      ? open.find((f) => f.path === asked || f.name === asked)
      : open.find((f) => f.buffer === deps.shown());
    if (!file) {
      if (asked)
        throw new Error(`Slides has no ${asked} open; open it with desk.files.open first.`);
      throw new Error("No deck is open in Slides; open one with desk.files.open first.");
    }
    const { opened } = file;
    if (opened.kind !== "deck")
      return {
        path: file.path,
        format: opened.format,
        decks,
        slides: null,
        reason: opened.kind === "details" ? opened.reason : opened.sentence,
      };
    const all = opened.deck.slides;
    const from = Number.isInteger(a.from) && Number(a.from) >= 1 ? Number(a.from) : 1;
    const asked_ = Number(a.count);
    const count =
      Number.isInteger(asked_) && asked_ > 0 ? Math.min(asked_, SLIDES.most) : SLIDES.usual;
    const slides = all.slice(from - 1, from - 1 + count).map(slideAnswer);
    const current = file.buffer === deps.shown() ? deps.view.slideOf?.(file.buffer) : undefined;
    return {
      path: file.path,
      format: opened.format,
      decks,
      total: all.length,
      ...(current === undefined ? {} : { slide: current + 1 }),
      slides,
      more: from - 1 + count < all.length,
    };
  });

  const currentDeck = () => {
    const file = deps.open().find((entry) => entry.buffer === deps.shown());
    if (file?.opened.kind !== "deck" || !file.opened.deck.slides.length)
      throw new Error("No deck is open in Slides.");
    return { file, length: file.opened.deck.slides.length };
  };
  const index = (/** @type {unknown} */ slide, /** @type {number} */ length) => {
    if (typeof slide !== "number" || !Number.isSafeInteger(slide) || slide < 1 || slide > length)
      throw new Error("That slide is outside the open deck.");
    return slide - 1;
  };
  const answer = (/** @type {Open} */ file) => ({
    path: file.path,
    slide: (deps.view.slideOf?.(file.buffer) ?? 0) + 1,
  });
  commands.on("endue.slides.show", (raw) => {
    const { file, length } = currentDeck();
    if (!deps.view.showSlide) throw new Error("Slides has no deck to move.");
    deps.view.showSlide(index(/** @type {{ slide: number }} */ (raw).slide, length));
    return answer(file);
  });
  commands.on("endue.slides.play", (raw) => {
    const { file, length } = currentDeck();
    if (!deps.view.play) throw new Error("Slides has no deck to play.");
    const from = /** @type {{ from?: number } | undefined} */ (raw)?.from;
    deps.view.play(
      from === undefined ? (deps.view.slideOf?.(file.buffer) ?? 0) : index(from, length),
    );
    return answer(file);
  });
  commands.on("endue.slides.stop", () => {
    const { file } = currentDeck();
    deps.view.stop?.();
    return answer(file);
  });
}
