import { describe, expect, it } from "vitest";
import { BridgeClient, browserStub, stubCommands } from "./index";

const SURFACE = { permission: "ui:surface" } as const;
const A = { caller: "example.a" };
const B = { caller: "example.b" };

describe("the stub's surfaces", () => {
  it("ui.surface.open needs ui:surface and the handle belongs to its opener", async () => {
    const core = stubCommands(() => {}, {
      grants: { "example.a": [SURFACE], "example.b": [SURFACE] },
    });
    const client = new BridgeClient(browserStub(core.handlers));
    await expect(
      client.call(
        "ui.surface.open",
        { surface: "prompt", scope: SURFACE },
        { caller: "example.c" },
      ),
    ).rejects.toMatchObject({ code: "permission_denied", permission: SURFACE });

    const { handle } = await client.call(
      "ui.surface.open",
      { surface: "prompt", placement: "overlay", title: "Permission request", scope: SURFACE },
      A,
    );
    expect(handle).toMatch(/^s-\d+$/);
    expect(core.state().surfaces).toEqual([
      {
        handle,
        caller: "example.a",
        surface: "prompt",
        placement: "overlay",
        title: "Permission request",
      },
    ]);
    const close = (caller: { caller: string }, which = handle) =>
      client.call("ui.surface.close", { handle: which, scope: SURFACE }, caller);
    await expect(close(B)).rejects.toMatchObject({ code: "not_found" });
    await expect(close(A)).resolves.toEqual({});
    await expect(close(A)).rejects.toMatchObject({ code: "not_found" });
    await expect(close({ caller: "example.c" })).rejects.toMatchObject({
      code: "permission_denied",
    });

    const left = await client.call("ui.surface.open", { surface: "main", scope: SURFACE }, A);
    const kept = await client.call("ui.surface.open", { surface: "main", scope: SURFACE }, B);
    core.drop("example.a");
    expect(core.state().surfaces.map((s) => s.handle)).toEqual([kept.handle]);
    await expect(close(A, left.handle)).rejects.toMatchObject({ code: "not_found" });
    expect(core.state().grants.map((g) => g.caller)).toEqual(["example.a", "example.b"]);
  });
});
