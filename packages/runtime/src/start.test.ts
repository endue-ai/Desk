import { describe, expect, it, vi } from "vitest";
import { browserCore } from "./bridge/core";
import { CommandError } from "./commands";
import { PolicyHub } from "./hub";
import type { NoticeInput } from "./notify";
import type { DeskContext } from "./policies/context";
import { brokenRecordNotice, installStart, type StartInfo, startNotices } from "./start";

const BROKEN = [
  { name: "store.json", path: "/data/store.json.broken" },
  { name: "plugins.json", path: "/data/plugins.json.broken" },
];

describe("startNotices", () => {
  it("names the plugins a crash-loop safe start held off, with Start normally", () => {
    const info: StartInfo = {
      safe: { reason: "crash-loop", heldOff: ["endue.notes", "endue.terminal"] },
      broken: [],
    };
    const [notice, ...rest] = startNotices(info);
    expect(rest).toEqual([]);
    expect(notice?.title).toMatch(/safe mode/i);
    expect(notice?.body).toContain("endue.notes");
    expect(notice?.body).toContain("endue.terminal");
    expect(notice?.actions).toEqual([{ label: "Start normally", command: "desk.start.normally" }]);
  });

  it("gives each broken file one notice naming it, with Show in file manager", () => {
    const notices = startNotices({ broken: BROKEN });
    expect(notices.map((n) => n.title)).toEqual([
      "store.json could not be read",
      "plugins.json could not be read",
    ]);
    for (const [index, notice] of notices.entries()) {
      const file = BROKEN[index];
      expect(notice.body).toContain(`${file?.name}.broken`);
      expect(notice.actions).toEqual([
        { label: "Show in file manager", command: "desk.files.reveal", args: { path: file?.path } },
      ]);
    }
  });

  it("says nothing more when the person asked for safe mode: the badge says it", () => {
    const info: StartInfo = { safe: { reason: "asked", heldOff: ["endue.notes"] }, broken: [] };
    expect(startNotices(info)).toEqual([]);
  });
});

describe("brokenRecordNotice", () => {
  it("names a store record the desk could not read and shows store.json", () => {
    const notice = brokenRecordNotice("session", "/data");
    expect(notice.title).toBe("The saved session could not be read");
    expect(notice.body).toContain("session.broken");
    expect(notice.actions).toEqual([
      {
        label: "Show in file manager",
        command: "desk.files.reveal",
        args: { path: "/data/store.json" },
      },
    ]);
  });
});

describe("a start step that fails", () => {
  it("a start step that fails says why in one error notice", () => {
    const core = browserCore({ manifests: [] });
    const ctx = { hub: new PolicyHub(core.client), bridge: core.client } as unknown as DeskContext;
    const notices: NoticeInput[] = [];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const start = installStart(ctx, { notify: (n) => void notices.push(n), save: async () => {} });
    try {
      start.failed(new Error("plugin.list: permission denied"));
      start.failed(new CommandError("cancelled", "the person closed the pick"));
      expect(notices).toEqual([
        {
          caller: "desk",
          title: "The desk did not finish starting",
          body: "plugin.list: permission denied",
          level: "error",
        },
      ]);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      start.dispose();
      log.mockRestore();
    }
  });
});
