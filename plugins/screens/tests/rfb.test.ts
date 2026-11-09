// @vitest-environment jsdom
// The vendored noVNC's RFB over the bridge channel against a fake RFB 3.8 server (tests/harness.ts):
// the handshake, the VNC password asked through the plugin's question and answered with the DES
// response noVNC computes, the server's name, and a refused sign-in in words. No network.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSockets } from "../ui/channel.js";
import { startSession } from "../ui/session.js";
import RFB from "../ui/vendor/novnc/core/rfb.js";
import { fakeBridge, rfbServer, settle } from "./harness";

const studio = { id: "m-1", name: "Studio", host: "studio.local", port: 5900 };

beforeAll(() => {
  // jsdom draws nothing: a 2D context that takes every call, and the observers noVNC sets up.
  const context = new Proxy(
    {},
    {
      get: (_, name) =>
        name === "createImageData" || name === "getImageData"
          ? (w: number, h: number) => ({
              width: w,
              height: h,
              data: new Uint8ClampedArray(w * h * 4),
            })
          : () => {},
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => context) as never;
  globalThis.ImageData ??= class {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  } as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(() => {
  document.body.replaceChildren();
});

function run(options: { password: string; accept?: (response: Uint8Array) => boolean }) {
  const bridge = fakeBridge({ "perm.request": () => ({ granted: true }) });
  const server = rfbServer(bridge, { name: "Studio's Mac", accept: options.accept });
  const target = document.createElement("div");
  document.body.append(target);
  const states: string[] = [];
  const asked: unknown[] = [];
  const session = startSession({
    bridge,
    sockets: createSockets(bridge),
    RFB: RFB as never,
    target,
    computer: studio,
    credentials: async (ask) => {
      asked.push(ask);
      return { password: options.password };
    },
    trust: async () => false,
    // A new desktop name is reported in the same phase; the steps are what changes.
    onState: (state) => {
      const step = `${state.phase}: ${state.detail}`;
      if (states.at(-1) !== step) states.push(step);
    },
  });
  return { bridge, server, session, states, asked, target };
}

describe("noVNC over net.connect", () => {
  it("signs in with the VNC password and shows the screen", async () => {
    const { server, session, states, asked, target } = run({
      password: "fixture",
      accept: (response) =>
        response.every((byte, i) => byte === RFB.genDES("fixture", [...server.challenge])[i]),
    });
    await settle(40);
    expect(asked).toEqual([{ types: ["password"] }]);
    expect(server.response).not.toBeNull();
    expect(states).toEqual([
      "connecting: Connecting to Studio…",
      "signing-in: Studio asks you to sign in.",
      "connecting: Signing in to Studio…",
      "connected: Connected to Studio.",
    ]);
    expect(session.state.desktop).toBe("Studio's Mac");
    expect(target.querySelector("canvas")).not.toBeNull();
    // The client's own messages after ServerInit: SetPixelFormat (0), SetEncodings (2) and an update request (3).
    const kinds = server.received.slice(3).map((bytes) => bytes[0]);
    expect(kinds).toContain(2);
    session.disconnect();
    await settle(10);
    expect(server.closed).toBe(true);
    expect(session.state).toMatchObject({ phase: "ended", detail: "Disconnected from Studio." });
  });

  it("a refused password ends the session in words", async () => {
    const { session } = run({ password: "wrong", accept: () => false });
    await settle(40);
    expect(session.state).toMatchObject({
      phase: "ended",
      detail: "Studio refused the sign-in: Authentication failed.",
    });
  });
});
