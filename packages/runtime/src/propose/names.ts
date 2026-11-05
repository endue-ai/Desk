/**
 * The desk's part of a view Eris proposes, in either language (ADR 0073, ADR 0102): a free id under
 * `eris.` from its title, and the brain that wrote it, for provenance.
 */
import type { BridgeClient } from "@endue-ai/bridge";

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
