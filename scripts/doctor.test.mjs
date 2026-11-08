import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSession, report } from "./doctor.mjs";

const fine = {
  platform: "darwin",
  userInfo: () => ({ username: "me" }),
  lookup: async () => ({ address: "140.82.121.4" }),
  resolve4: async () => ["140.82.121.4"],
};
const fail = async () => {
  throw Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" });
};

test("a healthy session passes", async () => {
  assert.equal((await checkSession(fine)).state, "healthy");
});

test("no network at all is offline, not a broken session", async () => {
  const result = await checkSession({ ...fine, lookup: fail, resolve4: fail });
  assert.equal(result.state, "offline");
  assert.equal(result.ok, true);
});

test("the system resolver failing while DNS answers means macOS ended the session", async () => {
  const result = await checkSession({ ...fine, lookup: fail });
  assert.equal(result.state, "session-ended");
  assert.equal(result.ok, false);
});

test("a user lookup that fails or returns a number means macOS ended the session", async () => {
  const throws = () => {
    throw new Error("uv_os_get_passwd returned ENOENT");
  };
  assert.equal((await checkSession({ ...fine, userInfo: throws })).state, "session-ended");
  const numeric = () => ({ username: "501" });
  assert.equal((await checkSession({ ...fine, userInfo: numeric })).state, "session-ended");
});

test("a lookup that never returns counts as failed", async () => {
  const hang = () => new Promise(() => {});
  const result = await checkSession({ ...fine, lookup: hang, timeoutMs: 20 });
  assert.equal(result.state, "session-ended");
});

test("other platforms are not probed", async () => {
  let probed = false;
  const lookup = async () => {
    probed = true;
  };
  const result = await checkSession({ ...fine, platform: "linux", lookup, resolve4: lookup });
  assert.equal(result.state, "healthy");
  assert.equal(probed, false);
});

test("the report for an ended session says how to recover", async () => {
  const text = report(await checkSession({ ...fine, lookup: fail }));
  assert.match(text, /log in/i);
  assert.match(text, /claude daemon stop --any/);
  assert.match(report(await checkSession(fine)), /healthy/);
});
