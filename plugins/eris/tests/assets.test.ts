import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const brand = join(here, "../../../brand/eris");
const assets = join(here, "../ui/assets");

describe("Eris assets", () => {
  it("are unmodified copies of brand/eris (brand licence)", () => {
    const svgs = readdirSync(brand).filter((name) => name.endsWith(".svg"));
    expect(svgs.length).toBeGreaterThanOrEqual(9);
    for (const name of svgs) {
      expect(readFileSync(join(assets, name)), name).toEqual(readFileSync(join(brand, name)));
    }
  });
});
