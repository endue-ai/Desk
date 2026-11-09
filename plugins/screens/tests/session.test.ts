// One session (ui/session.js) with a fake RFB: the grant asked for once when the plugin's grants do
// not cover the address, a refusal and a silent host in words, the sign-in asked and cancelled, a
// server key trusted or not, the toggles, and a disconnect before the socket opened.
import { describe, expect, it } from "vitest";
import { failureText, type State, startSession } from "../ui/session.js";
import { bridgeError, fakeBridge, settle } from "./harness";

const studio = { id: "m-1", name: "Studio", host: "studio.local", port: 5900 };

class FakeRfb extends EventTarget {
  static last: FakeRfb | null = null;
  scaleViewport = false;
  clipViewport = false;
  resizeSession = true;
  viewOnly = false;
  focusOnClick = false;
  showDotCursor = false;
  calls: string[] = [];
  constructor(
    readonly target: Element,
    readonly channel: unknown,
    readonly options: object,
  ) {
    super();
    FakeRfb.last = this;
  }
  fire(name: string, detail: object = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
  disconnect() {
    this.calls.push("disconnect");
    this.fire("disconnect", { clean: true });
  }
  sendCredentials(credentials: object) {
    this.calls.push(`credentials ${JSON.stringify(credentials)}`);
  }
  approveServer() {
    this.calls.push("approve");
  }
  focus() {
    this.calls.push("focus");
  }
}

function start(
  connect: () => Promise<{ close(): void }>,
  options: { granted?: boolean; answer?: object | null; trusted?: boolean } = {},
) {
  const bridge = fakeBridge({ "perm.request": () => ({ granted: options.granted ?? true }) });
  const states: State[] = [];
  const asked: unknown[] = [];
  FakeRfb.last = null;
  const session = startSession({
    bridge,
    sockets: { connect },
    RFB: FakeRfb as never,
    target: {} as Element,
    computer: studio,
    credentials: async (ask) => {
      asked.push(ask);
      return options.answer === undefined ? { password: "fixture" } : (options.answer as never);
    },
    trust: async () => options.trusted ?? false,
    onState: (state) => states.push(state),
  });
  return { bridge, session, states, asked };
}

const channel = () => ({ closed: false, close() {} });

describe("startSession", () => {
  it("asks once for the address when the grants do not cover it, then connects", async () => {
    let tries = 0;
    const { bridge, session } = start(async () => {
      tries += 1;
      if (tries === 1) throw bridgeError("permission_denied");
      return channel();
    });
    await settle();
    expect(bridge.params("perm.request")).toEqual([
      {
        permission: { permission: "net:connect", hosts: ["studio.local:5900"] },
        reason: "To show Studio's screen",
      },
    ]);
    expect(FakeRfb.last?.options).toEqual({ shared: true });
    expect(FakeRfb.last).toMatchObject({
      scaleViewport: true,
      clipViewport: false,
      resizeSession: false,
    });
    FakeRfb.last?.fire("connect");
    expect(session.state).toMatchObject({ phase: "connected", detail: "Connected to Studio." });
    expect(FakeRfb.last?.calls).toEqual(["focus"]);
  });

  it("a refused grant, a silent host and a refused connection end in words", async () => {
    const refused = start(
      async () => {
        throw bridgeError("permission_denied");
      },
      { granted: false },
    );
    await settle();
    expect(refused.session.state.detail).toBe("Not allowed to connect to studio.local.");
    const silent = start(async () => {
      throw bridgeError("timeout");
    });
    await settle();
    expect(silent.session.state.detail).toBe(
      "studio.local did not answer. Is Screen Sharing on, and is the Mac awake?",
    );
    expect(
      failureText(bridgeError("io_error", "Connection refused"), { ...studio, port: 5901 }),
    ).toBe("Could not reach studio.local:5901: Connection refused.");
  });

  it("asks for the sign-in with the user name kept, and a cancel disconnects", async () => {
    const kept = { ...studio, username: "ada" };
    const bridge = fakeBridge();
    const asked: unknown[] = [];
    const session = startSession({
      bridge,
      sockets: { connect: async () => channel() },
      RFB: FakeRfb as never,
      target: {} as Element,
      computer: kept,
      credentials: async (ask) => {
        asked.push(ask);
        return null;
      },
      trust: async () => false,
      onState: () => {},
    });
    await settle();
    FakeRfb.last?.fire("credentialsrequired", { types: ["username", "password"] });
    await settle();
    expect(asked).toEqual([{ types: ["username", "password"], username: "ada" }]);
    expect(FakeRfb.last?.calls).toEqual(["disconnect"]);
    expect(session.state).toMatchObject({ phase: "ended", detail: "Disconnected from Studio." });
  });

  it("sends the answer, and names the refusal when the Mac says no", async () => {
    const { session, states } = start(async () => channel(), {
      answer: { username: "ada", password: "fixture" },
    });
    await settle();
    const rfb = FakeRfb.last as FakeRfb;
    rfb.fire("credentialsrequired", { types: ["username", "password"] });
    await settle();
    expect(rfb.calls).toEqual(['credentials {"username":"ada","password":"fixture"}']);
    expect(states.map((s) => s.phase)).toEqual(["connecting", "signing-in", "connecting"]);
    rfb.fire("securityfailure", { status: 1 });
    rfb.fire("disconnect", { clean: false });
    expect(session.state.detail).toBe(
      "Studio refused the sign-in: the user name or password is wrong.",
    );
  });

  it("approves a server key only when the person trusts it", async () => {
    const key = new Uint8Array([1, 2, 3]);
    const yes = start(async () => channel(), { trusted: true });
    await settle();
    FakeRfb.last?.fire("serververification", { type: "RSA", publickey: key });
    await settle();
    expect(FakeRfb.last?.calls).toEqual(["approve"]);
    const no = start(async () => channel(), { trusted: false });
    await settle();
    FakeRfb.last?.fire("serververification", { type: "RSA", publickey: key });
    await settle();
    expect(FakeRfb.last?.calls).toEqual(["disconnect"]);
    expect(no.session.state.phase).toBe("ended");
    expect(yes.session.state.phase).toBe("connecting");
  });

  it("View only and Fit reach the RFB; an end the server did not mean is said so", async () => {
    const { session } = start(async () => channel());
    await settle();
    const rfb = FakeRfb.last as FakeRfb;
    session.setViewOnly(true);
    session.setFit(false);
    expect(rfb).toMatchObject({ viewOnly: true, scaleViewport: false, clipViewport: true });
    rfb.fire("desktopname", { name: "Studio's Mac" });
    expect(session.state.desktop).toBe("Studio's Mac");
    rfb.fire("disconnect", { clean: false });
    expect(session.state.detail).toBe("The connection to Studio ended.");
  });

  it("a disconnect before the socket opens ends at once and closes the socket when it comes", async () => {
    let open: (c: { close(): void }) => void = () => {};
    const { session } = start(() => new Promise((resolve) => (open = resolve)));
    session.disconnect();
    expect(session.state).toMatchObject({ phase: "ended", detail: "Disconnected from Studio." });
    let closed = false;
    open({ close: () => (closed = true) });
    await settle();
    expect(closed).toBe(true);
    expect(FakeRfb.last).toBeNull();
  });
});
