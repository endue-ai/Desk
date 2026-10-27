import { describe, expect, it } from "vitest";
import type { BridgeRequest, BridgeResponse, FsReadPermission } from "./index";
import { BridgeCallError, BridgeClient, browserStub, tauriAdapter } from "./index";

const scope: FsReadPermission = { permission: "fs:read", paths: ["~/**"] };

describe("BridgeClient", () => {
  it("resolves the result of a successful call", async () => {
    const client = new BridgeClient(
      browserStub({ "fs.read": () => ({ content: "# Notes", encoding: "utf8" }) }),
    );
    await expect(client.call("fs.read", { path: "~/notes.md", scope })).resolves.toEqual({
      content: "# Notes",
      encoding: "utf8",
    });
  });

  it("rejects with a BridgeCallError that carries the code and the missing permission", async () => {
    const client = new BridgeClient(browserStub({}));
    const call = client.call("fs.read", { path: "~/notes.md", scope });
    await expect(call).rejects.toBeInstanceOf(BridgeCallError);
    await expect(call).rejects.toMatchObject({ code: "permission_denied", permission: scope });
  });

  it("gives every request a new id", async () => {
    const seen: number[] = [];
    const client = new BridgeClient({
      name: "spy",
      call: async (request: BridgeRequest): Promise<BridgeResponse> => {
        seen.push(request.id);
        return { id: request.id, ok: true, result: { grants: [] } };
      },
      onEvent: () => () => {},
    });
    await client.call("perm.query", {});
    await client.call("perm.query", {});
    expect(seen).toEqual([1, 2]);
  });

  it("exposes the adapter name", () => {
    expect(new BridgeClient(browserStub({})).adapterName).toBe("browser");
  });
});

describe("browserStub", () => {
  it("delivers emitted events to listeners until they unsubscribe", () => {
    const stub = browserStub({});
    const seen: string[] = [];
    const off = stub.onEvent((event) => seen.push(event.event));
    stub.emit({ event: "perm.changed", data: { grantId: "g1", change: "revoked" } });
    off();
    stub.emit({ event: "perm.changed", data: { grantId: "g2", change: "revoked" } });
    expect(seen).toEqual(["perm.changed"]);
  });
});

describe("tauriAdapter", () => {
  it("forwards requests to the injected invoke as bridge_call", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const adapter = tauriAdapter(async (command, args) => {
      calls.push({ command, args });
      return { id: 1, ok: true, result: { grants: [] } } satisfies BridgeResponse;
    });
    const client = new BridgeClient(adapter);
    await expect(client.call("perm.query", {})).resolves.toEqual({ grants: [] });
    expect(adapter.name).toBe("tauri");
    expect(calls).toEqual([
      { command: "bridge_call", args: { request: { id: 1, method: "perm.query", params: {} } } },
    ]);
  });

  it("passes the caller on when a call names one", async () => {
    const calls: unknown[] = [];
    const adapter = tauriAdapter(async (_command, args) => {
      calls.push(args);
      return { id: 1, ok: true, result: { grants: [] } } satisfies BridgeResponse;
    });
    await new BridgeClient(adapter).call("perm.query", {}, { caller: "example.hello-ui" });
    expect(calls).toEqual([
      {
        request: { id: 1, method: "perm.query", params: {} },
        caller: "example.hello-ui",
      },
    ]);
  });
});

describe("callers", () => {
  it("reach the adapter, and forward() keeps the plugin's own request", async () => {
    const stub = browserStub({ "perm.query": () => ({ grants: [] }) });
    const client = new BridgeClient(stub);
    await client.call("perm.query", {}, { caller: "example.a" });
    const response = await client.forward(
      { id: 41, method: "perm.query", params: {} },
      "example.b",
    );
    expect(response).toEqual({ id: 41, ok: true, result: { grants: [] } });
    expect(stub.log.map((entry) => [entry.caller, entry.request.id])).toEqual([
      ["example.a", 1],
      ["example.b", 41],
    ]);
  });
});
