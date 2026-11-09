/**
 * The stub core's perm.grant and perm.revoke, as desk-core answers them: perm.grant (ADR 0131) gives
 * another caller a permission for the person under perm:manage, answering with a lasting grant that
 * already covers it instead of a new one; perm.revoke gives one's own back, or anyone's with the scope.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { CallerGrant, Grant, GrantChange, GrantDuration, Permission } from "./generated";

interface GrantsDeps {
  grants: CallerGrant[];
  check(caller: string | undefined, scope: Permission): void;
  holds(caller: string, permission: Permission): CallerGrant | undefined;
  give(caller: string, permission: Permission, duration: GrantDuration): Grant;
  take(grantId: string, change: GrantChange): void;
  me(caller: string | undefined): string;
}

export type GrantsServed = "perm.grant" | "perm.revoke";

export function stubGrants(deps: GrantsDeps): Required<Pick<StubHandlers, GrantsServed>> {
  const { grants, check, holds, give, take, me } = deps;
  return {
    "perm.grant": ({ caller: to, permission, duration = "session", scope }, caller) => {
      check(caller, scope);
      const held = holds(to, permission);
      if (held && held.grant.duration !== "once") return { grant: structuredClone(held.grant) };
      return { grant: structuredClone(give(to, permission, duration)) };
    },
    "perm.revoke": ({ grantId, scope }, caller) => {
      if (scope) check(caller, scope);
      const held = grants.find((g) => g.grant.grantId === grantId);
      if (!held || (!scope && held.caller !== me(caller)))
        throw new StubError("not_found", `${me(caller)}'s grant ${grantId} does not exist`);
      take(grantId, "revoked");
      return {};
    },
  };
}
