// @vitest-environment jsdom
// The socket as noVNC's channel (ui/channel.js): what came before anyone listened is kept, bytes go
// out in order with at most one net.send in flight, the ends are clean or carry their reason, and the
// vendored noVNC's Websock attaches to it as to a WebSocket.
import { describe, expect, it } from "vitest";
import { createSockets } from "../ui/channel.js";
import { fromBase64 } from "../ui/codec.js";
import Websock from "../ui/vendor/novnc/core/websock.js";
import { bridgeError, dataEvent, fakeBridge, settle } from "./harness";

const target = { host: "studio.local", port: 5900 };
const text = (data: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(data));
const sent = (bridge: ReturnType<typeof fakeBridge>) =>
  bridge.params("net.send").map((p) => new TextDecoder().decode(fromBase64(String(p.data))));

describe("createSockets", () => {
  it("connects under a net:connect scope for the host and port, and passes the bridge's refusal on", async () => {
    const bridge = fakeBridge({ "net.connect": () => ({ socketId: "s-1" }) });
    const sockets = createSockets(bridge);
    const channel = await sockets.connect({ ...target, timeoutMs: 5000 });
    expect(bridge.params("net.connect")).toEqual([
      {
        host: "studio.local",
        port: 5900,
        timeoutMs: 5000,
        scope: { permission: "net:connect", hosts: ["studio.local:5900"] },
      },
    ]);
    expect(channel.readyState).toBe("open");
    expect(sockets.size).toBe(1);
    bridge.handlers["net.connect"] = () => {
      throw bridgeError("permission_denied");
    };
    await expect(sockets.connect(target)).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("keeps the bytes that came before the answer and before anyone listened, in order", async () => {
    const bridge = fakeBridge();
    // The server speaks first: its greeting can reach the plugin before net.connect's answer.
    bridge.handlers["net.connect"] = () => {
      bridge.emit(dataEvent("s-1", "RFB "));
      return { socketId: "s-1" };
    };
    const sockets = createSockets(bridge);
    const channel = await sockets.connect(target);
    bridge.emit(dataEvent("s-1", "003.008\n"));
    bridge.emit(dataEvent("s-2", "someone else's"));
    const heard: string[] = [];
    channel.onmessage = (event) => heard.push(text(event.data));
    expect(heard).toEqual([]);
    await settle(1);
    bridge.emit(dataEvent("s-1", "more"));
    expect(heard).toEqual(["RFB ", "003.008\n", "more"]);
  });

  it("sends in order, one call at a time, with what queued meanwhile in one call", async () => {
    const bridge = fakeBridge({ "net.connect": () => ({ socketId: "s-1" }) });
    let release: () => void = () => {};
    bridge.handlers["net.send"] = () =>
      new Promise((resolve) => {
        release = () => resolve({});
      });
    const channel = await createSockets(bridge).connect(target);
    const buffer = new Uint8Array(16);
    const push = (s: string) => {
      buffer.set(new TextEncoder().encode(s));
      // noVNC hands a view of its own buffer, which it overwrites at once.
      channel.send(new Uint8Array(buffer.buffer, 0, s.length));
    };
    push("one");
    push("two");
    push("six");
    expect(sent(bridge)).toEqual(["one"]);
    release();
    await settle(2);
    expect(sent(bridge)).toEqual(["one", "twosix"]);
  });

  it("ends clean when closed, with the reason when the core ends it, and once", async () => {
    const bridge = fakeBridge({
      "net.connect": () => ({ socketId: "s-1" }),
      "net.close": () => ({}),
    });
    const sockets = createSockets(bridge);
    const channel = await sockets.connect(target);
    const ends: unknown[] = [];
    channel.onclose = (e) => ends.push(e);
    channel.close();
    expect(channel.readyState).toBe("closing");
    await settle(2);
    bridge.emit({ event: "net.closed", data: { socketId: "s-1", reason: "closed by the caller" } });
    expect(ends).toEqual([{ code: 1000, reason: "", wasClean: true }]);
    expect(sockets.size).toBe(0);

    bridge.handlers["net.connect"] = () => ({ socketId: "s-2" });
    const other = await sockets.connect(target);
    const otherEnds: unknown[] = [];
    other.onclose = (e) => otherEnds.push(e);
    bridge.emit({ event: "net.closed", data: { socketId: "s-2", reason: "Connection reset" } });
    expect(otherEnds).toEqual([{ code: 1006, reason: "Connection reset", wasClean: false }]);
    other.send(new Uint8Array([1]));
    expect(bridge.params("net.send")).toEqual([]);
  });

  it("a failed send is an error, then the end", async () => {
    const bridge = fakeBridge({
      "net.connect": () => ({ socketId: "s-1" }),
      "net.send": () => {
        throw bridgeError("not_found", "no socket s-1");
      },
    });
    const channel = await createSockets(bridge).connect(target);
    const seen: string[] = [];
    channel.onerror = () => seen.push("error");
    channel.onclose = (e) => seen.push(`close ${e.reason}`);
    channel.send(new Uint8Array([1, 2]));
    await settle(2);
    expect(seen).toEqual(["error", "close no socket s-1"]);
  });

  it("is a channel noVNC's Websock attaches to and reads", async () => {
    const bridge = fakeBridge({ "net.connect": () => ({ socketId: "s-1" }) });
    const channel = await createSockets(bridge).connect(target);
    const sock = new Websock();
    let length = 0;
    sock.on("message", () => {
      length = sock.rQlen();
    });
    sock.attach(channel);
    expect(sock.readyState).toBe("open");
    bridge.emit(dataEvent("s-1", "RFB 003.008\n"));
    expect(length).toBe(12);
    sock.sQpushString("RFB 003.008\n");
    sock.flush();
    await settle(1);
    expect(sent(bridge)).toEqual(["RFB 003.008\n"]);
  });
});
