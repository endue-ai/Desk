// A refusal can be taken back without a restart (08 #16): the core remembers it for the session
// (CORE-03), so the list keeps the person's refusals, and Allow grants what was asked, for as long as
// it was asked, which ends the core's refusal too.
import { describe, expect, it } from "vitest";
import type {
  CallerGrant,
  PermGrantParams,
  Permission,
  PermPromptData,
} from "../../../packages/bridge/src/index";
import { grant, type Handlers, MANAGE, type Mounted, mount, plugin } from "./harness";

const WRITE: Permission = { permission: "fs:write", paths: ["~/Documents/**"] };
const MIC: Permission = { permission: "audio:capture" };

/** A core that grants with perm.grant and lists what it granted. */
function core(extra: Handlers = {}): Handlers & { granted: PermGrantParams[] } {
  const granted: PermGrantParams[] = [];
  let held: CallerGrant[] = [];
  return {
    granted,
    "plugin.list": () => ({ plugins: [plugin("example.sheets", "Sheets", "ui")] }),
    "events.subscribe": () => ({ subscriptionId: "sub-1" }),
    "perm.list": () => ({ grants: held }),
    "perm.answer": () => ({}),
    "perm.grant": (params: PermGrantParams) => {
      granted.push(params);
      const made = grant(params.caller, `g${granted.length}`, params.permission, params.duration);
      held = [...held, made];
      return { grant: made.grant };
    },
    ...extra,
  } as Handlers & { granted: PermGrantParams[] };
}

const ask = (promptId: string, extra: Partial<PermPromptData> = {}): PermPromptData => ({
  promptId,
  caller: "example.sheets",
  permission: WRITE,
  reason: "To save ~/Documents/budget.csv",
  duration: "session",
  ...extra,
});

async function refused(handlers: Handlers, ...prompts: PermPromptData[]): Promise<Mounted> {
  const mounted = await mount(handlers);
  for (const data of prompts) {
    mounted.host.emit({ event: "perm.prompt", data });
    await mounted.settle();
    await mounted.app.answer("refuse");
    await mounted.settle();
  }
  return mounted;
}

describe("refusals of this session", () => {
  it("are listed with what was asked and for how long", async () => {
    const { view } = await refused(
      core(),
      ask("p1"),
      ask("p2", { caller: "desk", permission: MIC }),
    );
    expect(view.refused.at(-1)).toEqual([
      {
        key: expect.any(String),
        caller: { id: "example.sheets", name: "Sheets", kind: "UI plugin" },
        permission: "Write files",
        scope: "~/Documents/**",
        duration: "This session",
        allowLabel: "Allow Write files (~/Documents/**) for Sheets (This session)",
      },
      {
        key: expect.any(String),
        caller: { id: "desk", name: "Desk", kind: "Runtime" },
        permission: "Use the microphone",
        scope: "",
        duration: "This session",
        allowLabel: "Allow Use the microphone for Desk (This session)",
      },
    ]);
  });

  it("are taken back with Allow: what was asked is granted, and the refusal leaves the list", async () => {
    const handlers = core();
    const { app, view, settle } = await refused(handlers, ask("p1", { duration: "always" }));
    const [item] = view.refused.at(-1) ?? [];
    await app.allow(item?.key ?? "");
    await settle();
    expect(handlers.granted).toEqual([
      {
        caller: "example.sheets",
        permission: WRITE,
        duration: "always",
        reason: "The person allowed it in Permissions after refusing it",
        scope: MANAGE,
      },
    ]);
    expect(view.refused.at(-1)).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Allowed Sheets: Write files (Always).");
    expect(view.lists.at(-1)?.summary).toBe("1 permission held by 1 caller");
  });

  it("keep the refusal and say why when Allow fails", async () => {
    const handlers = core({
      "perm.grant": () => {
        throw Object.assign(new Error("outside its allowlist"), { code: "permission_denied" });
      },
    });
    const { app, view, settle } = await refused(handlers, ask("p1"));
    const [item] = view.refused.at(-1) ?? [];
    await app.allow(item?.key ?? "");
    await settle();
    expect(view.refused.at(-1)).toHaveLength(1);
    expect(view.statuses.at(-1)).toMatch(/^Could not allow Sheets: Write files: /);
  });

  it("leave the list when a grant of the same permission ends them", async () => {
    let grants: CallerGrant[] = [];
    const handlers = core({ "perm.list": () => ({ grants }) });
    const { host, view, settle } = await refused(handlers, ask("p1"));
    expect(view.refused.at(-1)).toHaveLength(1);
    grants = [grant("example.sheets", "g9", WRITE, "session")];
    host.emit({
      event: "perm.changed",
      data: { grantId: "g9", change: "granted" },
    });
    await settle();
    expect(view.refused.at(-1)).toEqual([]);
  });

  it("come back after the page loads again, from what the plugin kept", async () => {
    const first = await refused(core(), ask("p1"));
    const kept = first.host.state;
    const again = await mount(core(), kept);
    expect(again.view.refused.at(-1)).toHaveLength(1);
    expect(again.view.refused.at(-1)?.[0]).toMatchObject({ permission: "Write files" });
  });

  it("are not made by an answer that allows, nor by a failed refusal", async () => {
    const handlers = core({
      "perm.answer": (params: { granted: boolean }) => {
        if (!params.granted) throw new Error("no prompt p2 is waiting");
        return {};
      },
    });
    const mounted = await mount(handlers);
    mounted.host.emit({ event: "perm.prompt", data: ask("p1") });
    mounted.host.emit({ event: "perm.prompt", data: ask("p2", { permission: MIC }) });
    await mounted.settle();
    await mounted.app.answer("session");
    await mounted.settle();
    await mounted.app.answer("refuse");
    await mounted.settle();
    expect(mounted.view.refused.at(-1) ?? []).toEqual([]);
  });
});
