// PostgreSQL parameters as bound values (PG-21, ADR 0353): placeholders numbered in the order of
// first use, values beside the text and never in it, `=expression` put in as SQL, NULL as null, a
// value that does not fit its type refused, and the server's position mapped back.
import { describe, expect, it } from "vitest";
import { bind, misfit, numbered, origin, placed, valueOf, wireOf } from "../ui/editor/bind.js";
import { paramsOf } from "../ui/editor/params.js";
import { split } from "../ui/sql/split.js";

const one = (text: string) => {
  const [statement] = split(text, "postgresql");
  if (!statement) throw new Error("no statement");
  return { statement, params: paramsOf(statement.text, "postgresql") };
};

describe("numbered", () => {
  it("numbers :name, $n and repeats in the order of first use, one number per name", () => {
    const { statement, params } = one("select :b, $1, :b, :a from t where x = '$9' and y::int = :a");
    const sent = numbered(statement.text, params);
    expect(sent.text).toBe("select $1, $2, $1, $3 from t where x = '$9' and y::int = $3");
    expect(sent.keys).toEqual([":b", "$1", ":a"]);
  });

  it("maps the server's position in the sent text back to the person's", () => {
    const { statement, params } = one("select :long_name, nope from t");
    const sent = numbered(statement.text, params);
    const at = sent.text.indexOf("nope");
    expect(origin(sent.shifts, at)).toBe(statement.text.indexOf("nope"));
    expect(origin(sent.shifts, sent.text.indexOf("$1") + 1)).toBe(statement.text.indexOf(":long"));
    const outcome = placed({ ...statement, shifts: sent.shifts }, { error: { position: at } });
    expect(outcome.error?.position).toBe(statement.text.indexOf("nope"));
  });
});

describe("bind", () => {
  it("sends values beside the text, never in it, with their types", () => {
    const { statement, params } = one("insert into t values (:a, :b, :c, :d)");
    const injected = "'); drop table t; --";
    const answers = { ":a": "it's", ":b": "NULL", ":c": injected, ":d": "null " };
    const bound = bind(statement, params, answers, { ":a": 25, ":b": 23, ":c": 25 });
    expect(bound.text).toBe("insert into t values ($1, $2, $3, $4)");
    expect(bound.params).toEqual(["it's", null, injected, null]);
    expect(bound.paramTypes).toEqual([25, 23, 25, 0]);
    expect(bound.text).not.toContain("drop");
    expect(wireOf(bound)).toEqual({ params: bound.params, paramTypes: bound.paramTypes });
    expect(wireOf(statement)).toEqual({});
  });

  it("puts an =expression in as SQL and numbers the rest after it", () => {
    const { statement, params } = one("select * from t where at > :since and id = :id and at < :since");
    const bound = bind(statement, params, { ":since": "=now() - interval '1 day'", ":id": "7" }, {});
    expect(bound.text).toBe(
      "select * from t where at > now() - interval '1 day' and id = $1 and at < now() - interval '1 day'",
    );
    expect(bound.params).toEqual(["7"]);
    expect(bound.keys).toEqual([":id"]);
  });

  it("reads NULL in any case as null and anything else as typed", () => {
    expect(valueOf("NULL")).toBeNull();
    expect(valueOf(" Null ")).toBeNull();
    expect(valueOf("NULLS")).toBe("NULLS");
    expect(valueOf("")).toBe("");
  });
});

describe("misfit", () => {
  it("refuses what does not fit integer, numeric, boolean, uuid and json types, with the reason", () => {
    expect(misfit("abc", 23)).toMatch(/integer takes a whole number/u);
    expect(misfit("2147483648", 23)).toMatch(/int4 holds|integer holds/u);
    expect(misfit("2147483647", 23)).toBe("");
    expect(misfit(" -12 ", 21)).toBe("");
    expect(misfit("1_000", 20)).toBe("");
    expect(misfit("1.5", 20)).toMatch(/bigint/u);
    expect(misfit("1e3", 1700)).toBe("");
    expect(misfit("NaN", 701)).toBe("");
    expect(misfit("one", 1700)).toMatch(/numeric takes a number/u);
    expect(misfit("yes", 16)).toBe("");
    expect(misfit("maybe", 16)).toMatch(/boolean/u);
    expect(misfit("{A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11}", 2950)).toBe("");
    expect(misfit("a0ee", 2950)).toMatch(/uuid/u);
    expect(misfit('{"a": [1, null]}', 3802)).toBe("");
    expect(misfit("{a: 1}", 114)).toMatch(/json takes a JSON value/u);
  });

  it("leaves NULL, other types and an unknown type to the server", () => {
    expect(misfit(null, 23)).toBe("");
    expect(misfit("not a date", 1082)).toBe("");
    expect(misfit("anything", 0)).toBe("");
    expect(misfit("{1,2}", 1007)).toBe("");
  });
});
