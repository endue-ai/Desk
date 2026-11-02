import type { BridgeEvent, UpdateStatus } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { installUpdates, ROW, rowFor, type UpdateRow, type UpdatesHost } from "./updates";

const status = (state: UpdateStatus["state"], extra: Partial<UpdateStatus> = {}): UpdateStatus => ({
  state,
  current: { version: "0.1.0", commit: "fa7a4af" },
  channel: "stable",
  ...extra,
});

const staged = status("staged", {
  release: { version: "0.2.0", notes: "https://github.com/endue-ai/Desk/releases/tag/v0.2.0" },
  staged: true,
});

type Run = (args: unknown, from: { caller?: string }) => unknown;

/** A host whose core answers update.status with `first` (or refuses), with every call recorded. */
function host(first: UpdateStatus | Error, picked?: string) {
  const listeners: Array<(event: BridgeEvent) => void> = [];
  const calls: Array<{ method: string; params: unknown }> = [];
  const defined = new Map<string, Run>();
  const rows: Array<UpdateRow | null> = [];
  let remembered: string | null = null;
  const h: UpdatesHost & { calls: typeof calls; defined: Map<string, Run>; rows: typeof rows } = {
    core: {
      call: vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params });
        if (method === "update.status" && first instanceof Error) throw first;
        return method === "update.status" ? first : status("checking");
      }) as unknown as UpdatesHost["core"]["call"],
      onEvent: (listener) => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    },
    ready: Promise.resolve(),
    lang: "en",
    show: (row) => rows.push(row),
    commands: {
      define: (id, spec) => {
        defined.set(id, spec.run);
        return () => defined.delete(id);
      },
      has: (id) => id === "desk.palette.pick" && picked !== undefined,
      run: vi.fn(async () => picked),
    },
    notify: vi.fn(),
    memory: {
      get: () => remembered,
      set: (v) => {
        remembered = v;
      },
    },
    calls,
    defined,
    rows,
  };
  const emit = (data: UpdateStatus) => {
    for (const listener of listeners) listener({ event: "update.changed", data });
  };
  return { h, emit };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("updates", () => {
  it("a build that does not update itself shows and registers nothing", async () => {
    const { h } = host(new Error("update.status: unsupported: this build does not update itself"));
    installUpdates(h);
    await settle();
    expect(h.defined.size).toBe(0);
    expect(h.rows).toEqual([]);
  });

  it("shows the download, then Restart to update, and announces a staged build once", async () => {
    const { h, emit } = host(
      status("downloading", { release: { version: "0.2.0" }, received: 25, total: 100 }),
    );
    installUpdates(h);
    await settle();
    expect(h.rows.at(-1)).toEqual({ id: ROW, text: "Downloading Desk 0.2.0 · 25%" });
    emit(staged);
    expect(h.rows.at(-1)).toEqual({
      id: ROW,
      text: "Desk 0.2.0 is ready",
      action: { label: "Restart to update", command: "desk.update.apply" },
    });
    emit(status("checking", { release: staged.release, staged: true }));
    emit(staged);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Desk 0.2.0 is ready" }),
    );
    expect([...h.defined.keys()].sort()).toEqual([
      "desk.update.apply",
      "desk.update.check",
      "desk.update.download",
      "desk.update.notes",
    ]);
  });

  it("does not announce a version it announced before a restart", async () => {
    const { h } = host(staged);
    h.memory.set("0.2.0");
    installUpdates(h);
    await settle();
    expect(h.rows.at(-1)?.text).toBe("Desk 0.2.0 is ready");
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("restarts at once for the person, and asks the person when another caller asks", async () => {
    const person = host(staged);
    installUpdates(person.h);
    await settle();
    await person.h.defined.get("desk.update.apply")?.({}, {});
    expect(person.h.calls.map((c) => c.method)).toContain("update.apply");
    expect(person.h.calls.at(-1)?.params).toEqual({ scope: { permission: "update:manage" } });

    const declined = host(staged, "later");
    installUpdates(declined.h);
    await settle();
    const asked = declined.h.defined.get("desk.update.apply")?.({}, { caller: "example.agent" });
    await expect(asked).rejects.toThrow("did not agree");
    expect(declined.h.commands.run).toHaveBeenCalledWith(
      "desk.palette.pick",
      expect.objectContaining({ title: "example.agent asks to restart Desk into 0.2.0" }),
    );
    expect(declined.h.calls.map((c) => c.method)).not.toContain("update.apply");

    const agreed = host(staged, "restart");
    installUpdates(agreed.h);
    await settle();
    await agreed.h.defined.get("desk.update.apply")?.({}, { caller: "example.agent" });
    expect(agreed.h.calls.map((c) => c.method)).toContain("update.apply");

    const nobody = host(staged);
    installUpdates(nobody.h);
    await settle();
    await expect(
      nobody.h.defined.get("desk.update.apply")?.({}, { caller: "example.agent" }),
    ).rejects.toThrow();
  });

  it("opens the release notes on GitHub", async () => {
    const { h } = host(staged);
    installUpdates(h);
    await settle();
    await h.defined.get("desk.update.notes")?.({}, {});
    expect(h.calls.at(-1)).toEqual({
      method: "shell.open",
      params: {
        target: "https://github.com/endue-ai/Desk/releases/tag/v0.2.0",
        scope: { permission: "shell:open", schemes: ["https"] },
      },
    });
  });

  it("words each state, in Korean too", () => {
    const failed = status("failed", {
      release: { version: "0.2.0" },
      staged: true,
      reason: "no room",
    });
    expect(rowFor(failed, "en")).toEqual({
      id: ROW,
      text: "Desk 0.2.0 did not install: no room",
      action: { label: "Try again", command: "desk.update.apply" },
    });
    expect(rowFor(status("failed", { reason: "offline" }), "en")).toBeNull();
    expect(
      rowFor(status("available", { release: { version: "0.2.0" } }), "en")?.action?.command,
    ).toBe("desk.update.download");
    expect(rowFor(status("up-to-date"), "en")).toBeNull();
    expect(rowFor(staged, "ko")?.text).toBe("Desk 0.2.0 준비됨");
  });
});
