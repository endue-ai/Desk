// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { browserBridge } from "../bridge/browser";
import type { ShellCtx } from "../shell/context";
import { Store, sampleState } from "../shell/state";
import { mountAccountBar } from "./AccountBar";

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
  const root = document.createElement("div");
  const unmount = mountAccountBar(root, ctx);
  const profile = () => root.querySelector<HTMLElement>(".account-profile");
  const popover = () => root.querySelector<HTMLElement>(".account-popover");
  return { bridge, commands, root, unmount, profile, popover };
}

describe("the person's controls (ADR 0111)", () => {
  it("opens the launcher from its button, the first of the bar (ADR 0217)", async () => {
    const { commands, root, unmount } = setup();
    const ran: string[] = [];
    commands.set("endue.launcher.open", () => void ran.push("open"));
    const buttons = [...root.querySelectorAll<HTMLElement>(".account-bar button")];
    expect(buttons.map((b) => b.dataset.key)).toEqual([
      "launcher",
      "inbox",
      "account-settings",
      "account-profile",
    ]);
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Open a plugin");
    buttons[0]?.click();
    await vi.waitFor(() => expect(ran).toEqual(["open"]));
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
