// Scope transfers for a drop committed by the runtime's own pointer layer.
import type { BridgeClient } from "@endue-ai/bridge";
import { pluginOf } from "../instances";
import { literalFile } from "../policies/files-choices";
import { globMatch } from "../policy";
import type { BrokerDeps } from "./broker";

const manage = { permission: "perm:manage" } as const;

export function dropGrants(
  bridge: BridgeClient,
  builtIn: (id: string) => boolean,
): BrokerDeps["grantDrop"] {
  const readGrants = async (caller: string) => {
    const { grants } = await bridge.call("perm.list", { caller, scope: manage });
    return grants.flatMap(({ grant }) =>
      grant.duration !== "once" && grant.permission.permission === "fs:read"
        ? grant.permission.paths
        : [],
    );
  };
  return async (from, to, paths, rawDestination) => {
    const target = pluginOf(to);
    const source = from === "os" ? undefined : await readGrants(pluginOf(from));
    const granted = [
      ...new Set(
        paths.flatMap((path) => {
          const file = literalFile(path);
          return file && (!source || source.some((pattern) => globMatch(pattern, file)))
            ? [file]
            : [];
        }),
      ),
    ];
    if (!granted.length) return;
    const destination =
      rawDestination &&
      (literalFile(rawDestination) ??
        (/^(?:~|\/|[A-Za-z]:\/)$/.test(rawDestination) ? rawDestination : undefined));
    const writes =
      target === "endue.explorer" &&
      builtIn(target) &&
      destination &&
      (await readGrants(target)).some((pattern) => globMatch(pattern, destination));
    await bridge.call("perm.grant", {
      caller: target,
      permission: { permission: "fs:read", paths: granted },
      scope: manage,
      reason: "The person dropped these files",
    });
    if (writes)
      await bridge.call("perm.grant", {
        caller: target,
        permission: {
          permission: "fs:write",
          paths: [destination, `${destination.replace(/\/$/, "")}/**`],
        },
        scope: manage,
        reason: "The person dropped files into this folder",
      });
  };
}
