import { describe, expect, it, vi } from "vitest";
import manifest from "../plugin.json";
import { createScreens } from "../ui/app.js";
import { bridgeError, fakeBridge, settle } from "./harness";

const studio = {
  id: "m-1",
  name: "Demo",
  host: "fixture.invalid",
  port: 5900,
  username: "fixture-user",
};
const grant = {
  grantId: "g-1",
  duration: "always",
  permission: { permission: "net:connect", hosts: ["fixture.invalid:5900"] },
};

describe("Screen Sharing agent commands", () => {
  it("declares saved-computer reads and session controls", () => {
    for (const name of ["computers", "state", "connect", "disconnect", "view-only", "fit"]) {
      expect(manifest.contributes.commands.find(({ id }) => id.endsWith(`.${name}`))).toMatchObject(
        { agent: true },
      );
    }
  });

  it("uses saved addresses and revokes only the removed computer's exact lasting grant", async () => {
    let granted = false;
    const bridge = fakeBridge({
      "store.get": () => ({ value: [studio] }),
      "store.set": () => ({}),
      "perm.request": () => {
        granted = true;
        return { granted, grant };
      },
      "perm.query": () => ({
        grants: [
          grant,
          {
            ...grant,
            grantId: "g-other",
            permission: { permission: "net:connect", hosts: ["other.invalid:5900"] },
          },
        ],
      }),
      "perm.revoke": () => {
        granted = false;
        return {};
      },
    });
    const socket = vi.fn(async () => {
      if (!granted) throw bridgeError("permission_denied");
      return { close: () => {} };
    });
    class Rfb extends EventTarget {
      focus() {}
      disconnect() {}
    }
    const app = createScreens({
      bridge,
      sockets: { connect: socket },
      RFB: Rfb,
      view: { computers() {}, phase() {}, toggles() {}, status() {}, screen: {} },
    } as never);
    await app.start();
    const handlers = new Map<string, (args?: unknown, invocation?: unknown) => unknown>();
    app.wire({
      on: (id: string, run: (args?: unknown, invocation?: unknown) => unknown) =>
        handlers.set(id, run),
    } as never);
    const call = (name: string, args?: unknown) => {
      const command = handlers.get(`endue.screens.${name}`);
      if (!command) throw new Error(`Missing command ${name}`);
      return command(args, { caller: "agent:eris" });
    };
    expect(call("computers")).toEqual([
      { id: studio.id, name: studio.name, host: studio.host, port: studio.port },
    ]);
    await expect(call("connect", { host: "other.invalid" })).rejects.toThrow(/saved/);
    expect(socket).not.toHaveBeenCalled();
    await expect(call("connect", { id: studio.id })).resolves.toMatchObject({
      computer: studio.id,
    });
    await settle();
    expect(bridge.params("perm.request")).toMatchObject([
      { duration: "always", permission: grant.permission },
    ]);
    expect(bridge.params("perm.request")[0]).not.toHaveProperty("again");
    await app.remove(studio.id);
    expect(bridge.params("perm.revoke")).toEqual([{ grantId: grant.grantId }]);
  });
});
