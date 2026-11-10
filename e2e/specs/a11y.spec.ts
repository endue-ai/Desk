// The desk's one accessibility tree (#57): the desk runs in compositor mode with the accessibility
// fixture (e2e/fixtures/plugin-e2e-a11y), and a spec starts the desk's accessibility as a screen
// reader would (`compositor_a11y { activate }`: the screen may be locked and none runs), then walks
// the tree the platform adapter has, as a screen reader walks it: the window list, the plugin's
// window with its title bar and the plugin's own content inside it, each box in the window's
// pixels. A screen reader's click reaches the plugin's button, its focus the field (the keys follow,
// and so does the tree's focus), and a value it sets is typed into the field. A keyboard reaches the
// plugin's content from its window as through a frame (#123): Control+Tab brings the window forward,
// Tab enters the plugin at its first control and Shift+Tab at its last, and each leaves it at its end.
import { browser, expect } from "@wdio/globals";
import { feed, inputState, inSurface, keyPress, shellCommand } from "../support/compositor";
import { focusedSurface, shellReady } from "../support/desk";

const A11Y = "main.e2e-a11y";

interface Node {
  role: string;
  label: string | null;
  value: string | null;
  bounds: [number, number, number, number] | null;
  children: Node[];
}

interface Tree {
  active: boolean;
  focus: { role: string; label: string | null } | null;
  tree: Node | null;
}

const a11y = (args: Record<string, unknown> = {}) => shellCommand<Tree>("compositor_a11y", args);

/** The first node with `role` and `label` (a label's words are its value), depth first. */
function find(node: Node | null | undefined, role: string, label: string): Node | undefined {
  if (!node) return undefined;
  if (node.role === role && (node.label ?? node.value) === label) return node;
  for (const child of node.children) {
    const found = find(child, role, label);
    if (found) return found;
  }
  return undefined;
}

const inside = (inner: Node["bounds"], outer: Node["bounds"]) =>
  !!inner &&
  !!outer &&
  inner[0] >= outer[0] - 0.5 &&
  inner[1] >= outer[1] - 0.5 &&
  inner[0] + inner[2] <= outer[0] + outer[2] + 0.5 &&
  inner[1] + inner[3] <= outer[1] + outer[3] + 0.5;

const seen = () =>
  inSurface<{ clicks: number; value: string; focused: boolean }>(A11Y, "window.e2eA11y");

/** A press of Tab through the compositor, with these modifiers held. */
const tab = (mods: Record<string, boolean> = {}) =>
  feed([{ type: "modifiers", ...mods }, ...keyPress("Tab", "Tab", "\t"), { type: "modifiers" }]);

/** What has the keyboard in the plugin's own page: the active element's tag and type. */
const inPlugin = () =>
  inSurface<string>(
    A11Y,
    "document.hasFocus() ? `${document.activeElement?.tagName}:${document.activeElement?.type ?? ''}` : 'none'",
  );

/** The page's focus is in the desk's own chrome, not in a plugin's stand-in frame. */
const inChrome = () =>
  browser.execute(() => !!document.activeElement && document.activeElement.tagName !== "IFRAME");

describe("a11y: the desk is one accessibility tree a screen reader walks and acts through", () => {
  let tree: Tree;

  before(async () => {
    await shellReady();
    await browser.waitUntil(
      async () =>
        (await inSurface<string>(
          A11Y,
          "document.querySelector('[data-testid=ready]').textContent",
        )) === "ready",
      { timeout: 20_000, timeoutMsg: "the accessibility plugin never mounted" },
    );
    await feed([{ type: "windowFocused", focused: true }]);
    await browser.waitUntil(
      async () => {
        tree = await a11y({ activate: true });
        return !!find(tree.tree, "button", "Add");
      },
      { timeout: 20_000, timeoutMsg: "the plugin's tree never reached the desk's" },
    );
  });

  it("reads the window list, the plugin's window with its title bar, and the plugin's content", async () => {
    const root = tree.tree;
    expect(tree.active).toBe(true);
    expect(root?.role).toBe("window");
    expect(root?.label).toBe("endue Desk");
    const windows = root?.children.find((c) => c.role === "list" && c.label === "Windows");
    expect(windows).toBeDefined();
    const window = windows?.children.find((w) => w.label === "E2E A11y");
    expect(window?.role).toBe("window");
    expect(window?.children[0]).toMatchObject({ role: "title-bar", label: "E2E A11y" });
    const content = find(window, "root-web-area", "E2E A11y");
    expect(content).toBeDefined();
    expect(find(content, "heading", "Checklist")).toBeDefined();
    expect(find(content, "text-input", "New item")).toBeDefined();
    expect(find(content, "check-box", "Milk")).toBeDefined();
    // The desk's own page (its bars and menus) is in the tree too.
    expect(root?.children.find((c) => c.role === "group" && c.label === "Desk")).toBeDefined();
  });

  it("puts each box of the plugin's in the window's pixels, inside its window", async () => {
    const window = find(tree.tree, "window", "E2E A11y");
    const content = find(window, "root-web-area", "E2E A11y");
    const add = find(content, "button", "Add");
    const field = find(content, "text-input", "New item");
    expect(inside(add?.bounds ?? null, window?.bounds ?? null)).toBe(true);
    expect(inside(add?.bounds ?? null, content?.bounds ?? null)).toBe(true);
    // The page lays the button 184 px right of the field's left edge, 80 by 28.
    const [ax = 0, ay = 0, aw = 0, ah = 0] = add?.bounds ?? [];
    const [fx = 0, fy = 0] = field?.bounds ?? [];
    expect(Math.round(ax - fx)).toBe(184);
    expect(Math.round(ay - fy)).toBe(0);
    expect([Math.round(aw), Math.round(ah)]).toEqual([80, 28]);
  });

  it("a click on the button reaches the plugin", async () => {
    await a11y({ act: { role: "button", label: "Add", action: "click" } });
    await browser.waitUntil(async () => (await seen()).clicks === 1, {
      timeoutMsg: "the button never heard the click",
    });
  });

  it("the focus to the field gives it the keys, and the tree's focus follows", async () => {
    await a11y({ act: { role: "text-input", label: "New item", action: "focus" } });
    await browser.waitUntil(async () => (await seen()).focused, {
      timeoutMsg: "the field never had the focus",
    });
    await browser.waitUntil(async () => (await inputState()).focused === A11Y, {
      timeoutMsg: "the plugin's surface never had the keys",
    });
    await browser.waitUntil(async () => (await a11y()).focus?.label === "New item", {
      timeoutMsg: "the tree's focus never moved to the field",
    });
  });

  it("a value set on the field is typed into it", async () => {
    await a11y({
      act: { role: "text-input", label: "New item", action: "set-value", value: "Buy milk" },
    });
    await browser.waitUntil(async () => (await seen()).value === "Buy milk", {
      timeoutMsg: "the value never reached the field",
    });
    await browser.waitUntil(
      async () => find((await a11y()).tree, "text-input", "New item")?.value === "Buy milk",
      { timeoutMsg: "the tree never showed the value" },
    );
  });

  it("Control+Tab to the plugin's window, Tab types into its field, Shift+Tab leaves it", async () => {
    // Round the windows with the desk's focus cycling until the plugin's window has the focus again.
    for (let presses = 0; presses < 40; presses++) {
      const before = await focusedSurface();
      await tab({ ctrl: true });
      // Each press moves the focus on before the next is pressed.
      await browser
        .waitUntil(async () => (await focusedSurface()) !== before, { timeout: 5_000 })
        .catch(() => undefined);
      if ((await focusedSurface()) === "e2e.a11y" && (await inChrome())) break;
    }
    expect(await focusedSurface()).toBe("e2e.a11y");
    expect(await inChrome()).toBe(true);
    await browser.waitUntil(async () => (await inputState()).focused !== A11Y, {
      timeoutMsg: "the window's section has the page's focus, yet the plugin kept the keys",
    });

    // Tab: into the plugin, at its first control; the keys and the tree's focus follow.
    await tab();
    await browser.waitUntil(async () => (await seen()).focused, {
      timeoutMsg: "Tab never reached the plugin's field",
    });
    await browser.waitUntil(async () => (await inputState()).focused === A11Y, {
      timeoutMsg: "the plugin's surface never had the keys",
    });
    await browser.waitUntil(async () => (await a11y()).focus?.label === "New item", {
      timeoutMsg: "the tree's focus never moved to the field",
    });
    // Tab selected the field's text, as a Tab into a frame does: the keys replace it.
    await feed([...keyPress("o", "KeyO", "o"), ...keyPress("k", "KeyK", "k")]);
    await browser.waitUntil(async () => (await seen()).value === "ok", {
      timeoutMsg: "the keys never typed into the field",
    });

    // Shift+Tab at the plugin's first control: out of it, back to the window's chrome.
    await tab({ shift: true });
    await browser.waitUntil(async () => !(await seen()).focused, {
      timeoutMsg: "Shift+Tab never left the field",
    });
    await browser.waitUntil(async () => (await inputState()).focused !== A11Y, {
      timeoutMsg: "the plugin kept the keys",
    });
    await browser.waitUntil(inChrome, { timeoutMsg: "the page's focus stayed in the stand-in" });
    await browser.waitUntil(async () => (await a11y()).focus?.label !== "New item", {
      timeoutMsg: "the tree's focus stayed on the field",
    });
  });

  it("Tab past the plugin's last control leaves it, and Shift+Tab comes back to it", async () => {
    await tab();
    await browser.waitUntil(async () => (await seen()).focused, {
      timeoutMsg: "Tab never reached the plugin's field",
    });
    await tab();
    await browser.waitUntil(async () => (await inPlugin()) === "BUTTON:button", {
      timeoutMsg: "Tab never moved on to the button",
    });
    await tab();
    await browser.waitUntil(async () => (await inPlugin()) === "INPUT:checkbox", {
      timeoutMsg: "Tab never moved on to the checkbox",
    });
    // Past the checkbox: out of the plugin, on into the desk's chrome.
    await tab();
    await browser.waitUntil(async () => (await inputState()).focused !== A11Y, {
      timeoutMsg: "Tab past the last control kept the plugin's keys",
    });
    await browser.waitUntil(inChrome, { timeoutMsg: "the page's focus stayed in the stand-in" });
    // Shift+Tab from there: into the plugin again, at its last control.
    await tab({ shift: true });
    await browser.waitUntil(async () => (await inPlugin()) === "INPUT:checkbox", {
      timeoutMsg: "Shift+Tab never came back to the plugin's last control",
    });
    await browser.waitUntil(async () => (await inputState()).focused === A11Y, {
      timeoutMsg: "the plugin's surface never had the keys again",
    });
    await browser.waitUntil(async () => (await a11y()).focus?.label === "Milk", {
      timeoutMsg: "the tree's focus never moved to the checkbox",
    });
  });
});
