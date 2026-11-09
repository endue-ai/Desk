// The plugin's behaviour without the DOM: the kept computers, one session at a time (session.js) and
// the commands (endue.screens.connect, .disconnect; .open is a manifest alias). The view and the RFB
// class are handed in, so tests drive both.
import { loadComputers, normalize, saveComputers, upsert, remove as without } from "./computers.js";
import { startSession } from "./session.js";

/**
 * @typedef {import("./computers.js").Computer} Computer
 * @typedef {import("./session.js").State} State
 * @typedef {import("./session.js").RfbClass} RfbClass
 * @typedef {{
 *   screen: Element,
 *   computers(list: Computer[]): void,
 *   phase(state: State, computer: Computer): void,
 *   toggles(on: { viewOnly: boolean, fit: boolean }): void,
 *   fill(raw?: { host?: string, name?: string, port?: number, username?: string }): void,
 *   status(text: string): void,
 *   askCredentials: Parameters<typeof startSession>[0]["credentials"],
 *   askTrust: Parameters<typeof startSession>[0]["trust"],
 * }} View
 * @typedef {Parameters<typeof startSession>[0]["bridge"]} Bridge
 * @typedef {Parameters<typeof startSession>[0]["sockets"]} Sockets
 */

/** @param {{ bridge: Bridge, sockets: Sockets, RFB: RfbClass, view: View }} deps */
export function createScreens({ bridge, sockets, RFB, view }) {
  /** @type {Computer[]} */
  let list = [];
  /** @type {ReturnType<typeof startSession> | null} */
  let session = null;
  /** The session the view follows: an older one's last words do not reach it. */
  let active = {};

  const keep = async () => {
    try {
      await saveComputers(bridge, list);
    } catch (error) {
      view.status(error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Show a computer's screen: kept in the list (by its address), any other session ended first.
   * @param {Parameters<typeof normalize>[0]} raw
   */
  const connect = async (raw) => {
    /** @type {Computer} */
    let computer;
    try {
      computer = normalize(raw);
    } catch (error) {
      view.status(error instanceof Error ? error.message : String(error));
      throw error;
    }
    list = upsert(list, computer);
    computer = list.find((c) => c.host === computer.host && c.port === computer.port) ?? computer;
    view.computers(list);
    await keep();
    session?.disconnect();
    const mine = {};
    active = mine;
    view.toggles({ viewOnly: false, fit: true });
    session = startSession({
      bridge,
      sockets,
      RFB,
      target: view.screen,
      computer,
      credentials: (ask) => view.askCredentials(ask),
      trust: (fingerprint) => view.askTrust(fingerprint),
      onState: (state) => {
        if (active === mine) view.phase(state, computer);
      },
    });
    return computer;
  };

  return {
    connect,

    /** @param {string} id */
    async remove(id) {
      list = without(list, id);
      view.computers(list);
      await keep();
    },

    disconnect() {
      session?.disconnect();
    },

    /** @param {boolean} on */
    setViewOnly(on) {
      session?.setViewOnly(on);
    },

    /** @param {boolean} on */
    setFit(on) {
      session?.setFit(on);
    },

    /** The session on screen, if one is live. */
    live() {
      return session && session.state.phase !== "ended" ? session : null;
    },

    computers() {
      return list;
    },

    async start() {
      list = await loadComputers(bridge);
      view.computers(list);
    },

    /** @param {import("@endue-ai/plugin-sdk").PluginCommands} commands */
    wire(commands) {
      commands.on("endue.screens.connect", async (args) => {
        const raw =
          /** @type {{ host?: unknown, port?: unknown, name?: unknown, username?: unknown }} */ (
            args ?? {}
          );
        const text = (/** @type {unknown} */ value) =>
          typeof value === "string" ? value : undefined;
        const port = typeof raw.port === "number" ? raw.port : undefined;
        const given = {
          host: text(raw.host),
          name: text(raw.name),
          username: text(raw.username),
          ...(port === undefined ? {} : { port }),
        };
        // No address: the form, filled with what was given, waits for the person.
        if (!given.host) {
          view.fill(given);
          return null;
        }
        const computer = await connect(given);
        return { computer: computer.id, name: computer.name };
      });
      commands.on("endue.screens.disconnect", () => {
        const live = session && session.state.phase !== "ended";
        if (!live) throw new Error("No screen is being shown.");
        session?.disconnect();
        return true;
      });
    },
  };
}
