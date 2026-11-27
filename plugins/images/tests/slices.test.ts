import { expect, it, vi } from "vitest";
import { modelOf } from "../ui/details.js";
import type { Entry } from "../ui/images.js";
import { volumeSlices } from "../ui/slices.js";

it("only draws the newest image slice request", async () => {
  const file = { buffer: "volume", path: "~/volume.nii", name: "volume.nii", size: 24 };
  const decoded: Entry["decoded"] = {
    id: "nifti",
    format: "NIfTI",
    kind: "pixels",
    orientation: 1,
    rows: [],
    slices: {
      index: 0,
      count: 3,
      at: (index) => new Uint8ClampedArray([index, 0, 0, 255]),
    },
  };
  const entry: Entry = { ...file, decoded, model: modelOf(file, decoded) };
  const render = vi.fn();
  const slices = volumeSlices({
    current: () => entry,
    remodel: (image, decoded) => {
      image.decoded = decoded;
    },
    render,
    say: vi.fn(),
  });
  const rejected = expect(slices.show(2)).rejects.toThrow("The active image slice changed");
  const after = slices.show(3);
  await rejected;
  expect(await after).toEqual({ at: 3, count: 3 });
  expect(entry.decoded.slices?.index).toBe(2);
  expect(entry.decoded.rgba?.[0]).toBe(2);
  expect(render).toHaveBeenCalledTimes(1);
});
