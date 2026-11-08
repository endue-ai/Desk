import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextScene, order } from "../ui/flow.js";
import { SAY } from "../ui/script.js";
import { ACCOUNT, ENTRY, failure, needsHelp, pageOf, step, WAITING } from "../ui/sign-in.js";

const page = "https://auth.endue.ai/realms/endue/device";
const signIn = (screen: string) => ({
  userCode: "WDJB-MJHT",
  verificationUri: page,
  verificationUriComplete: `${page}?user_code=WDJB-MJHT`,
  screen,
});

describe("scene 5: endue ID at auth.endue.ai (ADR 0111)", () => {
  it("offers Sign in, Create account and Skip in the endue.ai web's words", () => {
    expect([ENTRY.signIn, ENTRY.create, ENTRY.skip]).toEqual([
      "Sign in with endue ID",
      "Create account",
      "Skip for now",
    ]);
    expect(`${ENTRY.headline} ${ENTRY.accent}`).toBe("A little more you. A lot more possible.");
    expect(ENTRY.subtitle).toBe(
      "Meet your AI. Give it character, connect your tools, and make things happen.",
    );
    expect(ENTRY.note).toBe("Start free. No card required.");
    const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
    expect(manifest.permissions).toContainEqual(ACCOUNT);
  });

  it("waits with the code to confirm, and the sign-up hint after Create account", () => {
    const waiting = step(
      "signed-out",
      { state: "signing-in", signIn: signIn("sign-in") },
      "sign-in",
    );
    expect(waiting).toEqual({
      kind: "waiting",
      code: "WDJB-MJHT",
      page: "auth.endue.ai/realms/endue/device",
      signUp: false,
      notice: null,
    });
    const slow = step(
      "signing-in",
      { state: "signing-in", signIn: signIn("sign-up"), reason: "slow-down" },
      "sign-up",
    );
    expect(slow).toMatchObject({
      kind: "waiting",
      signUp: true,
      notice: "endue asked me to check less often. Still waiting.",
    });
    expect(WAITING.openAgain).toBe("Open browser again");
    expect(pageOf(undefined)).toBe("");
  });

  it("moves on when the sign-in finishes: welcome in, or a fresh account", () => {
    expect(step("signing-in", { state: "signed-in" }, "sign-in")).toEqual({
      kind: "signed-in",
      line: SAY.success,
    });
    expect(step("signing-in", { state: "signed-in" }, "sign-up")?.line).toBe(
      "A fresh account. Even better.",
    );
    expect(step("signed-in", { state: "signed-in" }, "sign-in")).toBeNull();
  });

  it("words every failure and offers to try again", () => {
    const ended = (reason: string) =>
      step("signing-in", { state: "signed-out", reason, problem: "x" }, "sign-in");
    expect(ended("expired")).toEqual({
      kind: "failed",
      reason: "expired",
      line: "Sign-in didn't go through. The link may have expired. Open it again?",
      retry: "Open it again",
    });
    expect(ended("denied")).toMatchObject({ retry: "Open it again" });
    expect(ended("offline")).toMatchObject({ line: SAY.offline, retry: "Try again" });
    expect(ended("slow-down")?.line).toContain("slow down");
    expect(ended("unavailable")?.line).toContain("isn't answering");
    expect(ended("suspended")?.line).toContain("suspended");
    expect(failure("something-new").line).toBe(SAY.failure);
    // Cancel: back to the entry, no failure.
    expect(step("signing-in", { state: "signed-out" }, "sign-in")).toEqual({ kind: "entry" });
    expect(step("signed-out", { state: "signed-out", reason: "offline" }, "sign-in")).toBeNull();
    expect([needsHelp(2), needsHelp(3)]).toEqual([false, true]);
  });

  it("leaves endue's agents out of a desk that stayed local", () => {
    expect(order({ local: true })).not.toContain("agents");
    expect(nextScene("desk", { local: true })).toBe("task");
    expect(nextScene("desk", { local: false })).toBe("agents");
  });
});
