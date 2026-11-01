// Pages where the document breaks them: every section starts a page (a continuous one does not),
// and every page break block starts the next. No line measuring: a page grows with its content.

/**
 * @typedef {import("../model.js").Section} Section
 * @typedef {{ section: Section, blocks: import("../model.js").Block[] }} Page
 */

/**
 * @param {import("../model.js").DocModel} model
 * @returns {Page[]}
 */
export function paginate(model) {
  /** @type {Page[]} */
  const pages = [];
  for (const section of model.sections) {
    let page = section.continuous ? pages.at(-1) : undefined;
    if (!page) {
      page = { section, blocks: [] };
      pages.push(page);
    }
    for (const block of section.blocks) {
      if (block.type === "pagebreak") {
        page = { section, blocks: [] };
        pages.push(page);
      } else page.blocks.push(block);
    }
  }
  // A break at the very end leaves no empty page behind it.
  if (pages.length > 1 && pages.at(-1)?.blocks.length === 0) pages.pop();
  return pages;
}
