// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { browserBridge, DEVICE_PAGE, sampleErrand } from "../bridge/browser";
import type { AccountStatus, BrainStep } from "../bridge/types";
import type { ShellCtx } from "../shell/context";
import { render } from "../shell/dom";
import { Store, sampleState } from "../shell/state";
import { mountEndueId, pageOf } from "./endue-id";

/** The endue ID rows over the browser stub's account, with the commands it defines. */
function setup(lang: "en" | "ko" = "en") {
  const bridge = browserBridge({ now: () => 0 });
  const signIn = vi.spyOn(bridge.account, "signIn");
  const commands = new Map<string, () => unknown>();
  const say = vi.fn();
  const ctx = {
    store: new Store(sampleState(lang, 0)),
    bridge,
    eris: { say, setState: vi.fn() },
    runtime: {
      commands: {
        define: (id: string, spec: { run: () => unknown }) => {
          commands.set(id, spec.run);
          return () => commands.delete(id);
        },
      },
    },
  } as unknown as ShellCtx;
  const el = document.createElement("div");
  const endue = mountEndueId(ctx, () => render(el, () => endue.rows()));
  const press = async (key: string) => {
    const button = el.querySelector<HTMLButtonElement>(`[data-key=${key}]`);
    if (!button) throw new Error(`no ${key} button in ${el.innerHTML}`);
    button.click();
    await vi.waitFor(() =>
      expect(signIn.mock.calls.length + say.mock.calls.length).toBeGreaterThan(0),
    );
  };
  const keys = () => [...el.querySelectorAll("button")].map((b) => b.dataset.key);
  return { bridge, commands, say, el, endue, signIn, press, keys };
}

const PROBLEM = "core sentence";

describe("the desk's endue ID (ADR 0089, ADR 0111)", () => {
  it("signs in: the code to confirm, said once, then the profile from endue", async () => {
    const { bridge, commands, say, el, endue, keys } = setup();
    await vi.waitFor(() => expect(el.textContent).toContain("Not signed in"));
    expect(keys()).toEqual(["account-sign-in", "account-create"]);
    expect(el.querySelector("[data-key=account-sign-in]")?.textContent).toBe(
      "Sign in with endue ID",
    );
    expect(el.querySelector("[data-key=account-create]")?.textContent).toBe("Create account");
    expect(endue.where()).toBe("On this device");

    await commands.get("desk.account.sign-in")?.();
    expect(say.mock.calls).toEqual([
      ["Confirm WDJB-MJHT in your browser. I opened the page for you."],
    ]);
    expect(el.querySelector("[data-key=account-code]")?.textContent).toBe("WDJB-MJHT");
    expect(el.textContent).toContain("Confirm this code on the endue ID page in your browser.");
    expect(el.textContent).toContain("auth.endue.ai/realms/endue/device");
    expect(el.textContent).toContain("Waiting for the browser");
    expect(keys()).toEqual(["account-open-again", "account-cancel"]);

    bridge.fake.approveSignIn();
    expect(say).toHaveBeenLastCalledWith("You're signed in. I'll think with endue from now on.");
    expect(endue.profile()).toEqual({ displayName: "Ada Lovelace", email: "ada@example.com" });
    expect(endue.where()).toBe("ada@example.com");
    expect(keys()).toEqual(["account-sign-out"]);

    await commands.get("desk.account.sign-out")?.();
    expect(el.textContent).toContain("Not signed in");
    expect(endue.profile()).toBeUndefined();
    expect(say).toHaveBeenCalledTimes(2);
    endue.dispose();
    expect(commands.size).toBe(0);
  });

  it("creates an account on the sign-up page and opens it again without a second line", async () => {
    const { say, el, signIn, press } = setup();
    await vi.waitFor(() => expect(el.textContent).toContain("Not signed in"));
    await press("account-create");
    await vi.waitFor(() => expect(el.querySelector(".account-code")).not.toBeNull());
    expect(signIn).toHaveBeenLastCalledWith("sign-up");
    expect(el.querySelector(".account-code")?.getAttribute("data-screen")).toBe("sign-up");
    expect(el.textContent).toContain("New to Endue? Create an account");

    el.querySelector<HTMLButtonElement>("[data-key=account-open-again]")?.click();
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(signIn).toHaveBeenLastCalledWith("sign-up");
    expect(say).toHaveBeenCalledTimes(1);
  });

  it("words every failure from its reason and offers to try again on the same page", async () => {
    const reasons: [NonNullable<AccountStatus["reason"]>, string][] = [
      ["offline", "Can't reach endue right now. Check your connection and try again."],
      ["denied", "The sign-in was turned down in the browser."],
      ["expired", "The sign-in code expired. Please sign in again."],
      ["slow-down", "Too many sign-in attempts. Wait a moment and try again."],
      ["unavailable", "Something went wrong while signing in. Please try again in a moment."],
      ["suspended", "This account is suspended. Write to team@endue.ai."],
      ["failed", "Sign-in failed. Please try again."],
    ];
    for (const [reason, line] of reasons) {
      const { bridge, commands, say, el, signIn, keys } = setup();
      await commands.get("desk.account.create")?.();
      bridge.fake.setAccount({ state: "signed-out", problem: PROBLEM, reason });
      expect(el.querySelector(".account-problem")?.textContent).toBe(line);
      expect(el.querySelector(".account-problem")?.getAttribute("role")).toBe("status");
      expect(say).toHaveBeenLastCalledWith(line);
      expect(keys()).toEqual(["account-retry", "account-sign-in"]);
      el.querySelector<HTMLButtonElement>("[data-key=account-retry]")?.click();
      await vi.waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
      expect(signIn).toHaveBeenLastCalledWith("sign-up");
    }
  });

  it("keeps waiting through notices, keeps a rejected session, and asks again when it ended", async () => {
    const { bridge, commands, say, el, keys } = setup("ko");
    await commands.get("desk.account.sign-in")?.();
    const signIn = (await bridge.account.status()).signIn;
    bridge.fake.setAccount({ state: "signing-in", signIn, problem: PROBLEM, reason: "slow-down" });
    expect(el.querySelector(".account-problem.is-notice")?.textContent).toBe(
      "endue 가 조금 천천히 확인해 달래요. 계속 기다리는 중이에요.",
    );
    bridge.fake.setAccount({ state: "signing-in", signIn, problem: PROBLEM, reason: "offline" });
    expect(el.textContent).toContain("코드는 아직 유효해요");
    expect(keys()).toEqual(["account-open-again", "account-cancel"]);
    expect(say).toHaveBeenCalledTimes(1);

    bridge.fake.approveSignIn();
    bridge.fake.setAccount({ state: "signed-in", problem: PROBLEM, reason: "rejected" });
    expect(el.querySelector(".account-problem.is-notice")?.textContent).toContain(
      "세션 연장을 거절했어요",
    );
    expect(keys()).toEqual(["account-sign-out"]);

    bridge.fake.setAccount({ state: "signed-out", problem: PROBLEM, reason: "session-expired" });
    expect(say).toHaveBeenLastCalledWith("다시 로그인이 필요해요.");
    expect(keys()).toEqual(["account-sign-in", "account-create"]);
    expect(el.querySelector("[data-key=account-create]")?.textContent).toBe("회원가입");
  });

  it("reads the page from the address people type", () => {
    const signIn = { userCode: "A", verificationUri: `${DEVICE_PAGE}/` };
    expect(pageOf({ state: "signing-in", signIn })).toBe("auth.endue.ai/realms/endue/device");
  });
});

describe("the browser stub's errands", () => {
  it("sends a line about mail to the mail plugin and answers when it is back", async () => {
    const bridge = browserBridge({ now: () => 0 });
    const steps: BrainStep[] = [];
    const reply = await bridge.brain.say("Check my latest mail", (step) => steps.push(step));
    expect(steps.map((s) => `${s.kind}:${s.provider}:${s.command}`)).toEqual([
      "tool:endue.mail:endue.mail.latest",
      "tool-result:endue.mail:endue.mail.latest",
    ]);
    expect(reply.text).toBe("You have 2 new messages. The newest is from Mina: Lunch today?");
    expect(sampleErrand("최신 메일 확인해 줘")).toBeDefined();
    expect(sampleErrand("hello there")).toBeUndefined();
    const plain = await bridge.brain.say("hello there", (step) => steps.push(step));
    expect(plain.text).toBe('I\'ll look into "hello there" and tell you.');
    expect(steps).toHaveLength(2);
  });
});
