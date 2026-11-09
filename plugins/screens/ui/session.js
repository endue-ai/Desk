// One look at another computer's screen: the net:connect grant asked for once when the plugin's
// grants do not cover the address, the socket opened (channel.js), noVNC's RFB drawing into `target`,
// the sign-in the other Mac asks for (a macOS user and password for Screen Sharing, or the VNC
// password), and the states it goes through. The RFB class is handed in, so tests drive a fake one.
import { scopeOf } from "./channel.js";
import { addressOf } from "./computers.js";

/**
 * @typedef {import("./computers.js").Computer} Computer
 * @typedef {"connecting" | "signing-in" | "connected" | "ended"} Phase
 * @typedef {{ phase: Phase, detail: string, desktop?: string }} State
 * @typedef {{ types: string[], username?: string }} CredentialAsk
 * @typedef {{ username?: string, password?: string }} Credentials
 * @typedef {EventTarget & {
 *   scaleViewport: boolean, clipViewport: boolean, resizeSession: boolean, viewOnly: boolean,
 *   focusOnClick: boolean, showDotCursor: boolean, background: string,
 *   disconnect(): void, sendCredentials(credentials: Credentials): void, approveServer(): void,
 *   focus(): void,
 * }} Rfb
 * @typedef {new (target: Element, channel: unknown, options: object) => Rfb} RfbClass
 * @typedef {{
 *   bridge: { call(method: string, params: unknown): Promise<any> },
 *   sockets: { connect(target: { host: string, port: number }): Promise<{ close(): void }> },
 *   RFB: RfbClass,
 *   target: Element,
 *   computer: Computer,
 *   credentials(ask: CredentialAsk): Promise<Credentials | null>,
 *   trust(fingerprint: string): Promise<boolean>,
 *   onState(state: State): void,
 *   viewOnly?: boolean,
 *   fit?: boolean,
 * }} Options
 */

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/** Why a connection did not open, in words. @param {unknown} error @param {Computer} c */
export function failureText(error, c) {
  const where = addressOf(c);
  switch (codeOf(error)) {
    case "permission_denied":
      return `Not allowed to connect to ${where}.`;
    case "timeout":
      return `${where} did not answer. Is Screen Sharing on, and is the Mac awake?`;
    case "io_error":
      return `Could not reach ${where}: ${error instanceof Error ? error.message : "no answer"}.`;
    default:
      return `Could not connect to ${where}: ${error instanceof Error ? error.message : String(error)}.`;
  }
}

/** A key's SHA-256, as colon-separated hex pairs, for the person to compare. @param {Uint8Array} key */
export async function fingerprintOf(key) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", /** @type {BufferSource} */ (key)),
  );
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join(":");
}

/**
 * Open the socket, asking once for the grant when the plugin's grants do not cover the address.
 * @param {Options} options
 */
async function open({ bridge, sockets, computer }) {
  const target = { host: computer.host, port: computer.port };
  try {
    return await sockets.connect(target);
  } catch (error) {
    if (codeOf(error) !== "permission_denied") throw error;
  }
  const asked = await bridge
    .call("perm.request", {
      permission: scopeOf(computer.host, computer.port),
      reason: `To show ${computer.name}'s screen`,
    })
    .catch(() => ({ granted: false }));
  if (!asked.granted) throw Object.assign(new Error("refused"), { code: "permission_denied" });
  return sockets.connect(target);
}

/**
 * Start a session; it reports its states through `onState` until `ended`.
 * @param {Options} options
 */
export function startSession(options) {
  const { RFB, target, computer, onState } = options;
  /** @type {Rfb | null} */
  let rfb = null;
  let stopped = false;
  let viewOnly = options.viewOnly ?? false;
  let fit = options.fit ?? true;
  /** What the other Mac said when it refused the sign-in, for the end's words. */
  let refusal = "";
  /** @type {State} */
  let state = { phase: "connecting", detail: `Connecting to ${computer.name}…` };
  const report = (/** @type {Partial<State> & { phase: Phase, detail: string }} */ next) => {
    if (state.phase === "ended") return;
    state = { ...state, ...next };
    onState(state);
  };
  const end = (/** @type {string} */ detail) => report({ phase: "ended", detail });
  report(state);

  const listen = (/** @type {Rfb} */ r) => {
    const on = (/** @type {string} */ name, /** @type {(detail: any) => void} */ handler) =>
      r.addEventListener(name, (event) => handler(/** @type {CustomEvent} */ (event).detail ?? {}));
    on("connect", () => {
      report({ phase: "connected", detail: `Connected to ${computer.name}.` });
      r.focus();
    });
    on("desktopname", ({ name }) => {
      if (typeof name === "string" && name) report({ ...state, desktop: name });
    });
    on("credentialsrequired", async ({ types }) => {
      report({ phase: "signing-in", detail: `${computer.name} asks you to sign in.` });
      const ask = { types: Array.isArray(types) ? types : ["password"] };
      const answer = await options.credentials(
        computer.username ? { ...ask, username: computer.username } : ask,
      );
      if (stopped || !rfb) return;
      if (!answer) {
        stopped = true;
        rfb.disconnect();
        return;
      }
      report({ phase: "connecting", detail: `Signing in to ${computer.name}…` });
      rfb.sendCredentials(answer);
    });
    on("serververification", async ({ publickey }) => {
      const trusted = await options.trust(await fingerprintOf(publickey));
      if (stopped || !rfb) return;
      if (trusted) rfb.approveServer();
      else {
        stopped = true;
        rfb.disconnect();
      }
    });
    on("securityfailure", ({ reason }) => {
      refusal =
        typeof reason === "string" && reason ? reason : "the user name or password is wrong";
    });
    on("disconnect", ({ clean }) => {
      rfb = null;
      if (refusal) end(`${computer.name} refused the sign-in: ${refusal}.`);
      else if (stopped || clean) end(`Disconnected from ${computer.name}.`);
      else end(`The connection to ${computer.name} ended.`);
    });
  };

  const apply = () => {
    if (!rfb) return;
    rfb.scaleViewport = fit;
    rfb.clipViewport = !fit;
    rfb.viewOnly = viewOnly;
  };

  void open(options).then(
    (channel) => {
      if (stopped) {
        channel.close();
        end(`Disconnected from ${computer.name}.`);
        return;
      }
      // Shared: whoever already looks at that screen stays connected.
      rfb = new RFB(target, channel, { shared: true });
      rfb.resizeSession = false;
      rfb.focusOnClick = true;
      rfb.showDotCursor = true;
      // The page's own background (a token) shows around a scaled screen, not noVNC's grey.
      rfb.background = "transparent";
      apply();
      listen(rfb);
    },
    (error) => end(failureText(error, computer)),
  );

  return {
    get state() {
      return state;
    },
    get viewOnly() {
      return viewOnly;
    },
    get fit() {
      return fit;
    },
    /** @param {boolean} on */
    setViewOnly(on) {
      viewOnly = on;
      apply();
    },
    /** @param {boolean} on */
    setFit(on) {
      fit = on;
      apply();
    },
    focus() {
      rfb?.focus();
    },
    disconnect() {
      if (state.phase === "ended") return;
      stopped = true;
      if (rfb) rfb.disconnect();
      else if (state.phase === "connecting") end(`Disconnected from ${computer.name}.`);
    },
  };
}
