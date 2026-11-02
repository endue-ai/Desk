import type { Page } from "@playwright/test";
import { renderTree as serialize } from "../src/inspect/tree";

/**
 * Serialise the desk as a render tree with the runtime's serializer (`src/inspect/tree.ts`, ADR 0011),
 * the one the inspector reads too. Everything it records is fixed by CSS and the injected clock, so the
 * tree is identical on every OS.
 */
export async function renderTree(page: Page): Promise<string> {
  const tree = await page.evaluate(serialize, "#desk");
  return `${JSON.stringify(tree, null, 2)}\n`;
}
