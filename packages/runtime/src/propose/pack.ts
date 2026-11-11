/**
 * Packs in Make with Eris (ADR 0108): "Set up GitHub" (or "깃허브 연결해줘") names a service; the
 * desk finds a pack for it (installed, else in the markets, by its services, name or tags), shows on
 * the proposal card what it brings, and on Apply installs it when the desk lacks it, turns it and its
 * plugins on and switches to its profile. Then it leaves the person in front of the next step: while
 * its first connector has no account, Settings, Connections on it, with what the pack opens waiting
 * on the card (an overlay would cover the token form); else what it opens. Undo takes back what Apply
 * did (`pack-undo.ts`). With no service named, desk.pack.setup asks which (`setUpPack`). Nothing here
 * asks the brain: a pack is data the desk already has.
 */
import type { BridgeClient, MarketListing, PluginInfo, PluginManifest } from "@endue-ai/bridge";
import type { NoticeInput } from "../notify";
import type { Card, CardContent } from "./card";
import { enabledOn, takeBack } from "./pack-undo";

const SCOPE = { permission: "plugin:manage" } as const;
const CONNECTORS = { permission: "connector:manage" } as const;
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
  commands: { run(id: string, args?: unknown): Promise<unknown>; has?(id: string): boolean };
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

/**
 * desk.pack.setup { service }: the pack for the service. With none (the palette runs it so), it asks
 * which through desk.palette.pick and answers at once, as desk.propose does: the palette cannot show
 * its own pick while it waits for the command.
 */
export function setUpPack(
  deps: PackDeps,
  args: unknown,
): Promise<PackOutcome> | { status: "asking" } {
  const { service } = (args ?? {}) as { service?: unknown };
  if (typeof service === "string" && service.trim()) return proposePack(deps, service.trim());
  if (!deps.commands.has?.("desk.palette.pick"))
    throw new Error("Say which service to set up, as in “Set up GitHub”.");
  void askService(deps)
    .then((said) => (said ? proposePack(deps, said) : undefined))
    .catch((error: unknown) =>
      deps.notify({
        caller: "desk",
        title: "That service could not be set up",
        body: error instanceof Error ? error.message : String(error),
        level: "error",
      }),
    );
  return { status: "asking" };
}

/** Which service: a pack on the desk picked, or one typed (a sentence to Eris counts); "" backs out. */
async function askService({ bridge, commands }: PackDeps): Promise<string> {
  const plugins = (await bridge.call("plugin.list", { scope: SCOPE })).plugins;
  const items = plugins
    .filter((p) => p.manifest?.kind === "pack")
    .map((p) => ({
      id: p.manifest?.pack?.services?.[0] ?? p.id,
      label: p.manifest?.name ?? p.id,
      detail: p.manifest?.description ?? "",
    }));
  const picked = await commands
    .run("desk.palette.pick", {
      title: "Set up a service",
      placeholder: "A service, such as GitHub",
      items,
      free: true,
    })
    .catch((error: { code?: string }) => {
      if (error.code === "cancelled") return "";
      throw error;
    });
  const said = typeof picked === "string" ? picked.trim() : "";
  return serviceOf(said) ?? said;
}

/** Propose the pack for `service`, and apply it when the person says so. */
export async function proposePack(deps: PackDeps, service: string): Promise<PackOutcome> {
  const { bridge, card } = deps;
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
  return applyPack(deps, { installed, listing, title, content });
}

interface Found {
  /** The pack on the desk, or none when it comes from `listing`. */
  installed: PluginInfo | undefined;
  listing: MarketListing | undefined;
  title: string;
  content: CardContent;
}

/**
 * Apply: install, turn on, switch, then the next step in front: the token form while the connector
 * has no account (what the pack opens waits on the card), else what it opens. The card says what was
 * applied before the form opens, so closing the form gives the focus back to it.
 */
async function applyPack(deps: PackDeps, found: Found): Promise<PackOutcome> {
  const { bridge, commands, card } = deps;
  const { installed, listing, title, content } = found;
  // What Undo puts back: the profile in force and the plugins on.
  const profiles = (await commands.run("desk.profiles.list").catch(() => undefined)) as
    | { active?: string }
    | undefined;
  const now = (await bridge.call("plugin.list", { scope: SCOPE })).plugins;
  const before = { profile: profiles?.active, on: enabledOn(now) };
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
  const all = (await bridge.call("plugin.list", { scope: SCOPE })).plugins;
  const connector = block.plugins.find(
    (id) => all.find((p) => p.id === id)?.manifest?.kind === "connector",
  );
  const opens = block.opens ?? [];
  const runOpen = (open: (typeof opens)[number]) =>
    open.args === undefined ? commands.run(open.command) : commands.run(open.command, open.args);
  const token = connector !== undefined && !(await hasAccount(bridge, connector));
  if (!token) for (const open of opens) await runOpen(open);
  const titles = opens.map(
    (open) =>
      pack?.manifest?.contributes?.commands?.find((c) => c.id === open.command)?.title ??
      open.command,
  );
  const next = token
    ? opens.map((open, i) => ({
        label: `Open ${titles[i]}`,
        run: () =>
          runOpen(open).catch((error: unknown) =>
            deps.notify({
              caller: "desk",
              title: `${titles[i]} did not open`,
              body: error instanceof Error ? error.message : String(error),
              level: "error",
            }),
          ),
      }))
    : [];
  const id = pack.id;
  const undo = () =>
    takeBack(deps, {
      pack: id,
      title,
      installed: !installed,
      ...(block.profile ? { profile: block.profile } : {}),
      before,
      after: enabledOn(all),
    });
  const form = `${title} is on. Put your token in Settings, Connections`;
  const said = !token
    ? `${title} is set up.`
    : titles.length
      ? `${form}, then open ${titles.join(" and ")} here.`
      : `${form}.`;
  card.applied(content, said, undo, next);
  if (token) await commands.run("desk.connectors.open", { connector });
  return { status: "applied", id };
}

/** Whether `connector` has an account that works; an error or a failed listing counts as none. */
async function hasAccount(bridge: BridgeClient, connector: string): Promise<boolean> {
  const listed = await bridge.call("connector.list", { scope: CONNECTORS }).catch(() => undefined);
  const info = listed?.connectors.find((c) => c.id === connector);
  return info?.instances.some((i) => i.status.state !== "error") ?? false;
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
