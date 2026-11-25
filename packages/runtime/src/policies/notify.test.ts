import { BridgeClient, browserStub, stubCommands } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { installNotify } from "./notify";

/** The status line as a plain object: text, a data-level and a class list; a notice with no actions reads nothing else. */
function statusLine(toggled: [string, boolean][] = []) {
  return {
    textContent: "",
    dataset: {} as DOMStringMap,
    classList: { toggle: (name: string, on: boolean) => toggled.push([name, on]) },
  } as unknown as HTMLElement;
}

function context(): DeskContext {
  const bridge = new BridgeClient(browserStub({}));
  return { hub: new PolicyHub(bridge), bridge, clock: new ManualClock() } as unknown as DeskContext;
}

describe("desk.notify's status line", () => {
  it("keeps the base line as the status while a notice shows", () => {
    const line = statusLine();
    const policy = installNotify(context(), line);
    policy.setBase("endue ready · bridge: browser");
    expect(policy.text()).toBe("endue ready · bridge: browser");
    policy.notify({
      caller: "desk",
      title: "No profile nope — init.yaml names it.",
      level: "warning",
    });
    expect(line.textContent).toBe("No profile nope — init.yaml names it.");
    expect(policy.text()).toBe("endue ready · bridge: browser");
  });

  it("offers Undo of the specific approved write receipt in a notice", async () => {
    const undone: string[] = [];
    const registry = stubCommands((event) => stub.emit(event));
    const stub = browserStub({
      ...registry.handlers,
      "perm.undoApproval": ({ approvalId }) => {
        undone.push(approvalId);
        return {};
      },
    });
    const bridge = new BridgeClient(stub);
    const hub = new PolicyHub(bridge);
    hub.settings.set("desk.notify.dnd", true);
    const ctx = { hub, bridge, clock: new ManualClock() } as unknown as DeskContext;
    const policy = installNotify(ctx, statusLine());
    await hub.commands.settled();
    stub.emit({ event: "perm.approval.done", data: { approvalId: "a-1", ok: true } });
    stub.emit({
      event: "perm.approval.done",
      data: { approvalId: "a-2", ok: true, undoable: true },
    });
    const notices = policy.notifications.history();
    expect(notices).toHaveLength(1);
    const [notice] = notices;
    if (!notice) throw new Error("Expected an undo notice");
    expect(notice.actions).toEqual([
      { label: "Undo", command: "desk.approvals.undo", args: { approvalId: "a-2" } },
    ]);
    await policy.activate(notice.id, true);
    expect(undone).toEqual(["a-2"]);
  });

  it("marks the line only while a notice has actions", () => {
    const toggled: [string, boolean][] = [];
    const policy = installNotify(context(), statusLine(toggled));
    policy.notify({ caller: "desk", title: "Plain notice", level: "info" });
    expect(toggled.at(-1)).toEqual(["has-actions", false]);
  });
});
