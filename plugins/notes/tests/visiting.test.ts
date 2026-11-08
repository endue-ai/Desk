import { describe, expect, it, vi } from "vitest";
import type { Permission } from "../../../packages/bridge/src/index";
import { denied, mount, note } from "./harness";

const X = note("~/Documents/ai-notes/blog ideas/God models.md");
const granted = (permission: Permission) => ({
  granted: true,
  grant: {
    grantId: "g1",
    permission,
    duration: "session" as const,
    grantedAt: "2026-11-07T06:10:00Z",
  },
});

/** A note outside the grants whose permission prompt waits until the test answers it. */
async function asking() {
  let reads = 0;
  let answer: (yes: boolean) => void = () => {};
  const mounted = await mount({
    handlers: {
      "fs.read": () => {
        reads++;
        if (reads === 1) throw denied(`fs:read over ${X.path}`);
        return { content: "God models\n", encoding: "utf8" };
      },
      "perm.request": ({ permission }) =>
        new Promise((resolve) => {
          answer = (yes) => resolve(yes ? granted(permission) : { granted: false });
        }),
      "fs.watch": () => ({ watchId: "w1" }),
    },
  });
  return { ...mounted, answer: (yes: boolean) => answer(yes) };
}

describe("showing a note whose visit still waits for its permission prompt", () => {
  it("waits for the visit and shows the note, instead of failing with No note", async () => {
    const { host, view, answer, params } = await asking();
    const visit = host.command("desk.files.visit", X);
    await vi.waitFor(() => expect(params("perm.request")).toHaveLength(1));
    // The buffer is in the desk's list already: the person switches to it while the prompt waits.
    const show = host.command("desk.buffers.show", { buffer: X.buffer });
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer(true);
    await expect(visit).resolves.toBeUndefined();
    await expect(show).resolves.toBeUndefined();
    const shown = { ...X, name: "God models.md", text: "God models\n", modified: false };
    expect(view.notes.at(-1)).toEqual(shown);
    expect(view.statuses.at(-1) ?? "").toBe("");
  });

  it("still says No note when the visit it waited for was refused", async () => {
    const { host, answer, params } = await asking();
    const visit = host.command("desk.files.visit", X);
    await vi.waitFor(() => expect(params("perm.request")).toHaveLength(1));
    const show = host.command("desk.buffers.show", { buffer: X.buffer });
    answer(false);
    await expect(visit).rejects.toThrow(`Not allowed to read ${X.path}.`);
    await expect(show).rejects.toThrow(`No note ${X.buffer}.`);
  });
});
