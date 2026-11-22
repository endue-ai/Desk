// A fresh desk sends only bridge requests the core accepts (#566): every request the core stub
// sees from the start until the desk is ready, the runtime's and its plugins', validates against
// BridgeRequest (specs/bridge/v0). The core refuses one that does not, and the refusal once came
// back as an uncaught rejection that a fresh start reported as a crash.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import Ajv2020 from "ajv/dist/2020.js";
import { DESK, openShell } from "./shell-helpers";

test.use({ viewport: DESK });

const specs = join(import.meta.dirname, "../../../specs");
/** The bridge's schemas and the plugin specs they reference. */
const SETS = ["plugin", "item", "view", "connector", "memory", "agent", "market", "bridge"];

function bridgeRequest() {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  for (const set of SETS) {
    const dir = join(specs, set, "v0");
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".schema.json")))
      ajv.addSchema(JSON.parse(readFileSync(join(dir, name), "utf8")));
  }
  const validate = ajv.getSchema(
    "https://endue.ai/specs/bridge/v0/bridge.schema.json#/$defs/BridgeRequest",
  );
  if (!validate) throw new Error("no BridgeRequest schema");
  return validate;
}

test("every request a fresh desk sends fits the bridge contract", async ({ page }) => {
  await openShell(page, "?lang=en");
  await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
  await expect
    .poll(() => page.evaluate(() => window.__shell.desk.runtime.commands.has("desk.palette.open")))
    .toBe(true);
  const sent = await page.evaluate(() =>
    window.__shell.stub.log.map((l) => ({ caller: l.caller ?? "desk", request: l.request })),
  );
  expect(sent.length).toBeGreaterThan(50);
  const validate = bridgeRequest();
  const refused = sent
    .filter(({ request }) => !validate(request))
    .map(({ caller, request }) => `${caller} ${request.method}`);
  expect(refused).toEqual([]);
});
