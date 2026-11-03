import { describe, expect, it } from "vitest";
import { denied, disk, mount, sample } from "./harness";

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
