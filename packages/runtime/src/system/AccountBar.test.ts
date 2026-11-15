// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserBridge } from "../bridge/browser";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { mountAccountBar } from "./AccountBar";

/** Settings' key, as the keymap would say it on a Mac. */
const SETTINGS_KEY = "⌘,";

/** The bottom-left controls over the browser stub, with a command registry that runs what it holds. */
function setup(name = "Mira") {
  const bridge = browserBridge({ now: () => 0 });
  bridge.user = { info: async () => ({ name }) };
  const commands = new Map<string, (args?: unknown) => unknown>();
  const store = new Store(sampleState("en", 0));
  const ctx = {
    store,
    bridge,
    tr: (key: string) => key,
    keyOf: (command: string) => (command === "desk.settings.open" ? SETTINGS_KEY : undefined),
    eris: { say: vi.fn(), setState: vi.fn() },
    runtime: {
      commands: {
        define: (id: string, spec: { run: (args?: unknown) => unknown }) => {
          commands.set(id, spec.run);
          return () => commands.delete(id);
        },
        run: async (id: string, args?: unknown) => commands.get(id)?.(args),
      },
    },
  } as unknown as ShellCtx;
  // In the document: the focus is a document's.
  const root = document.createElement("div");
  document.body.append(root);
  const unmount = mountAccountBar(root, ctx);
  const profile = () => root.querySelector<HTMLElement>(".account-profile");
  const popover = () => root.querySelector<HTMLElement>(".account-popover");
  const row = (key: string) =>
    root.querySelector<HTMLElement>(`.account-popover [role="menuitem"][data-key="${key}"]`);
  /** The avatar's menu, open and drawn with the person's name. */
  const open = async () => {
    await commands.get("desk.account.open")?.();
    await vi.waitFor(() => expect(popover()?.textContent).toContain(name || "Local user"));
  };
  return { bridge, commands, store, root, unmount, profile, popover, row, open };
}

/** A key pressed where the focus is. */
const press = (key: string) =>
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );

/** The `data-key` of what has the focus. */
const focused = () => (document.activeElement as HTMLElement | null)?.dataset.key;

afterEach(() => document.body.replaceChildren());

describe("the person's controls (ADR 0111)", () => {
  it("holds the launcher and the person's avatar, top to bottom, and nothing else (ADR 0217)", async () => {
    const { commands, root, unmount } = setup();
    const ran: string[] = [];
    commands.set("endue.launcher.open", () => void ran.push("open"));
    const buttons = [...root.querySelectorAll<HTMLElement>(".account-bar button")];
    expect(buttons.map((b) => b.dataset.key)).toEqual(["launcher", "account-profile"]);
    const gone = ".inbox-button, .account-settings-button, .badge";
    expect(root.querySelector(".account-bar")?.querySelectorAll(gone)).toHaveLength(0);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Open a plugin");
    buttons[0]?.click();
    await vi.waitFor(() => expect(ran).toEqual(["open"]));
    unmount();
  });

  it("the avatar shows a dot while the inbox holds something, and its name says how many", () => {
    const { store, profile, unmount } = setup();
    // The sample desk's two items.
    expect(profile()?.dataset.attention).toBe("2");
    expect(profile()?.getAttribute("aria-label")).toBe("User information · Inbox · 2");
    // The dot is the avatar's own (CSS ::after): no element is added for it.
    expect([...(profile()?.children ?? [])].map((el) => el.className)).toEqual(["account-avatar"]);

    store.set({ attention: [] });
    expect(profile()?.hasAttribute("data-attention")).toBe(false);
    expect(profile()?.getAttribute("aria-label")).toBe("User information");
    expect([...(profile()?.children ?? [])].map((el) => el.className)).toEqual(["account-avatar"]);
    unmount();
  });

  it("the avatar's menu starts with Inbox and Settings, then what the account popover held", async () => {
    const { popover, profile, open, unmount } = setup();
    expect(profile()?.getAttribute("aria-expanded")).toBe("false");
    await open();
    expect(profile()?.getAttribute("aria-expanded")).toBe("true");
    const dialog = popover();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("User information");
    expect(dialog?.dataset.popover).toBe("account");

    const [menu, rule, ...held] = [...(dialog?.children ?? [])] as HTMLElement[];
    expect(menu?.getAttribute("role")).toBe("menu");
    const rows = [...(menu?.children ?? [])] as HTMLElement[];
    expect(rows.map((r) => [r.getAttribute("role"), r.dataset.key])).toEqual([
      ["menuitem", "account-inbox"],
      ["menuitem", "account-settings"],
    ]);
    // Inbox with its count, Settings with its key.
    expect(rows.map((r) => r.textContent)).toEqual(["Inbox2", `Open settings${SETTINGS_KEY}`]);
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Inbox · 2", "Open settings"]);
    expect(rule?.getAttribute("role")).toBe("separator");

    // Then the person, endue ID with its buttons, the profile and the space, as before.
    const what = (el: HTMLElement) =>
      el.matches(".account-identity")
        ? "identity"
        : el.matches("[data-account]")
          ? "endue ID"
          : el.matches(".account-actions")
            ? "actions"
            : (el.firstChild?.textContent ?? "");
    expect(held.map(what)).toEqual(["identity", "endue ID", "actions", "Profile", "Space"]);
    unmount();
  });

  it("choosing Inbox shows the inbox's list where the menu was", async () => {
    const { commands, store, popover, profile, row, open, unmount } = setup();
    const ran: string[] = [];
    commands.set("test.update.restart", () => void ran.push("restart"));
    store.set({
      attention: [
        { id: "a-pay", text: "Approve the invoice from Studio" },
        {
          id: "update",
          text: "Update is ready",
          action: { label: "Restart", command: "test.update.restart" },
        },
      ],
    });
    await open();
    row("account-inbox")?.click();
    await vi.waitFor(() => expect(store.get().popover).toBe("attention"));
    expect(popover()?.getAttribute("role")).toBe("dialog");
    expect(popover()?.getAttribute("aria-label")).toBe("Inbox");
    expect(popover()?.dataset.popover).toBe("attention");
    expect(profile()?.getAttribute("aria-expanded")).toBe("true");

    // One row per item: its text, and its button when it has something to do.
    const items = [...(popover()?.querySelectorAll<HTMLElement>(".inbox-item") ?? [])];
    expect(items.map((item) => item.querySelector(".pop-row")?.textContent)).toEqual([
      "Approve the invoice from Studio",
      "Update is ready",
    ]);
    expect(items.map((item) => item.querySelector("button")?.dataset.key)).toEqual([
      undefined,
      "attention-update",
    ]);
    expect(items[1]?.querySelector("button")?.textContent).toBe("Restart");
    items[1]?.querySelector("button")?.click();
    await vi.waitFor(() => expect(ran).toEqual(["restart"]));

    // With nothing in it, the list says so (the stub's copy answers its key).
    store.set({ attention: [] });
    expect(popover()?.querySelectorAll(".inbox-item")).toHaveLength(0);
    expect(popover()?.querySelector(".account-empty")?.textContent).toBe("empty");
    expect(profile()?.getAttribute("aria-expanded")).toBe("true");
    unmount();
  });

  it("choosing Settings runs desk.settings.open, closes the menu and leaves the focus on the avatar", async () => {
    const { commands, store, profile, row, open, unmount } = setup();
    let ran = 0;
    commands.set("desk.settings.open", () => void ran++);
    await open();
    row("account-settings")?.click();
    await vi.waitFor(() => expect(ran).toBe(1));
    expect(store.get().popover).toBeNull();
    expect(profile()).not.toBeNull();
    expect(document.activeElement).toBe(profile());
    expect(profile()?.getAttribute("aria-expanded")).toBe("false");
    unmount();
  });

  it("the menu works by the keyboard", async () => {
    const { store, profile, row, open, unmount } = setup();
    await open();
    // Opened, the Inbox row has the focus; the arrows walk the rows, then endue ID's buttons.
    expect(focused()).toBe("account-inbox");
    const walk = (key: string, times: number) =>
      Array.from({ length: times }, () => {
        press(key);
        return focused();
      });
    expect(walk("ArrowDown", 4)).toEqual([
      "account-settings",
      "account-sign-in",
      "account-create",
      "account-inbox",
    ]);
    expect(walk("ArrowUp", 2)).toEqual(["account-create", "account-sign-in"]);
    expect(walk("Home", 1)).toEqual(["account-inbox"]);
    expect(walk("End", 1)).toEqual(["account-create"]);

    // Escape closes the menu and gives the focus back to the avatar.
    press("Escape");
    expect(store.get().popover).toBeNull();
    expect(profile()).not.toBeNull();
    expect(document.activeElement).toBe(profile());

    // From the inbox's list too.
    await open();
    row("account-inbox")?.click();
    await vi.waitFor(() => expect(store.get().popover).toBe("attention"));
    press("Escape");
    expect(store.get().popover).toBeNull();
    expect(document.activeElement).toBe(profile());
    unmount();
  });

  it("shows the endue profile once signed in: name, email and picture", async () => {
    const { bridge, commands, profile, popover, unmount } = setup();
    await commands.get("desk.account.open")?.();
    await vi.waitFor(() => expect(popover()?.textContent).toContain("Mira"));
    expect(popover()?.textContent).toContain("On this device");
    expect(profile()?.querySelector(".account-avatar")?.textContent).toBe("M");

    await commands.get("desk.account.sign-in")?.();
    bridge.fake.approveSignIn();
    const identity = popover()?.querySelector(".account-identity");
    expect(identity?.querySelector("strong")?.textContent).toBe("Ada Lovelace");
    expect(identity?.querySelector("small")?.textContent).toBe("ada@example.com");
    expect(profile()?.querySelector(".account-avatar")?.textContent).toBe("A");
    expect(profile()?.getAttribute("title")).toBe("User information · Ada Lovelace");

    const picture = "data:image/png;base64,iVBORw0KGgo=";
    bridge.fake.setAccount({
      state: "signed-in",
      profile: { displayName: "Ada Lovelace", email: "ada@example.com", avatarUrl: picture },
    });
    const img = profile()?.querySelector<HTMLImageElement>("img.account-picture");
    expect(img?.getAttribute("src")).toBe(picture);
    expect(img?.getAttribute("alt")).toBe("");

    // A picture that is not a data: URL is never loaded: the webview takes no remote images.
    bridge.fake.setAccount({
      state: "signed-in",
      profile: { displayName: "Ada Lovelace", avatarUrl: "https://example.com/ada.png" },
    });
    expect(profile()?.querySelector("img")).toBeNull();
    expect(profile()?.querySelector(".account-avatar")?.textContent).toBe("A");

    // Signed out, the first-run name stands for the person again.
    popover()?.querySelector<HTMLButtonElement>("[data-key=account-sign-out]")?.click();
    await vi.waitFor(() => expect(popover()?.textContent).toContain("Not signed in"));
    expect(popover()?.querySelector(".account-identity strong")?.textContent).toBe("Mira");
    unmount();
  });

  it("offers Sign in and Create account under the local user", async () => {
    const { commands, popover, unmount } = setup("");
    await commands.get("desk.account.open")?.();
    await vi.waitFor(() => expect(popover()?.textContent).toContain("Local user"));
    const buttons = [...(popover()?.querySelectorAll(".account-actions button") ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(["Sign in with endue ID", "Create account"]);
    expect(buttons.every((b) => b.getAttribute("type") === "button")).toBe(true);
    unmount();
  });
});
