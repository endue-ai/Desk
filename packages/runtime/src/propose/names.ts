/**
 * The desk's part of a view Eris proposes (ADR 0073, ADR 0102): a free id under `eris.` from its
 * title, the brain that wrote it, for provenance, and the sources the desk has, for the context.
 */
import type { BridgeClient, CatalogConnector, ConnectorInfo } from "@endue-ai/bridge";

const VIEWS = { permission: "view:manage" } as const;
const CONVERSE = { permission: "brain:converse" } as const;

/** An id's last part from a title: ASCII words joined by hyphens, a letter first. */
export function slugOf(title: string, fallback = "view"): string {
  const words = title
    .replace(/\{\{|\}\}/g, " ")
    .replace(/\{([^}|]*)(\|[a-z]+)?\}/g, (_, path: string) => ` ${path.split(".").at(-1) ?? ""} `)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  if (!words) return fallback;
  return /^[a-z]/.test(words) ? words : `${fallback}-${words}`;
}

/** The id for a title: `<prefix>.<slug>`, or `-2` and on when a view has it. */
export async function freeId(
  bridge: BridgeClient,
  prefix: string,
  title: string,
  now: () => number,
): Promise<string> {
  const base = `${prefix}.${slugOf(title)}`;
  for (let n = 1; n < 100; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    const taken = await bridge.call("view.get", { id, scope: VIEWS }).then(
      () => true,
      (error: { code?: string }) => error.code !== "not_found",
    );
    if (!taken) return id;
  }
  return `${base}-${now()}`;
}

/** The brain that wrote it: its model, or where it runs. */
export function brainName(bridge: BridgeClient): Promise<string | undefined> {
  return bridge.call("brain.status", { scope: CONVERSE }).then(
    (status) =>
      status.mode === "local" ? status.model : status.mode === "cloud" ? "cloud" : undefined,
    () => undefined,
  );
}

/**
 * Each connector with instances, its kinds and the fields the catalog knows for them: the catalog
 * lists only what the caller may read (`data:read`, which the runtime does not hold), connector.list
 * every connector and the kinds it brings in.
 */
export function sourcesOf(catalog: CatalogConnector[], listed: ConnectorInfo[]) {
  const ids = [...new Set([...catalog.map((c) => c.id), ...listed.map((c) => c.id)])];
  return ids.flatMap((connector) => {
    const known = catalog.find((c) => c.id === connector);
    const info = listed.find((c) => c.id === connector);
    const instances = info ? info.instances.map((i) => i.instance) : (known?.instances ?? []);
    if (instances.length === 0) return [];
    const kinds: Array<{ kind: string; fields?: string[] }> = (known?.kinds ?? []).map((k) => ({
      kind: k.kind,
      fields: [...k.fields],
    }));
    for (const { kind } of info?.resources ?? [])
      if (!kinds.some((k) => k.kind === kind)) kinds.push({ kind });
    return [{ connector, instances, kinds }];
  });
}
