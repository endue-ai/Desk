// Every privileges change (PG-54, ADR 0312 and 0330): a read-only connection refused before
// anything is asked, the dialog that shows the exact script, then the script run through
// deps.execute in one transaction under the plugin's guards, its question showing the script as
// the dialog did (a password masked), and the panel read again. A password typed in the dialog
// becomes its SCRAM-SHA-256 verifier here and is dropped; the verifier is in the run's statement
// only. Commands' arguments fill the dialogs; the person still presses Run. No DOM.

import { split } from "../../sql/split.js";
import { t } from "../../strings/index.js";
import { changesOf, matrixOf } from "./acl.js";
import { objectRef } from "./grants.js";
import { defaultPrivilegesOf } from "./kinds.js";
import { defaultKey } from "./model.js";
import {
  DIALOG,
  defaultsModel,
  grantsModel,
  membershipModel,
  newDefaultModel,
  roleModel,
} from "./models.js";
import { dropPolicyModel, policyModel, rowSecurityModel } from "./policy-models.js";
import { scramVerifier } from "./scram.js";
import { answersOf, scriptOf } from "./script.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {ReturnType<typeof import("./controller.js").createPrivileges>} Controller
 * @typedef {import("./models.js").ChangeModel} ChangeModel
 */

/** The matrix a panel's object shows, with the person's added rows. */
export function objectMatrix(/** @type {import("./controller.js").PrivState} */ s) {
  const o = s.object;
  if (!o?.acl) return null;
  return matrixOf(o.acl.entries, o.privileges ?? [], o.acl.owner, s.extra);
}

/**
 * @param {Deps} deps
 * @param {Controller} ctl
 */
export function createChanges(deps, ctl) {
  const refuse = (/** @type {Connection} */ conn) => {
    if (conn.readOnly)
      throw new Error(
        t("features.privileges.changes.isReadOnlyRolesAndPrivileges", { name: String(conn.name) }),
      );
  };

  /** Ask with the model's dialog, run its script, answer the script as shown. */
  const run = async (
    /** @type {Connection} */ conn,
    /** @type {ChangeModel} */ model,
    approved = false,
  ) => {
    refuse(conn);
    const dropping = model.op === "drop-policy";
    const answer = approved && dropping ? {} : await deps.dialog(DIALOG, model);
    if (answer === undefined) throw deps.cancelled(t("features.privileges.changes.notRun2"));
    const a = answersOf(answer);
    const shown = scriptOf(model, a);
    const secret = a.values.password ? { verifier: await scramVerifier(a.values.password) } : {};
    const script = scriptOf(model, a, secret);
    a.values.password = "";
    const done = await deps.execute(conn, script, {
      mode: "transaction",
      shown: split(shown, "postgresql").map((s) => s.text),
      ...(dropping ? { asked: true } : {}),
    });
    const failed = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
    if (failed)
      throw new Error(t("features.privileges.changes.notRun", { message: String(failed.message) }));
    const count = done.statements.length;
    deps.say(
      t("features.privileges.changes.ranOn", {
        value: String(
          count === 1
            ? t("features.privileges.changes.statement")
            : t("features.privileges.changes.statements", { count: String(count) }),
        ),
        name: String(conn.name),
      }),
    );
    return { script: shown };
  };

  /** Re-read every panel of a connection after a change. */
  const reread = async (/** @type {Connection} */ conn) => {
    for (const b of deps.consoles
      .list()
      .filter((x) => x.kind === "privileges" && x.connection === conn.id))
      await ctl.read(b.id).catch(() => {});
  };
  const after = async (/** @type {Connection} */ conn, /** @type {Promise<unknown>} */ work) => {
    const done = await work;
    await reread(conn);
    return done;
  };

  /** Review an object's matrix changes. */
  const reviewObject = async (
    /** @type {string} */ id,
    /** @type {Record<string, unknown>} */ given = {},
  ) => {
    const conn = ctl.connOf(id);
    refuse(conn);
    const s = ctl.stateOf(id);
    const matrix = s ? objectMatrix(s) : null;
    if (!s?.target || !matrix)
      throw new Error(t("features.privileges.changes.pickAnObjectFirstItsPrivileges"));
    const changes = changesOf(matrix, s.edits);
    if (changes.length === 0)
      throw new Error(t("features.privileges.changes.nothingChangedPressACellOf"));
    const as = s.probe?.superuser ? [s.probe.user, s.object.acl.owner] : [s.probe?.user ?? ""];
    const data = {
      said: ctl.said(s.target),
      on: objectRef(s.target, s.object.acl.extra),
      changes,
      entries: s.object.acl.entries,
      matrix,
      as,
    };
    const done = await run(conn, grantsModel(conn, data, given));
    ctl.update(id, { edits: {}, extra: [] });
    await reread(conn);
    return done;
  };

  /** Review the default privileges' changes. */
  const reviewDefaults = async (/** @type {string} */ id) => {
    const conn = ctl.connOf(id);
    const s = ctl.stateOf(id);
    const version = s?.probe?.version ?? 0;
    const groups = (s?.defaults?.entries ?? []).flatMap((entry) => {
      const edits = s?.defaultEdits[defaultKey(entry)] ?? {};
      const matrix = matrixOf(
        entry.entries,
        defaultPrivilegesOf(entry.letter, version),
        entry.owner,
      );
      const changes = changesOf(matrix, edits);
      return changes.length ? [{ entry, changes }] : [];
    });
    if (groups.length === 0)
      throw new Error(t("features.privileges.changes.nothingChangedPressACellOf2"));
    const done = await run(conn, defaultsModel(conn, { groups }));
    ctl.update(id, { defaultEdits: {} });
    await reread(conn);
    return done;
  };

  const roleNames = (/** @type {Connection} */ conn) =>
    deps.consoles
      .list()
      .find((b) => b.kind === "privileges" && b.connection === conn.id)
      ?.privileges?.roles?.roles.map((/** @type {{ name: string }} */ r) => r.name) ?? [];
  const opened = async (/** @type {Connection} */ conn) => (await ctl.show(conn, {})).state;

  /** A new default privileges grant. */
  const newDefault = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ given,
  ) => {
    refuse(conn);
    const s = await opened(conn);
    const schemas = await deps.catalog.schemas(conn).catch(() => []);
    const model = newDefaultModel(
      conn,
      { roles: roleNames(conn), schemas, version: s.probe?.version ?? 0 },
      given,
    );
    return after(conn, run(conn, model));
  };

  /** Create a role (`name` undefined) or change one. */
  const role = async (
    /** @type {Connection} */ conn,
    /** @type {string | undefined} */ name,
    /** @type {Record<string, unknown>} */ given,
  ) => {
    refuse(conn);
    const s = await opened(conn);
    const before = name ? (s.roles?.roles ?? []).find((r) => r.name === name) : null;
    if (name && !before)
      throw new Error(
        t("features.privileges.changes.noRoleOn", { name: String(name), name2: String(conn.name) }),
      );
    return after(
      conn,
      run(conn, roleModel(conn, { before: before ?? null, roles: roleNames(conn) }, given)),
    );
  };

  /** Grant, revoke or change a membership. */
  const membership = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ given,
  ) => {
    refuse(conn);
    const s = await opened(conn);
    const str = (/** @type {string} */ k) =>
      typeof given[k] === "string" ? /** @type {string} */ (given[k]) : "";
    const roleName = str("role");
    const member = str("member");
    const grants = (s.roles?.memberships ?? []).filter(
      (m) => m.role === roleName && m.member === member,
    );
    const now = grants.length
      ? {
          admin: grants.some((g) => g.admin),
          inherit: grants[0]?.inherit === null ? null : grants.some((g) => g.inherit),
          set: grants[0]?.set === null ? null : grants.some((g) => g.set),
        }
      : null;
    const inheritDefault = (s.roles?.roles ?? []).find((r) => r.name === member)?.inherit ?? true;
    const data = {
      role: roleName,
      member,
      now,
      inheritDefault,
      version: s.probe?.version ?? 0,
      roles: roleNames(conn),
    };
    return after(conn, run(conn, membershipModel(conn, data, given)));
  };

  /** The row security of a table the command names, read. */
  const tableOf = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ given,
  ) => {
    // `table` names a table's part to the objects' resolver: pass the table as the name.
    const { table: name, ...rest } = given;
    const target = await ctl.targetOf(conn, { ...rest, kind: "table", name: name ?? given.name });
    const { state } = await ctl.showObject(conn, target);
    const security = state?.object?.security;
    if (!security)
      throw new Error(
        state?.object?.securityError ||
          state?.object?.error ||
          t("features.privileges.changes.itsRowSecurityWasNotRead"),
      );
    return { table: { schema: target.schema, table: target.name }, security };
  };

  /** Create or change a policy. */
  const policy = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ given,
  ) => {
    refuse(conn);
    const { table, security } = await tableOf(conn, given);
    const before = security.policies.find(
      (/** @type {{ name: string }} */ p) => p.name === given.name,
    );
    return after(
      conn,
      run(
        conn,
        policyModel(conn, { table, before, on: security.on, roles: roleNames(conn) }, given),
      ),
    );
  };

  /** Drop a policy. */
  const dropPolicy = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ given,
    approved = false,
  ) => {
    refuse(conn);
    const { table, security } = await tableOf(conn, { ...given, name: undefined });
    const name = typeof given.name === "string" ? given.name : "";
    if (!security.policies.some((/** @type {{ name: string }} */ p) => p.name === name))
      throw new Error(
        t("features.privileges.changes.noPolicyOn", {
          name: String(name),
          schema: String(table.schema),
          table: String(table.table),
        }),
      );
    return after(conn, run(conn, dropPolicyModel(conn, { table, name }), approved));
  };

  /** Turn a table's row security on or off, forced or not. */
  const rowSecurity = async (
    /** @type {Connection} */ conn,
    /** @type {Record<string, unknown>} */ given,
  ) => {
    refuse(conn);
    const { table, security } = await tableOf(conn, given);
    return after(conn, run(conn, rowSecurityModel(conn, { table, before: security }, given)));
  };

  return {
    reviewObject,
    reviewDefaults,
    newDefault,
    role,
    membership,
    policy,
    dropPolicy,
    rowSecurity,
  };
}
