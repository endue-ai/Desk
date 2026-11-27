/**
 * The person's own changes to this plugin's page (desk.customize, ADR 0398): a style sheet that
 * layers over the page's own, and a script the person approved, run once per page load after the
 * plugin mounted. The desk sends them after the init and again whenever they change.
 */

/** What the person changed on this plugin's page; an absent field means none. */
export interface CustomState {
  css?: string;
  js?: string;
}

/** The name the desk asks a page by for its outline (`desk:command`), never a plugin's own. */
export const OUTLINE = "desk.customize.outline";
/** The most an outline holds, in characters: enough to pick selectors, small enough for an agent. */
const OUTLINE_MAX = 12_000;

/** The element the person's style sheet lives in: one per page, after every sheet of the page's. */
export const CUSTOM_STYLE_ID = "desk-custom-style";

/** Applies the person's changes to one page: the style at once, the script once the plugin mounted. */
export function customApplier(win: Window, mounted: Promise<void>): (custom: CustomState) => void {
  // The script this page ran, if any: a different one needs a fresh page, never a second run.
  let ran: string | undefined;
  let latest: CustomState = {};
  return (custom) => {
    latest = custom;
    applyStyle(win.document, custom.css ?? "");
    const js = custom.js ?? "";
    if (ran !== undefined) {
      if (ran !== js) win.location.reload();
      return;
    }
    if (js === "") return;
    ran = js;
    void mounted.then(() => {
      // A change that came while the plugin mounted wins: reload for it rather than run this one.
      if ((latest.js ?? "") !== js) return win.location.reload();
      runScript(win.document, js);
    });
  };
}

function applyStyle(doc: Document, css: string): void {
  const existing = doc.getElementById(CUSTOM_STYLE_ID);
  if (css === "") {
    existing?.remove();
    return;
  }
  const style = existing ?? doc.createElement("style");
  style.id = CUSTOM_STYLE_ID;
  style.textContent = css;
  // Last in the head, so the person's rules win over the page's sheets of equal weight.
  (doc.head ?? doc.documentElement).append(style);
}

function runScript(doc: Document, js: string): void {
  const script = doc.createElement("script");
  script.dataset.deskCustom = "";
  // Its own scope, so the person's names never clash with the page's.
  script.textContent = `(() => {\n${js}\n})();`;
  (doc.head ?? doc.documentElement).append(script);
}

/**
 * The page's elements, one per line and indented by depth: tag, id, classes and role, cut at
 * OUTLINE_MAX. No text and no field values: what the page shows (mail, chats) never leaves it.
 * Scripts, styles and the person's own style are left out.
 */
export function pageOutline(doc: Document): string {
  const lines: string[] = [];
  let size = 0;
  const walk = (element: Element, depth: number): boolean => {
    const tag = element.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || element.id === CUSTOM_STYLE_ID) return true;
    const id = element.id ? `#${element.id}` : "";
    const classes = [...element.classList].map((name) => `.${name}`).join("");
    const role = element.getAttribute("role");
    const line = `${"  ".repeat(depth)}${tag}${id}${classes}${role ? ` [role=${role}]` : ""}`;
    size += line.length + 1;
    if (size > OUTLINE_MAX) {
      lines.push("…");
      return false;
    }
    lines.push(line);
    const children = element.shadowRoot ? [...element.shadowRoot.children] : [];
    for (const child of [...children, ...element.children])
      if (!walk(child, depth + 1)) return false;
    return true;
  };
  if (doc.body) walk(doc.body, 0);
  return lines.join("\n");
}
