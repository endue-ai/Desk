// Secrets typed as they are, without DOM: found in what a file keeps (auth, the URL, headers, the
// query, the body in use, variables), moved by writing {{name}} in their place, emptied for the
// history; and a HAR file's session taken out of its requests into a Recorded environment.
import { describe, expect, it } from "vitest";
import { fromHar } from "../ui/har.js";
import { literalSecrets, withoutLiterals } from "../ui/literals.js";
import { normalize, pair } from "../ui/model.js";

describe("typed secrets", () => {
  it("finds them in auth, headers, the query, form fields and variables, and empties them", () => {
    const req = normalize({
      url: "https://x/?api_key=k1&page=2",
      params: [pair({ key: "api_key", value: "k1" }), pair({ key: "page", value: "2" })],
      headers: [
        pair({ key: "Authorization", value: "Bearer t1" }),
        pair({ key: "X-Token", value: "{{token}}" }),
      ],
      auth: { type: "basic", basic: { username: "ann", password: "pw" } },
      body: { mode: "form", form: [pair({ key: "client_secret", value: "cs" })] },
      vars: { pre: [pair({ key: "token", value: "v1" })], post: [] },
    });
    const found = literalSecrets(req);
    expect(found.map((l) => [l.label, l.value])).toEqual([
      ["Basic auth password", "pw"],
      ["Header Authorization", "t1"],
      ["Query api_key", "k1"],
      ["Body field client_secret", "cs"],
      ["Variable token", "v1"],
    ]);
    for (const l of found) l.put(`{{${l.name}}}`);
    expect(req.headers[0]?.value).toBe("Bearer {{authorization}}");
    expect(req.url).toBe("https://x/?api_key={{apiKey}}&page=2");
    expect(req.vars.pre).toHaveLength(0);
    const kept = withoutLiterals(
      normalize({
        url: "https://u:pw-SECRET@x.test/?api_key=k-SECRET",
        params: [pair({ key: "api_key", value: "k-SECRET" })],
        auth: { type: "bearer", bearer: { token: "b-SECRET" } },
        body: { mode: "text", text: "password=t-SECRET&n=1" },
      }),
    );
    expect(JSON.stringify(kept)).not.toContain("SECRET");
  });

  it("looks only where the file keeps them, and inside JSON bodies and URLs", () => {
    const req = normalize({
      url: "https://ann:pw1@x.test/",
      auth: { type: "inherit", basic: { username: "ann", password: "left" } },
      body: {
        mode: "json",
        json: '{\n  "user": "ann",\n  "password": "pw2",\n  "ref": "{{token}}"\n}',
        form: [pair({ key: "password", value: "old form row" })],
      },
    });
    const found = literalSecrets(req);
    expect(found.map((l) => [l.label, l.value])).toEqual([
      ["Password in the URL", "pw1"],
      ["Body field password", "pw2"],
    ]);
    for (const l of found) l.put(`{{${l.name}}}`);
    expect(req.url).toBe("https://ann:{{password}}@x.test/");
    expect(JSON.parse(req.body.json)).toEqual({
      user: "ann",
      password: "{{password}}",
      ref: "{{token}}",
    });
    const none = normalize({ auth: { type: "none", basic: { username: "a", password: "p" } } });
    expect(literalSecrets(none, { authDefault: "none" })).toEqual([]);
  });

  it("takes a HAR file's session out of its requests", () => {
    const imp = fromHar({
      log: {
        entries: [
          {
            request: {
              method: "POST",
              url: "https://shop.test/api?access_token=at1&page=1",
              headers: [
                { name: "Authorization", value: "Bearer jwt1" },
                { name: "Cookie", value: "sid=s1" },
                { name: "Accept", value: "*/*" },
              ],
              postData: { mimeType: "application/json", text: '{"password":"pw1","n":1}' },
            },
          },
          {
            request: {
              method: "GET",
              url: "https://shop.test/me",
              headers: [{ name: "Authorization", value: "Bearer jwt1" }],
            },
          },
        ],
      },
    });
    const files = JSON.stringify(imp.requests);
    for (const value of ["at1", "jwt1", "sid=s1", "pw1"]) expect(files).not.toContain(value);
    expect(imp.requests[0]?.headers.map((h) => h.value)).toEqual([
      "Bearer {{authorization}}",
      "{{cookie}}",
      "*/*",
    ]);
    expect(imp.requests[1]?.headers[0]?.value).toBe("Bearer {{authorization}}");
    expect(imp.envs[0]?.name).toBe("Recorded");
    const more = fromHar({
      log: {
        entries: [
          {
            request: {
              method: "POST",
              url: "https://ann:pw-SECRET@shop.test/login",
              headers: [],
              postData: {
                mimeType: "application/x-www-form-urlencoded",
                text: "user=ann&password=form-SECRET",
              },
            },
          },
        ],
      },
    });
    expect(JSON.stringify(more.requests)).not.toContain("SECRET");
    expect(more.requests[0]?.body.form.map((r) => [r.key, r.value])).toEqual([
      ["user", "ann"],
      ["password", "{{password2}}"],
    ]);
    expect(more.requests[0]?.auth.basic?.password).toBe("{{password}}");
    expect(imp.envs[0]?.vars.map((v) => [v.key, v.value, v.secret])).toEqual([
      ["accessToken", "at1", true],
      ["authorization", "jwt1", true],
      ["cookie", "sid=s1", true],
      ["password", "pw1", true],
    ]);
  });
});
