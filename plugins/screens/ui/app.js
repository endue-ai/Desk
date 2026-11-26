// The plugin's behaviour without the DOM: the kept computers, one session at a time (session.js) and
// the commands (endue.screens.connect, .disconnect; .open is a manifest alias). The view and the RFB
// class are handed in, so tests drive both.
import {
  loadComputers,
  normalize,
  parseAddress,
  saveComputers,
  upsert,
  remove as without,
} from "./computers.js";
import { endpoint, exactGrant, revoke, revokeComputer } from "./permissions.js";
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
  /** @type {Computer | null} */
  let showing = null;
  const removing = new Map();

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
    if (removing.has(endpoint(computer))) throw new Error("This computer is being removed.");
    list = upsert(list, computer);
    computer = list.find((c) => c.host === computer.host && c.port === computer.port) ?? computer;
    const mine = {};
    active = mine;
    view.computers(list);
    await keep();
    if (
      active !== mine ||
      removing.has(endpoint(computer)) ||
      !list.some((saved) => saved.id === computer.id)
    )
      throw new Error("This connection request is no longer current.");
    session?.disconnect();
    showing = computer;
    view.toggles({ viewOnly: false, fit: true });
    session = startSession({
      bridge,
      sockets,
      RFB,
      target: view.screen,
      computer,
      onGrant(grant) {
        const address = endpoint(computer);
        const departing = removing.get(address);
        if (list.some((saved) => endpoint(saved) === address && saved.id !== departing)) return;
        const id = exactGrant(grant, computer);
        if (id) void revoke(bridge, id).catch((error) => view.status(String(error)));
      },
      credentials: (ask) => view.askCredentials(ask),
      trust: (fingerprint) => view.askTrust(fingerprint),
      onState: (state) => {
        if (active === mine) view.phase(state, computer);
      },
    });
    return computer;
  };

  const live = () => (session && session.state.phase !== "ended" ? session : null);
  const setViewOnly = (/** @type {boolean} */ on) => {
    const current = live();
    if (!current) return null;
    current.setViewOnly(on);
    view.toggles(current);
    return current.viewOnly;
  };
  const setFit = (/** @type {boolean} */ on) => {
    const current = live();
    if (!current) return null;
    current.setFit(on);
    view.toggles(current);
    return current.fit;
  };
  const describe = (/** @type {Computer} */ { id, name, host, port }) => ({ id, name, host, port });

  return {
    connect,

    /** @param {string} id */
    async remove(id) {
      const found = list.find((computer) => computer.id === id);
      if (!found) return;
      const address = endpoint(found);
      if (removing.has(address)) return;
      removing.set(address, id);
      try {
        if (showing?.id === id) session?.disconnect();
        if (!list.some((saved) => saved.id !== id && endpoint(saved) === address))
          await revokeComputer(bridge, found);
        list = without(list, id);
        view.computers(list);
        await keep();
      } catch (error) {
        view.status(error instanceof Error ? error.message : String(error));
      } finally {
        removing.delete(address);
      }
    },

    disconnect() {
      session?.disconnect();
    },

    setViewOnly,
    setFit,
    live,

    computers() {
      return list;
    },

    async start() {
      list = await loadComputers(bridge);
      view.computers(list);
    },

    /** @param {import("@endue-ai/plugin-sdk").PluginCommands} commands */
    wire(commands) {
      commands.on("endue.screens.connect", async (args, invocation) => {
        const raw =
          /** @type {{ id?: unknown, host?: unknown, port?: unknown, name?: unknown, username?: unknown }} */ (
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
        if (typeof raw.id === "string" || invocation?.caller.startsWith("agent:")) {
          const parsed = given.host ? parseAddress(given.host) : null;
          const matches =
            typeof raw.id === "string"
              ? list.filter((saved) => saved.id === raw.id)
              : list.filter(
                  (saved) =>
                    saved.host === parsed?.host &&
                    ((port ?? parsed?.port) === undefined || saved.port === (port ?? parsed?.port)),
                );
          const saved = matches[0];
          if (!saved || matches.length !== 1)
            throw new Error("Give the id or exact address of one saved computer.");
          const computer = await connect(saved);
          return { computer: computer.id, name: computer.name };
        }
        // No address: the form, filled with what was given, waits for the person.
        if (!given.host) {
          view.fill(given);
          return null;
        }
        const computer = await connect(given);
        return { computer: computer.id, name: computer.name };
      });
      commands.on("endue.screens.computers", () => list.map(describe));
      commands.on("endue.screens.state", () => ({
        phase: session?.state.phase ?? "idle",
        computer: showing ? describe(showing) : null,
        viewOnly: live()?.viewOnly ?? false,
        fit: live()?.fit ?? true,
      }));
      commands.on("endue.screens.view-only", (args) => {
        const current = live();
        if (!current) throw new Error("No screen is being shown.");
        const { on } = /** @type {{ on?: boolean }} */ (args ?? {});
        return { viewOnly: setViewOnly(on ?? !current.viewOnly) };
      });
      commands.on("endue.screens.fit", (args) => {
        const current = live();
        if (!current) throw new Error("No screen is being shown.");
        const { on } = /** @type {{ on?: boolean }} */ (args ?? {});
        return { fit: setFit(on ?? !current.fit) };
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
