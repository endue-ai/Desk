import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCS, denied, disk, mount, sample } from "./harness";

describe("adding a folder the plugin may not list", () => {
  it("is refused and not kept as a root", async () => {
    const { app, view } = await mount({
      handlers: {
        ...disk(sample()),
        "fs.list": ({ path }) => {
          if (path === "/tmp") throw denied("fs:read over /tmp");
          return { entries: sample()[path] ?? [] };
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(app.addFolder("/tmp")).rejects.toThrow("Not allowed to list /tmp.");
    expect(view.shown().some((row) => row.includes(":tmp"))).toBe(false);
    expect(view.headers.at(-1)?.folders ?? []).not.toContain("/tmp");
    expect(view.statuses.at(-1)).toBe("Not allowed to list /tmp.");
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("copying a folder path", () => {
  it("copies the selected folder and reports its path when clipboard access is unavailable", async () => {
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { app, host, view } = await mount({ handlers: disk(sample()) });
    const folder = `${DOCS}/Work`;
    app.select(folder);
    await host.command("endue.explorer.copy-path");
    expect(writeText).toHaveBeenCalledWith(folder);
    expect(view.statuses.at(-1)).toMatch(/copied/i);
    await host.command("endue.explorer.copy-path");
    expect(view.statuses.at(-1)).toBe(folder);
  });
});
