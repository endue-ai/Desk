# plugins/api-studio

`endue.api-studio`, API Studio: an HTTP client for building, sending and testing API requests, in the
community folder format, on the public SDK only. A request has Params (the URL follows them), Body
(JSON, text, XML, a form, a multipart form, a file, GraphQL), Headers, Auth (Basic, Bearer, API key,
OAuth 2.0, Digest, NTLM, AWS Signature v4, or inherited) and Settings. `{{variables}}` are coloured by
whether they resolve, show their value under the pointer and complete after `{{`. The response shows
its status, time and size; the body pretty, raw or previewed, with find; headers, cookies, and a
timeline with the phases' waterfall, the connection, the certificate and what curl saw.

Every request is the curl program through `proc.spawn` without a shell (`ui/engine.js`): curl reads
its whole request from stdin (`curl -q -K -`, `ui/curl-config.js`), so URLs, headers and secrets never
appear in a process's arguments; stdout carries the header blocks and the body, stderr the verbose
timeline and curl's JSON report (`ui/curl-parse.js`).

| Permission | Why |
| --- | --- |
| `proc:spawn` (`curl`) | Send requests with curl, and only curl |
| `fs:read`, `fs:write` (`${home}/**`) | Read files a body sends; save responses where the person chooses |

| File | Purpose |
| --- | --- |
| `ui/model.js`, `url.js`, `vars.js`, `auth.js` | Requests as data; the URL and its rows; variables; auth on the wire |
| `ui/curl-*.js`, `engine.js`, `send.js` | curl's config and output; curl over the bridge; a request in, a response out |
| `ui/app.js`, `actions.js`, `studio.js` | State without DOM; what sending, saving and closing do; the window |
| `ui/view-*.js`, `section-*.js`, `res-*.js` | The side, the tabs, the URL bar, the request's sections, the response |
| `ui/var-field.js`, `code-editor.js`, `kv-table.js`, `highlight.js`, `menu.js` | Fields, the editor, tables, syntax colours, menus and dialogs |
| `dev/` | The preview: `serve.mjs` (real curl, a made-up shop API), the SDK shim, `shot.mjs` |

```bash
pnpm exec vitest run plugins/api-studio
node plugins/api-studio/dev/serve.mjs     # http://127.0.0.1:4338/, the shop API on :4339; ?scheme=light
```
