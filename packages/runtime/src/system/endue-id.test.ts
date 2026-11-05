// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { browserBridge, sampleErrand } from "../bridge/browser";
import type { BrainStep } from "../bridge/types";
import type { ShellCtx } from "../shell/context";
import { render } from "../shell/dom";
import { Store, sampleState } from "../shell/state";
import { mountEndueId, pageOf } from "./endue-id";

/** The endue ID rows over the browser stub's account, with the commands it defines. */
function setup() {
  const bridge = browserBridge({ now: () => 0 });
  const commands = new Map<string, () => unknown>();
  const say = vi.fn();
  const ctx = {
    store: new Store(sampleState("en", 0)),
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
  return { bridge, commands, say, el, endue };
}

describe("the desk's endue ID (ADR 0089)", () => {
  it("signs in from a command: the code to enter, said once, then the line when it is done", async () => {
    const { bridge, commands, say, el, endue } = setup();
    await vi.waitFor(() => expect(el.textContent).toContain("Not signed in"));
    expect(el.querySelector("[data-key=account-sign-in]")?.textContent).toBe(
      "Sign in with endue ID",
    );
    expect(endue.where()).toBe("On this device");

    await commands.get("desk.account.sign-in")?.();
    const code = "Enter WDJB-MJHT at id.endue.ai/device. I opened the page for you.";
    expect(say.mock.calls).toEqual([[code]]);
    expect(el.querySelector(".account-code")?.textContent).toBe(code);
    expect(el.textContent).toContain("Waiting for the browser");

    bridge.fake.approveSignIn();
    expect(say).toHaveBeenLastCalledWith("You're signed in. I'll think with endue from now on.");
    expect(el.querySelector("[data-key=account-sign-out]")?.textContent).toBe("Sign out");
    expect(endue.where()).toBe("Signed in with endue ID");

    await commands.get("desk.account.sign-out")?.();
    expect(el.textContent).toContain("Not signed in");
    expect(say).toHaveBeenCalledTimes(2);
    endue.dispose();
    expect(commands.size).toBe(0);
  });

  it("reads the page from the address people type", () => {
    const signIn = { userCode: "A", verificationUri: "https://id.endue.ai/device/" };
    expect(pageOf({ state: "signing-in", signIn })).toBe("id.endue.ai/device");
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
