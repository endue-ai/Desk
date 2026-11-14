// Each window's own page reports its section against itself during the sway (#270): through
// DevTools, every `desk-window:` page gets a watch that notes, at each frame where the page's size
// or its section's changed, both as that frame lays them out (a resize of the page is heard before
// its frame's layout, a resize of the section after it, `ResizeObserver`), and the notes are read
// back once the sway is over. Nothing asks for a frame: a page that paints nothing notes nothing.
// What the notes say is `lib/motion-sections.ts`.
import type { SectionSample } from "../lib/motion-sections.ts";
import { session, type Target, targets } from "./devtools.ts";

const PAGE = "desk-window:";

const WATCH = `(() => {
  const section = document.querySelector("section.surface");
  if (!section) return false;
  globalThis.__deskSectionsStop?.();
  const notes = (globalThis.__deskSections = []);
  const t0 = performance.now();
  const note = () => {
    const now = document.querySelector("section.surface");
    if (!now) return;
    const r = now.getBoundingClientRect();
    const t = Math.round(performance.now() - t0);
    notes.push([t, innerWidth, innerHeight, r.x, r.y, r.width, r.height]);
  };
  const watch = new ResizeObserver(note);
  watch.observe(section);
  addEventListener("resize", note);
  globalThis.__deskSectionsStop = () => {
    watch.disconnect();
    removeEventListener("resize", note);
  };
  return true;
})()`;

const READ = `(() => {
  globalThis.__deskSectionsStop?.();
  return JSON.stringify(globalThis.__deskSections ?? null);
})()`;

const pages = async (port: number) =>
  (await targets(port)).filter((t) => t.type === "page" && t.title.startsWith(PAGE));

async function run<T>(target: Target, expression: string): Promise<T | undefined> {
  try {
    const page = await session(target);
    try {
      return await page.evaluate<T>(expression);
    } finally {
      page.close();
    }
  } catch {
    // A page that went (its window's page replaced) says nothing.
    return undefined;
  }
}

/** Watch every window page's section; the windows watched. */
export async function watchSections(port: number): Promise<string[]> {
  const watched: string[] = [];
  for (const target of await pages(port)) {
    if (await run<boolean>(target, WATCH)) watched.push(target.title.slice(PAGE.length));
  }
  return watched;
}

/** What each window page noted since `watchSections`, by window; a page gone notes nothing. */
export async function readSections(port: number): Promise<Record<string, SectionSample[]>> {
  const out: Record<string, SectionSample[]> = {};
  for (const target of await pages(port)) {
    const notes = await run<string>(target, READ);
    const parsed = notes ? (JSON.parse(notes) as SectionSample[] | null) : null;
    if (parsed) out[target.title.slice(PAGE.length)] = parsed;
  }
  return out;
}
