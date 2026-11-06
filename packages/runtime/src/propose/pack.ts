/**
 * Packs in Make with Eris (ADR 0108): "Set up GitHub" (or "깃허브 연결해줘") names a service; the
 * desk finds a pack for it (installed, else in the markets, by its services, name or tags), shows on
 * the proposal card what it brings, and on Apply installs it when the desk lacks it, turns it and its
 * plugins on, switches to its profile, runs what it opens and leads to Settings, Connections on its
 * first connector. Nothing here asks the brain: a pack is data the desk already has.
 */
import type { BridgeClient, MarketListing, PluginInfo, PluginManifest } from "@endue-ai/bridge";
import type { NoticeInput } from "../notify";
import type { Card } from "./card";

const SCOPE = { permission: "plugin:manage" } as const;
const SET_UP =
  /^\s*(?:please\s+)?(?:set\s*up|hook\s+up|connect)\s+(?:my\s+|the\s+)?(.+?)\s*[.!?]*\s*$/i;
const KO =
  /^\s*(.+?)\s*(?:을|를)?\s*(?:연결|세팅|셋업|설정)\s*(?:해\s*줘|해줘|해 주세요|해주세요)\s*[.!?]*\s*$/;

/** The service a "set up …" sentence names, lowercased, or null when it names none. */
export function serviceOf(text: string): string | null {
  const said = SET_UP.exec(text) ?? KO.exec(text);
  const service = said?.[1]?.trim().toLowerCase();
  return service ? service : null;
}

export interface PackDeps {
  bridge: BridgeClient;
  commands: { run(id: string, args?: unknown): Promise<unknown> };
  card: Card;
  notify(input: NoticeInput): void;
}

export type PackOutcome =
  | { status: "applied"; id: string }
  | { status: "discarded" }
  | { status: "none" };

/** What a pack is called by: its services, its name, its id's last part, its tags. */
const names = (manifest: PluginManifest | undefined, tags: string[] = []) =>
  [
    ...(manifest?.pack?.services ?? []),
    manifest?.name ?? "",
    manifest?.id
      .split(".")
      .pop()
      ?.replace(/^pack-/, "") ?? "",
    ...tags,
  ].map((n) => n.toLowerCase());

/** Propose the pack for `service`, and apply it when the person says so. */
export async function proposePack(deps: PackDeps, service: string): Promise<PackOutcome> {
  const { bridge, commands, card } = deps;
  const wanted = service.toLowerCase();
  const plugins = (await bridge.call("plugin.list", { scope: SCOPE })).plugins;
  const installed = plugins.find(
    (p) => p.manifest?.kind === "pack" && names(p.manifest).includes(wanted),
  );
  let listing: MarketListing | undefined;
  if (!installed) {
    const market = await bridge.call("market.list", { scope: SCOPE }).catch(() => undefined);
    listing = market?.entries.find(
      (e) =>
        e.entry.kind === "pack" &&
        names(undefined, [e.entry.name, ...(e.entry.tags ?? [])]).includes(wanted),
    );
  }
  if (!installed && !listing) {
    deps.notify({
      caller: "desk",
      title: `No pack sets up ${service} yet`,
      body: "Settings, Market lists the packs there are.",
      level: "info",
    });
    return { status: "none" };
  }
  const title = installed?.manifest?.name ?? listing?.entry.name ?? service;
  const content = {
    kind: "pack" as const,
    title: `${title} pack`,
    rows: rowsOf(installed, plugins, listing),
  };
  const note = installed
    ? `It is on this desk. Apply turns it on.`
    : `From the market${listing?.verified ? "" : " (not verified)"}. Apply installs it.`;
  const choice = await card.preview(content, note);
  if (choice.choice !== "apply") {
    card.close();
    return { status: "discarded" };
  }
  let pack = installed;
  if (!pack && listing) {
    const accept = listing.entry.permissions ?? listing.added;
    await bridge.call("plugin.install", {
      id: listing.entry.id,
      market: listing.market,
      accept,
      scope: SCOPE,
    });
    const after = (await bridge.call("plugin.list", { scope: SCOPE })).plugins;
    pack = after.find((p) => p.id === listing?.entry.id);
  }
  const block = pack?.manifest?.pack;
  if (!pack || !block) return { status: "none" };
  for (const id of [pack.id, ...block.plugins])
    await bridge.call("plugin.setEnabled", { plugin: id, enabled: true, scope: SCOPE });
  if (block.profile) await commands.run("desk.profiles.switch", { id: block.profile });
  for (const open of block.opens ?? [])
    await (open.args === undefined
      ? commands.run(open.command)
      : commands.run(open.command, open.args));
  const all = (await bridge.call("plugin.list", { scope: SCOPE })).plugins;
  const connector = block.plugins.find(
    (id) => all.find((p) => p.id === id)?.manifest?.kind === "connector",
  );
  if (connector) await commands.run("desk.connectors.open", { connector });
  card.applied(content, `${title} is set up.`, () => {});
  return { status: "applied", id: pack.id };
}

/** What the card lists: the connectors and views it brings, what it opens, its layout. */
function rowsOf(
  pack: PluginInfo | undefined,
  plugins: PluginInfo[],
  listing: MarketListing | undefined,
): Array<[string, string]> {
  if (!pack) {
    const entry = listing?.entry;
    return [
      ["Publisher", entry?.publisher ?? ""],
      ["Description", entry?.description ?? ""],
      ...(listing?.added ?? []).map((p): [string, string] => ["Allows", p.permission]),
    ];
  }
  const manifest = pack.manifest;
  const block = manifest?.pack;
  const titleOf = (id: string) => plugins.find((p) => p.id === id)?.manifest?.name ?? id;
  const kindOf = (id: string) => plugins.find((p) => p.id === id)?.manifest?.kind;
  const commandTitle = (id: string) =>
    manifest?.contributes?.commands?.find((c) => c.id === id)?.title ?? id;
  const profile = manifest?.contributes?.profiles?.find((p) => p.id === block?.profile);
  return [
    ...(block?.plugins ?? []).map((id): [string, string] => [
      kindOf(id) === "connector" ? "Connector" : "Brings",
      titleOf(id),
    ]),
    ...(block?.opens ?? []).map((o): [string, string] => ["Opens", commandTitle(o.command)]),
    ...(profile ? [["Layout", profile.name] as [string, string]] : []),
  ];
}
