// @vitest-environment jsdom
// Settings, endue account (ADR 0130): signed out it offers endue ID's sign-in and shows the code;
// signed in it shows the account's profile, language and time zone and notifications as endue keeps
// them, and every change goes to endue as account.settings.update. The stub answers as the core does.
import { BridgeClient, browserStub, type ErrorCode } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { type AccountStubOptions, accountStub } from "../bridge/account-stub";
import { mountAccount } from "./account";
import { mountAccountIdentity } from "./account-identity";

const NOW = new Date("2026-11-09T09:00:00Z");

function mount(options: AccountStubOptions = {}) {
  const account = accountStub((event) => stub.emit(event), options);
  const stub = browserStub(account.handlers);
  const bridge = new BridgeClient(stub);
  const panel = mountAccount({ bridge, language: "en", now: NOW });
  document.body.append(panel.el);
  const updates = () =>
    stub.calls
      .filter((c) => c.method === "account.settings.update")
      .map((c) => {
        const { scope: _, ...change } = c.params as unknown as Record<string, unknown>;
        return change;
      });
  return { account, stub, bridge, panel, updates };
}

const $ = <T extends HTMLElement>(el: HTMLElement, key: string) => {
  const found = el.querySelector<T>(`[data-key="${key}"]`);
  if (!found) throw new Error(`no ${key}`);
  return found;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
});

describe("Settings, endue account", () => {
  it("signed out, offers sign-in and fills in once the browser confirms the code", async () => {
    const { account, panel } = mount({ signedIn: false });
    await panel.ready;
    expect(panel.el.dataset.account).toBe("signed-out");
    expect(panel.el.textContent).toContain("Sign in with endue ID");
    $(panel.el, "account-sign-in").click();
    await panel.idle();
    expect($(panel.el, "account-code").textContent).toBe("WDJB-MJHT");
    expect(panel.el.textContent).toContain("auth.endue.ai/realms/endue/device");
    account.approve();
    await settle();
    await panel.idle();
    expect(panel.el.dataset.account).toBe("ready");
    expect($(panel.el, "account-shown-name").textContent).toBe("Ada Lovelace");
    panel.dispose();
  });

  it("shows the account as endue keeps it", async () => {
    const { panel } = mount();
    await panel.ready;
    expect(panel.el.dataset.account).toBe("ready");
    expect($(panel.el, "account-email").textContent).toBe("ada@example.com");
    expect($(panel.el, "account-id").textContent).toBe("usr_00000000-0000-4000-8000-000000000001");
    expect($(panel.el, "account-status").textContent).toBe("Active");
    expect($(panel.el, "account-joined").textContent).toBe("March 14, 2026");
    const language = $<HTMLSelectElement>(panel.el, "account-language");
    expect(language.value).toBe("en-US");
    expect([...language.options].map((o) => o.value)).toEqual(["en-US", "ja-JP", "de-DE", "fr-FR"]);
    const zone = $<HTMLSelectElement>(panel.el, "account-time-zone");
    expect(zone.value).toBe("Asia/Seoul");
    expect(zone.selectedOptions[0]?.textContent).toBe("Asia/Seoul (UTC+9)");
    const switches = [...panel.el.querySelectorAll<HTMLInputElement>('[role="switch"]')].map(
      (s) => [s.getAttribute("aria-label"), s.checked],
    );
    expect(switches).toEqual([
      ["Agent Replies", true],
      ["Schedule Completed", false],
      ["Schedule Failed", true],
      ["Schedule Skipped", true],
      ["Agent Notices", true],
    ]);
    panel.dispose();
  });

  it("saves only the profile keys that changed, and the name reaches the header", async () => {
    const { panel, updates } = mount();
    await panel.ready;
    const save = $<HTMLButtonElement>(panel.el, "account-save");
    expect(save.disabled).toBe(true);
    const name = $<HTMLInputElement>(panel.el, "account-name");
    name.value = "  Ada King ";
    name.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    save.click();
    await settle();
    await panel.idle();
    expect(updates()).toEqual([{ displayName: "Ada King" }]);
    expect($(panel.el, "account-shown-name").textContent).toBe("Ada King");
    expect(panel.el.querySelector('[role="status"]')?.textContent).toBe(
      "Saved to your endue account.",
    );
    panel.dispose();
  });

  it("refuses a picture address that is not http or https before endue is asked", async () => {
    const { panel, updates } = mount();
    await panel.ready;
    const avatar = $<HTMLInputElement>(panel.el, "account-avatar");
    avatar.value = "file:///Users/ada/me.png";
    avatar.dispatchEvent(new Event("input"));
    $(panel.el, "account-save").click();
    await panel.idle();
    expect(panel.el.querySelector('[role="alert"]')?.textContent).toContain("http:// or https://");
    expect(updates()).toEqual([]);
    panel.dispose();
  });

  it("changes the language, the time zone and a notification on endue", async () => {
    const { panel, updates } = mount();
    await panel.ready;
    const language = $<HTMLSelectElement>(panel.el, "account-language");
    language.value = "ja-JP";
    language.dispatchEvent(new Event("change"));
    await panel.idle();
    const zone = $<HTMLSelectElement>(panel.el, "account-time-zone");
    zone.value = "Europe/London";
    zone.dispatchEvent(new Event("change"));
    await panel.idle();
    $(panel.el, "account-notify-routine-completed").click();
    await panel.idle();
    expect(updates()).toEqual([
      { language: "ja-JP" },
      { timeZone: "Europe/London" },
      { notifications: [{ kind: "routine-completed", inApp: true }] },
    ]);
    expect($<HTMLInputElement>(panel.el, "account-notify-routine-completed").checked).toBe(true);
    expect($<HTMLSelectElement>(panel.el, "account-language").value).toBe("ja-JP");
    panel.dispose();
  });

  it("puts a switch back and says why when endue refuses", async () => {
    const { account, panel } = mount();
    await panel.ready;
    account.failNext("offline" as ErrorCode, "endue AI could not be reached");
    $(panel.el, "account-notify-agent-notice").click();
    await panel.idle();
    // The switch shows what endue keeps again: still on.
    expect($<HTMLInputElement>(panel.el, "account-notify-agent-notice").checked).toBe(true);
    expect(panel.el.querySelector('[role="status"]')?.textContent).toBe(
      "Couldn't save: Desk could not reach endue. Check your connection and try again.",
    );
    panel.dispose();
  });

  it("names a part endue did not answer for and draws the rest", async () => {
    const { panel } = mount({ failing: { notifications: "offline" } });
    await panel.ready;
    const notifications = panel.el.querySelector('[data-account-group="notifications"]');
    expect(notifications?.textContent).toContain("endue did not answer for these settings.");
    expect(notifications?.querySelector('[role="switch"]')).toBeNull();
    expect($<HTMLSelectElement>(panel.el, "account-language").value).toBe("en-US");
    panel.dispose();
  });

  it("signs out and offers the sign-in again", async () => {
    const { panel } = mount();
    await panel.ready;
    $(panel.el, "account-sign-out").click();
    await panel.idle();
    expect(panel.el.dataset.account).toBe("signed-out");
    expect(panel.el.querySelector('[data-key="account-sign-in"]')).not.toBeNull();
    panel.dispose();
  });

  it("says so on a desk without an endue ID", async () => {
    const bridge = new BridgeClient(browserStub({}));
    const panel = mountAccount({ bridge, language: "en" });
    await panel.ready;
    expect(panel.el.dataset.account).toBe("unavailable");
    panel.dispose();
  });
});

describe("the settings sidebar's identity", () => {
  it("shows who is signed in and leads to the account's settings", async () => {
    const account = accountStub((event) => stub.emit(event));
    const stub = browserStub(account.handlers);
    let opened = 0;
    const identity = mountAccountIdentity(new BridgeClient(stub), "en", () => opened++);
    await identity.refresh();
    expect(identity.el.textContent).toBe("AAda Lovelaceada@example.com");
    $(identity.el, "settings-identity").click();
    expect(opened).toBe(1);
    await new BridgeClient(stub).call("account.signOut", {
      scope: { permission: "account:manage" },
    });
    await settle();
    expect(identity.el.textContent).toContain("Sign in with endue ID");
    identity.dispose();
  });

  it("stays the plain desk without an endue ID", async () => {
    const identity = mountAccountIdentity(new BridgeClient(browserStub({})), "en", () => {});
    await identity.refresh();
    expect(identity.el.textContent).toBe("endue DeskSettings for this device");
    identity.dispose();
  });
});
