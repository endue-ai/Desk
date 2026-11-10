// desk.profiles.save over desk.sock on the real core (#102), as the CLI and agents run it: the
// runtime writes ~/.desk/profiles/<id>.yaml as itself, under the grant ADR 0079 gives it, whoever
// ran the command, and the profile is in force. Before, the runtime's write named the file alone, the
// core refused the folder it would make, and the profile was listed though never saved.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { run } from "../support/windows";

const ID = "e2e-saved";
const file = () => join(process.env[HOME_VAR] ?? "", `.desk/profiles/${ID}.yaml`);

describe("desk.profiles.save over the desk socket (#102)", () => {
  it("saves the profile into the desk folder and puts it in force", async () => {
    await shellReady();
    expect(await run("desk.profiles.save", { id: ID, name: "E2E saved" })).toMatchObject({
      id: ID,
      name: "E2E saved",
    });
    expect(readFileSync(file(), "utf8")).toContain("name: E2E saved");
    const list = (await run("desk.profiles.list", {})) as {
      active?: string;
      profiles: Array<{ id: string }>;
    };
    expect(list.active).toBe(ID);
    expect(list.profiles.map((p) => p.id)).toContain(ID);
  });
});
