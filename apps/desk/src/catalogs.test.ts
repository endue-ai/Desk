// The app's own words (updates, the compositor's placeholders) come from its catalogs (#358, ADR 0250).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UpdateStatus } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { aboutText, rowFor } from "./updates";

const repo = join(import.meta.dirname, "../../..");
const read = (path: string) => JSON.parse(readFileSync(join(repo, path), "utf8")) as object;
const validate = new Ajv2020({ strict: true }).compile(
  read("specs/plugin/v0/messages.schema.json"),
);

describe("the app's catalogs", () => {
  it("the app's words come from its catalogs", () => {
    const en = read("apps/desk/src/messages/en.json") as Record<string, unknown>;
    const ko = read("apps/desk/src/messages/ko.json") as Record<string, unknown>;
    expect(validate(en), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(ko), JSON.stringify(validate.errors)).toBe(true);
    expect(en["desk.compositor.loading"]).toBe("Loading…");
    expect(ko["desk.compositor.mapShow"]).toBe("캔버스 지도 보기");

    const status = {
      state: "available",
      channel: "stable",
      current: { version: "0.1.0" },
      release: { version: "0.2.0" },
    } as unknown as UpdateStatus;
    expect(rowFor(status, "en")?.text).toBe("Desk 0.2.0 is available");
    expect(rowFor(status, "en")?.action?.label).toBe(en["desk.updates.download"]);
    expect(rowFor(status, "ko")?.text).toBe(
      String(ko["desk.updates.available"]).replace("{v}", "0.2.0"),
    );
    expect(aboutText(status, "en").body).toContain("stable");
  });
});
