// The preview's example collection: "Shop API", made of the plain files the studio reads and
// writes, aimed at dev/demo-api.mjs. serve.mjs writes it once into its folder; `?seed` in the
// page's address opens it.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const F = "endue.api-studio/1";
let count = 0;
const req = (/** @type {Record<string, unknown>} */ r) => {
  count += 1;
  return { format: F, id: `seed-${count}`, seq: count, ...r };
};

/** @type {Record<string, unknown>} */
const FILES = {
  "collection.json": {
    format: F,
    name: "Shop API",
    auth: { type: "bearer", bearer: { token: "{{token}}" } },
    headers: [{ key: "Accept", value: "application/json" }],
    vars: [
      { key: "apiVersion", value: "v1" },
      { key: "pageSize", value: "5" },
    ],
    docs: "# Shop API\n\nThe made-up shop the preview answers on port 4339.\n\n1. Pick the **Local** environment.\n2. Send **Auth / Log in**: it keeps the token.\n3. Everything else sends it as a Bearer token.",
  },
  "environments/local.env.json": {
    format: F,
    name: "Local",
    color: "green",
    vars: [
      { key: "baseUrl", value: "http://127.0.0.1:4339/{{apiVersion}}" },
      { key: "graphqlUrl", value: "http://127.0.0.1:4339/graphql" },
      { key: "email", value: "ada.park@example.com" },
      { key: "password", value: "", secret: true },
      { key: "token", value: "", secret: true },
    ],
  },
  "environments/staging.env.json": {
    format: F,
    name: "Staging",
    color: "orange",
    vars: [
      { key: "baseUrl", value: "https://staging.shop.example.com/{{apiVersion}}" },
      { key: "email", value: "qa@example.com" },
      { key: "token", value: "", secret: true },
    ],
  },
  "health.request.json": req({
    name: "Health",
    method: "GET",
    url: "{{baseUrl}}/health",
    auth: { type: "none" },
  }),
  "auth/folder.json": { format: F, name: "Auth", seq: 1, auth: { type: "none" } },
  "auth/log-in.request.json": req({
    name: "Log in",
    method: "POST",
    url: "{{baseUrl}}/auth/login",
    body: { mode: "json", json: '{\n  "email": "{{email}}",\n  "password": "{{password}}"\n}' },
    vars: { pre: [], post: [{ key: "token", value: "res.body.access_token" }] },
    asserts: [
      { target: "res.status", op: "eq", value: "200" },
      { target: "res.body.token_type", op: "eq", value: "Bearer" },
    ],
  }),
  "users/folder.json": { format: F, name: "Users", seq: 2 },
  "users/list-users.request.json": req({
    name: "List users",
    method: "GET",
    url: "{{baseUrl}}/users?page=1&limit={{pageSize}}",
    params: [
      { key: "page", value: "1" },
      { key: "limit", value: "{{pageSize}}" },
      { key: "role", value: "admin", on: false, desc: "Only one role" },
    ],
    asserts: [
      { target: "res.status", op: "eq", value: "200" },
      { target: "res.body.data", op: "isArray", value: "" },
      { target: "res.time", op: "lt", value: "500" },
    ],
  }),
  "users/get-user.request.json": req({
    name: "Get a user",
    method: "GET",
    url: "{{baseUrl}}/users/:id",
    pathParams: [{ key: "id", value: "1003" }],
  }),
  "users/create-user.request.json": req({
    name: "Create a user",
    method: "POST",
    url: "{{baseUrl}}/users",
    headers: [{ key: "Idempotency-Key", value: "{{$uuid}}" }],
    body: {
      mode: "json",
      json: '{\n  "name": "{{$randomFullName}}",\n  "email": "{{$randomEmail}}",\n  "role": "member",\n  "city": "{{$randomCity}}"\n}',
    },
  }),
  "users/update-user.request.json": req({
    name: "Rename a user",
    method: "PATCH",
    url: "{{baseUrl}}/users/:id",
    pathParams: [{ key: "id", value: "1003" }],
    body: { mode: "json", json: '{\n  "name": "Chen Silva-Ito"\n}' },
  }),
  "users/delete-user.request.json": req({
    name: "Delete a user",
    method: "DELETE",
    url: "{{baseUrl}}/users/:id",
    pathParams: [{ key: "id", value: "1012" }],
  }),
  "orders/folder.json": { format: F, name: "Orders", seq: 3 },
  "orders/list-orders.request.json": req({
    name: "List orders",
    method: "GET",
    url: "{{baseUrl}}/orders",
  }),
  "orders/order-events.request.json": req({
    name: "Order events",
    method: "GET",
    url: "{{baseUrl}}/events",
    headers: [{ key: "Accept", value: "text/event-stream" }],
  }),
  "catalog/folder.json": { format: F, name: "Catalog", seq: 4, auth: { type: "none" } },
  "catalog/products.request.json": req({
    name: "Products",
    method: "GET",
    url: "{{baseUrl}}/products",
  }),
  "catalog/users-graphql.request.json": req({
    name: "Users (GraphQL)",
    method: "POST",
    url: "{{graphqlUrl}}",
    body: {
      mode: "graphql",
      graphql: {
        query:
          "query Users($first: Int) {\n  users(first: $first) {\n    id\n    name\n    email\n  }\n}",
        variables: '{ "first": 3 }',
      },
    },
  }),
  "catalog/release-feed.request.json": req({
    name: "Release feed (XML)",
    method: "GET",
    url: "{{baseUrl}}/feed.xml",
  }),
  "catalog/status-page.request.json": req({
    name: "Status page (HTML)",
    method: "GET",
    url: "{{baseUrl}}/page",
  }),
};

/** Write the example collection under `root` as `shop-api/`. @param {string} root */
export async function seedShop(root) {
  for (const [name, content] of Object.entries(FILES)) {
    const path = join(root, "shop-api", name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(content, null, 2)}\n`);
  }
}
