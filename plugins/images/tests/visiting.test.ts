import { describe, expect, it, vi } from "vitest";
import { pngHeader } from "./build";
import { denied, disk, image, mount } from "./harness";

const G = image("~/Documents/Research/Metaverse/1695568248.gif");

/** An image outside the grants whose permission prompt waits until the test answers it. */
async function asking() {
  const files = { [G.path]: pngHeader(516, 409) };
  const inside = disk(files);
  let allowed = false;
  let answer: (yes: boolean) => void = () => {};
  const mounted = await mount({
    handlers: {
      ...inside,
      "fs.read": (params, caller) => {
        const read = inside["fs.read"];
        if (!allowed || !read) throw denied(`fs:read over ${G.path}`);
        return read(params, caller);
      },
      "perm.request": ({ permission }) =>
        new Promise((resolve) => {
          answer = (yes) => {
            allowed = yes;
            const grantedAt = "2026-11-07T06:10:00Z";
            const grant = { grantId: "g1", permission, duration: "session" as const, grantedAt };
            resolve(yes ? { granted: true, grant } : { granted: false });
          };
        }),
    },
  });
  return { ...mounted, answer: (yes: boolean) => answer(yes) };
}

describe("showing an image whose visit still waits for its permission prompt", () => {
  it("waits for that visit instead of cancelling it and reading the file a second time", async () => {
    const { host, view, answer, params } = await asking();
    const visit = host.command("desk.files.visit", G);
    await vi.waitFor(() => expect(params("perm.request")).toHaveLength(1));
    const show = host.command("desk.buffers.show", G);
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer(true);
    await expect(visit).resolves.toBeUndefined();
    await expect(show).resolves.toBeUndefined();
    expect(params("perm.request")).toHaveLength(1);
    expect(view.states.at(-1)?.image).toMatchObject({ buffer: G.buffer, width: 516, height: 409 });
  });

  it("does not ask again when the visit it waited for was refused", async () => {
    const { host, answer, params } = await asking();
    const visit = host.command("desk.files.visit", G);
    await vi.waitFor(() => expect(params("perm.request")).toHaveLength(1));
    const show = host.command("desk.buffers.show", G);
    answer(false);
    await expect(visit).rejects.toThrow(`Not allowed to read ${G.path}.`);
    await expect(show).rejects.toThrow(`No image ${G.buffer}.`);
    expect(params("perm.request")).toHaveLength(1);
  });
});
