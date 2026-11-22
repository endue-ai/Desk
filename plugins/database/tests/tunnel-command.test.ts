// Database: forget the SSH host key (PG-10, ADR 0359), on the SDK's test host: after the person's
// yes it asks the core to forget the SSH host's and the jump host's keys, a no keeps them, and a
// connection without a tunnel says so.
import { describe, expect, it } from "vitest";
import * as builtins from "../ui/features/index.js";
import { mount, SAVED } from "./harness";

const GATE = {
  ...(SAVED[1] as (typeof SAVED)[number]),
  id: "c-gate",
  name: "Gate",
  sshHost: "bastion.example.com",
  sshPort: 2200,
  sshUser: "deploy",
  sshAuth: "agent",
  sshJump: "ops@gate.example.com",
};

const forgot = (calls: readonly { method: string; params?: unknown }[]) =>
  calls.filter((c) => c.method === "db.hostKeys.delete").map((c) => c.params);

describe("Database: forget the SSH host key", () => {
  it("forgets both hops' keys on a yes, and none on a no", async () => {
    const yes = await mount({
      store: { connections: [...SAVED, GATE] },
      pick: () => "yes",
      features: Object.values(builtins),
    });
    await yes.host.command("endue.database.forget-ssh-host-key", { connection: "Gate" });
    expect(forgot(yes.host.calls)).toEqual([
      { host: "gate.example.com", port: 22 },
      { host: "bastion.example.com", port: 2200 },
    ]);
    const no = await mount({
      store: { connections: [...SAVED, GATE] },
      pick: () => "",
      features: Object.values(builtins),
    });
    await no.host
      .command("endue.database.forget-ssh-host-key", { connection: "Gate" })
      .catch(() => undefined);
    expect(forgot(no.host.calls)).toEqual([]);
  });

  it("a connection without a tunnel says it has none", async () => {
    const m = await mount({
      store: { connections: SAVED },
      pick: () => "yes",
      features: Object.values(builtins),
    });
    await expect(
      m.host.command("endue.database.forget-ssh-host-key", { connection: "Shop" }),
    ).rejects.toThrow(/has no SSH tunnel/u);
  });
});
