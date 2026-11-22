// CREATE ROLE, ALTER ROLE and memberships from the role dialogs (PG-54): a new role with what it
// takes beyond the defaults and the roles it joins, a role's changed attributes only, a new
// password shown as a fixed mask and run as its SCRAM-SHA-256 verifier (scram.js), PASSWORD NULL to
// remove one, and a membership granted, revoked or its options changed (PostgreSQL 16's ADMIN,
// INHERIT and SET; ADMIN OPTION before 16). A refusal is an Error the dialog shows. Pure.

import { quoteText } from "../../sql/quote.js";
import { q } from "./grants.js";

/**
 * @typedef {import("./model.js").Role} Role
 * @typedef {{ values: Record<string, string>, choices: string[] }} Answers
 * @typedef {{ verifier?: string }} Secret The password's verifier; without it the mask is written.
 */

/** What a typed password is shown as: never its length. */
export const MASK = "'••••••••'";

/** The attributes the dialog offers: its choice, the keyword, the role's field, the default. */
export const ATTRIBUTES = /** @type {const} */ ([
  ["login", "LOGIN", "login", false],
  ["superuser", "SUPERUSER", "superuser", false],
  ["createDb", "CREATEDB", "createDb", false],
  ["createRole", "CREATEROLE", "createRole", false],
  ["replication", "REPLICATION", "replication", false],
  ["bypassRls", "BYPASSRLS", "bypassRls", false],
  ["inherit", "INHERIT", "inherit", true],
]);

/** A role's name as typed, refused where PostgreSQL would refuse it. */
export function roleName(/** @type {string | undefined} */ value) {
  const name = value ?? "";
  if (name.trim() === "") throw new Error("Type the role's name.");
  const bytes = new TextEncoder().encode(name).length;
  if (bytes > 63)
    throw new Error(`PostgreSQL keeps a name of 63 bytes at most: this one has ${bytes}.`);
  if (/^pg_/u.test(name)) throw new Error("Names that start with pg_ are PostgreSQL's own.");
  if (["public", "none"].includes(name.toLowerCase()))
    throw new Error(`${name} is a reserved word for roles: pick another name.`);
  return name;
}

/** CONNECTION LIMIT's number, or undefined when the field is empty. */
function limitOf(/** @type {string | undefined} */ value) {
  const text = (value ?? "").trim();
  if (text === "") return undefined;
  if (!/^-?\d+$/u.test(text) || Number(text) < -1)
    throw new Error("A connection limit is a whole number, or -1 for none.");
  return Number(text);
}

/** The password part: the mask, the verifier, PASSWORD NULL, or nothing. */
function passwordPart(/** @type {Answers} */ a, /** @type {Secret} */ secret) {
  const typed = a.values.password ?? "";
  if (a.choices.includes("clearPassword")) {
    if (typed) throw new Error("Type a password or remove it, not both.");
    return "PASSWORD NULL";
  }
  if (!typed) return "";
  return `PASSWORD ${secret.verifier ? quoteText("postgresql", secret.verifier) : MASK}`;
}

/**
 * The statement of the role dialog: CREATE ROLE for a new role (`before` null), else ALTER ROLE.
 * @param {Role | null} before
 * @param {Answers} answers
 * @param {Secret} [secret]
 */
export function roleScript(before, answers, secret = {}) {
  const on = new Set(answers.choices);
  /** @type {string[]} */
  const words = [];
  for (const [choice, word, field, fallback] of ATTRIBUTES) {
    const wanted = on.has(choice);
    const now = before ? before[field] : fallback;
    if (wanted !== now) words.push(wanted ? word : `NO${word}`);
  }
  const limit = limitOf(answers.values.limit);
  if (limit !== undefined && limit !== (before?.limit ?? -1))
    words.push(`CONNECTION LIMIT ${limit}`);
  const until = (answers.values.until ?? "").trim();
  if (until !== (before?.until ?? "")) {
    if (until) words.push(`VALID UNTIL ${quoteText("postgresql", until)}`);
    else if (before) words.push("VALID UNTIL 'infinity'");
  }
  const password = passwordPart(answers, secret);
  if (password) words.push(password);
  if (!before) {
    const name = roleName(answers.values.name);
    const groups = listOf(answers.values.memberOf);
    const into = groups.length ? ` IN ROLE ${groups.map(q).join(", ")}` : "";
    return `CREATE ROLE ${q(name)}${words.length ? ` WITH ${words.join(" ")}` : ""}${into};`;
  }
  if (words.length === 0) throw new Error(`Nothing changed: ${before.name} is as it was.`);
  return `ALTER ROLE ${q(before.name)} WITH ${words.join(" ")};`;
}

/** Names typed in one field, split at commas, each as typed but trimmed. */
export function listOf(/** @type {string | undefined} */ text) {
  return (text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @typedef {{ admin: boolean, inherit: boolean | null, set: boolean | null }} Options
 * @typedef {{ role: string, member: string, now: Options | null, inheritDefault: boolean, version: number }} MembershipData
 *   `now` is the membership as read (null: none); `inheritDefault` the member's INHERIT attribute.
 */

/**
 * The statements of the membership dialog: `values.role` granted to `values.member`, or revoked
 * (`revoke`), or its options changed (`admin`, `inherit`, `set` among the choices).
 * @param {MembershipData} data
 * @param {Answers} answers
 */
export function membershipScript(data, answers) {
  const role = answers.values.role ?? data.role;
  const member = answers.values.member ?? data.member;
  if (!role.trim()) throw new Error("Name the role to join.");
  if (!member.trim()) throw new Error("Name the member.");
  if (role === member) throw new Error("A role cannot be a member of itself.");
  const on = new Set(answers.choices);
  const sixteen = data.version >= 160000;
  const ref = `${q(role)} TO ${q(member)}`;
  const from = `${q(role)} FROM ${q(member)}`;
  if (on.has("revoke")) {
    if (!data.now) throw new Error(`${member} is not a member of ${role}.`);
    return `REVOKE ${from};`;
  }
  const wanted = {
    admin: on.has("admin"),
    inherit: sixteen ? on.has("inherit") : null,
    set: sixteen ? on.has("set") : null,
  };
  if (!data.now) {
    if (!sixteen) return `GRANT ${ref}${wanted.admin ? " WITH ADMIN OPTION" : ""};`;
    const options = [
      ...(wanted.admin ? ["ADMIN TRUE"] : []),
      ...(wanted.inherit !== data.inheritDefault
        ? [`INHERIT ${wanted.inherit ? "TRUE" : "FALSE"}`]
        : []),
      ...(wanted.set ? [] : ["SET FALSE"]),
    ];
    return `GRANT ${ref}${options.length ? ` WITH ${options.join(", ")}` : ""};`;
  }
  /** @type {string[]} */
  const statements = [];
  /** @type {string[]} */
  const gained = [];
  for (const name of /** @type {const} */ (["admin", "inherit", "set"])) {
    const now = data.now[name];
    const want = wanted[name];
    if (now === null || want === null || now === want) continue;
    if (want) gained.push(name.toUpperCase());
    else statements.push(`REVOKE ${name.toUpperCase()} OPTION FOR ${from};`);
  }
  if (gained.length)
    statements.unshift(
      sixteen
        ? `GRANT ${ref} WITH ${gained.map((g) => `${g} TRUE`).join(", ")};`
        : `GRANT ${ref} WITH ADMIN OPTION;`,
    );
  if (statements.length === 0)
    throw new Error(`Nothing changed: ${member} is in ${role} as it was.`);
  return statements.join("\n");
}
