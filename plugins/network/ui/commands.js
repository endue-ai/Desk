// The commands (NET-19): what the palette, keys, Eris and agents run. Their titles, descriptions
// and argument schemas are the manifest's; here each answers with data an agent can read. A refusal
// is a failed command whose message is the sentence and what to do.
import { cardLabel } from "./checkup.js";
import { pingText, vendorText } from "./labels.js";
import { portInfo } from "./ports.js";
import { isRefusal, refusalText } from "./refusal.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./devices.js").Device} Device
 * @typedef {(id: string, params?: Record<string, unknown>) => string} T
 */

/** A device as an agent reads it. @param {T} t @param {Device} d */
export function deviceAnswer(t, d) {
  return {
    name: d.name ?? d.mdns ?? null,
    label: cardLabel(t, d),
    kind: d.kind,
    ipAddress: d.ip,
    macAddress: d.mac,
    manufacturer: d.randomMac ? null : d.vendor,
    randomMac: d.randomMac,
    manufacturerText: vendorText(t, d),
    pingMs: d.ping === null ? null : Math.round(d.ping * 10) / 10,
    ping: pingText(t, d),
    status: d.status,
    online: d.online,
    mine: d.mine,
    router: d.gateway,
    thisComputer: d.self,
    firstSeen: d.first,
    lastSeen: d.last,
    openPorts:
      d.open === null ? null : d.open.map((port) => ({ port, service: portInfo(port).service })),
  };
}

/**
 * How a command fails: main.js hands in the SDK's CommandFailed, so the desk hears the refusal's
 * code; without it, an Error with the same message and code.
 * @typedef {(id: string, code: string, message: string) => Error} Failure
 * @type {Failure}
 */
const plainFailure = (id, code, message) =>
  Object.assign(new Error(`${id}: ${code}: ${message}`), { code });

/**
 * @param {{ commands: { on(name: string, handler: (args: unknown) => unknown): () => void } }} ctx
 * @param {App} app @param {T} t @param {Failure} [failure]
 */
export function wireCommands(ctx, app, t, failure = plainFailure) {
  const { net } = app;
  const { state } = net;
  /** @param {string} id @param {(args: Record<string, any>) => unknown} handler */
  const on = (id, handler) =>
    ctx.commands.on(id, async (args) => {
      try {
        return await handler(/** @type {Record<string, any>} */ (args ?? {}));
      } catch (error) {
        if (!isRefusal(error)) throw error;
        const { code, text, todo } = refusalText(t, error);
        throw failure(id, code, `${text} ${todo}`);
      }
    });
  const network = () =>
    state.here
      ? {
          cidr: state.here.cidr,
          router: state.here.gateway.ip,
          interface: state.here.iface,
          administrator: state.admin ?? null,
        }
      : null;
  const raise = () => {
    if (state.refusal) throw state.refusal;
  };
  const ensure = async () => {
    if (!state.scanned) await net.scan();
    raise();
  };

  on("endue.network.scan", async () => {
    const before = new Set(state.devices.map((d) => d.mac));
    await net.scan();
    raise();
    const online = state.devices.filter((d) => d.online);
    return {
      network: network(),
      scanned: state.scanned,
      swept: state.swept,
      online: online.length,
      new: online
        .filter((d) => !before.has(d.mac) && before.size > 0)
        .map((d) => deviceAnswer(t, d)),
    };
  });

  on("endue.network.devices", async (args) => {
    await ensure();
    let devices = state.devices;
    if (args.online !== false) devices = devices.filter((d) => d.online);
    if (typeof args.mac === "string") {
      const d = net.deviceOf(args.mac);
      devices = [d];
      if (args.show === true) await app.act("device", { mac: d.mac });
    }
    return {
      network: network(),
      scanned: state.scanned,
      devices: devices.map((d) => deviceAnswer(t, d)),
    };
  });

  on("endue.network.name", async (args) => {
    await ensure();
    const d = await net.name(String(args.mac ?? ""), {
      name: args.name,
      kind: args.kind,
      mine: args.mine,
    });
    return deviceAnswer(t, d);
  });

  on("endue.network.checkup", () => {
    raise();
    const c = net.checkup();
    return {
      network: network(),
      score: c.score,
      grade: c.grade,
      items: c.items,
      cards: c.cards.map((card) => ({
        text: t(card.key, card.params),
        steps: t(card.steps),
        points: card.points,
        macAddress: card.mac ?? null,
      })),
      unchecked: c.unchecked,
    };
  });

  on("endue.network.check-ports", async ({ mac }) => {
    const device = await net.checkDevice(String(mac ?? ""));
    return deviceAnswer(t, device);
  });

  on("endue.network.channels", async () => {
    const report = await net.readChannels();
    if (state.wifiRefusal) throw state.wifiRefusal;
    const bands = net.channels();
    return {
      ssidsHidden: report?.hidden ?? false,
      joined: report?.current
        ? {
            channel: report.current.channel,
            band: report.current.band,
            width: report.current.width,
            signalDbm: report.current.rssi,
            noiseDbm: report.current.noise,
            security: report.current.security,
          }
        : null,
      bands: bands.map((b) => ({
        band: b.band,
        networks: b.networks.length,
        recommended: b.recommended,
        verdict: t(b.verdict.key, b.verdict.params),
        crowded: b.lanes.filter((l) => l.level === "crowded").map((l) => l.channel),
      })),
    };
  });

  on("endue.network.log", async (args) => {
    const limit =
      typeof args.limit === "number" ? Math.max(1, Math.min(200, Math.floor(args.limit))) : 50;
    const byMac = new Map(state.devices.map((d) => [d.mac, d]));
    return {
      network: network(),
      entries: [...state.log]
        .reverse()
        .slice(0, limit)
        .map((e) => {
          const d = e.mac ? byMac.get(e.mac) : undefined;
          return {
            at: e.at,
            kind: e.kind,
            device: d ? cardLabel(t, d) : null,
            ipAddress: e.ip ?? null,
            macAddress: e.mac ?? null,
            count: e.count ?? null,
          };
        }),
    };
  });
}
