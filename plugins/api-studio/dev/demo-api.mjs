// A small made-up shop API for the preview and its screenshots: users, products and orders behind
// a login, plus the odd endpoints a client must handle (redirects, slow answers, any status, HTML,
// XML, an image, a GraphQL query, a server-sent event stream, an echo). Data lives in memory.
//
//   import { startDemoApi } from "./demo-api.mjs"; await startDemoApi(4339);
import { createServer } from "node:http";

const TOKEN = "demo-7f3c9a1e5b2d48c6";
const people = [
  ["Ada Park", "ada.park@example.com", "admin", "Seoul"],
  ["Bo Okafor", "bo.okafor@example.com", "member", "Lagos"],
  ["Chen Silva", "chen.silva@example.com", "member", "Lisbon"],
  ["Dara Novak", "dara.novak@example.com", "owner", "Prague"],
  ["Eli Haddad", "eli.haddad@example.com", "member", "Beirut"],
  ["Femi Kim", "femi.kim@example.com", "member", "Busan"],
  ["Gus Moreau", "gus.moreau@example.com", "viewer", "Lyon"],
  ["Hana Rossi", "hana.rossi@example.com", "member", "Turin"],
  ["Ivo Tanaka", "ivo.tanaka@example.com", "member", "Osaka"],
  ["Jun Weber", "jun.weber@example.com", "admin", "Berlin"],
  ["Kai Yilmaz", "kai.yilmaz@example.com", "member", "Izmir"],
  ["Lea Larsen", "lea.larsen@example.com", "member", "Oslo"],
];
let users = people.map(([name, email, role, city], i) => ({
  id: 1001 + i,
  name,
  email,
  role,
  city,
  active: i % 5 !== 3,
  created_at: new Date(Date.UTC(2026, 0, 3 + i * 9, 9, 30)).toISOString(),
}));
const products = [
  { sku: "LMP-01", name: "Desk lamp", price: 49.0, stock: 120 },
  { sku: "KBD-75", name: "Mechanical keyboard", price: 139.0, stock: 34 },
  { sku: "MUG-12", name: "Stoneware mug", price: 18.5, stock: 410 },
  { sku: "NTB-A5", name: "Dot-grid notebook", price: 12.0, stock: 0 },
];
const orders = [
  {
    id: "ord_8821",
    user_id: 1001,
    total: 188.0,
    status: "shipped",
    items: [
      { sku: "KBD-75", qty: 1 },
      { sku: "LMP-01", qty: 1 },
    ],
  },
  {
    id: "ord_8822",
    user_id: 1004,
    total: 37.0,
    status: "processing",
    items: [{ sku: "MUG-12", qty: 2 }],
  },
];

const LOGO = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="36" fill="#7c6cf0"/><path d="M40 62h62M88 48l14 14-14 14M120 98H58M72 84l-14 14 14 14" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
);

/** @param {import("node:http").IncomingMessage} req */
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/** @param {import("node:http").ServerResponse} res @param {number} status @param {unknown} body @param {Record<string, string | string[]>} [headers] */
function json(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": `req_${Math.random().toString(36).slice(2, 10)}`,
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

const authorized = (/** @type {import("node:http").IncomingMessage} */ req) =>
  req.headers.authorization === `Bearer ${TOKEN}`;

/** @param {number} [port] */
export function startDemoApi(port = 4339) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const raw = await readBody(req);
    /** @type {any} */
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    // A little latency, so timings look like a network's.
    await new Promise((r) => setTimeout(r, 18 + Math.random() * 40));

    if (path === "/v1/health")
      return json(res, 200, { status: "ok", version: "2.4.1", uptime_s: 86_412 });
    if (path === "/v1/auth/login" && req.method === "POST") {
      if (body?.email && body?.password)
        return json(
          res,
          200,
          {
            access_token: TOKEN,
            token_type: "Bearer",
            expires_in: 3600,
            user: { id: 1001, name: "Ada Park" },
          },
          {
            "set-cookie": [
              "session=s_91ab2c; Path=/; HttpOnly; SameSite=Lax",
              "theme=dark; Path=/; Max-Age=31536000",
            ],
          },
        );
      return json(res, 422, {
        error: "validation_failed",
        fields: { email: "required", password: "required" },
      });
    }
    if (path === "/v1/oauth/token" && req.method === "POST")
      return json(res, 200, {
        access_token: TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "read write",
      });
    if (path === "/v1/users" && req.method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 5)));
      const role = url.searchParams.get("role");
      const all = role ? users.filter((u) => u.role === role) : users;
      const data = all.slice((page - 1) * limit, page * limit);
      return json(
        res,
        200,
        {
          data,
          page,
          limit,
          total: all.length,
          next: page * limit < all.length ? `/v1/users?page=${page + 1}&limit=${limit}` : null,
        },
        { link: `</v1/users?page=${page + 1}>; rel="next"`, "x-ratelimit-remaining": "4987" },
      );
    }
    if (path === "/v1/users" && req.method === "POST") {
      if (!body?.name)
        return json(res, 422, { error: "validation_failed", fields: { name: "required" } });
      const user = {
        id: 1001 + users.length,
        name: body.name,
        email: body.email ?? "",
        role: body.role ?? "member",
        city: body.city ?? "",
        active: true,
        created_at: new Date().toISOString(),
      };
      users = [...users, user];
      return json(res, 201, user, { location: `/v1/users/${user.id}` });
    }
    const one = /^\/v1\/users\/(\d+)$/.exec(path);
    if (one) {
      const user = users.find((u) => u.id === Number(one[1]));
      if (!user) return json(res, 404, { error: "not_found", message: `No user ${one[1]}` });
      if (req.method === "DELETE") {
        users = users.filter((u) => u !== user);
        res.writeHead(204);
        return res.end();
      }
      if (req.method === "PATCH" || req.method === "PUT") Object.assign(user, body ?? {});
      return json(res, 200, user, { etag: `"u${user.id}-${user.name.length}"` });
    }
    if (path === "/v1/products") return json(res, 200, { data: products });
    if (path === "/v1/orders") {
      if (!authorized(req))
        return json(
          res,
          401,
          { error: "unauthorized", message: "Send a Bearer token from /v1/auth/login." },
          { "www-authenticate": 'Bearer realm="shop"' },
        );
      return json(res, 200, { data: orders });
    }
    if (path === "/v1/slow") {
      await new Promise((r) =>
        setTimeout(r, Math.min(20_000, Number(url.searchParams.get("ms") ?? 1500))),
      );
      return json(res, 200, { waited_ms: Number(url.searchParams.get("ms") ?? 1500) });
    }
    const status = /^\/v1\/status\/(\d{3})$/.exec(path);
    if (status) return json(res, Number(status[1]), { status: Number(status[1]) });
    if (path === "/v1/redirect") {
      res.writeHead(302, { location: "/v1/users?page=1&limit=3" });
      return res.end();
    }
    if (path === "/v1/echo")
      return json(res, 200, {
        method: req.method,
        path,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body: body ?? raw,
      });
    if (path === "/v1/page") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(
        `<!doctype html><html><head><title>Shop status</title><style>body{font-family:system-ui;margin:32px;color:#222}h1{font-size:22px}.ok{color:#2a7}</style></head><body><h1>Shop status</h1><p class="ok">All systems normal.</p><ul><li>API: 41 ms</li><li>Checkout: 63 ms</li></ul></body></html>`,
      );
    }
    if (path === "/v1/feed.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(
        `<?xml version="1.0" encoding="UTF-8"?><feed><title>Releases</title><entry id="2.4.1"><title>Faster search</title><updated>2026-11-02</updated></entry><entry id="2.4.0"><title>Webhooks</title><updated>2026-10-12</updated></entry></feed>`,
      );
    }
    if (path === "/v1/logo.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      return res.end(LOGO);
    }
    if (path === "/graphql" && req.method === "POST") {
      const q = String(body?.query ?? "");
      if (/users/.test(q))
        return json(res, 200, {
          data: {
            users: users
              .slice(0, Number(body?.variables?.first ?? 3))
              .map(({ id, name, email }) => ({ id, name, email })),
          },
        });
      return json(res, 200, { errors: [{ message: "Unknown field" }] });
    }
    if (path === "/v1/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      let n = 0;
      const timer = setInterval(() => {
        n++;
        res.write(`id: ${n}\nevent: order\ndata: {"id":"ord_${8822 + n}","status":"created"}\n\n`);
        if (n >= 5) {
          clearInterval(timer);
          res.end();
        }
      }, 400);
      req.on("close", () => clearInterval(timer));
      return;
    }
    json(res, 404, { error: "not_found", message: `Nothing at ${req.method} ${path}` });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

export const DEMO_TOKEN = TOKEN;
