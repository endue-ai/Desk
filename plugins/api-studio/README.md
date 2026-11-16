# plugins/api-studio

`endue.api-studio`, API Studio: an HTTP client for building, sending and testing API requests, in the
community folder format, on the public SDK only (ADR 0264). Requests have Params (the URL follows them),
Body (JSON, text, XML, form, multipart, file, GraphQL), Headers, Auth (Basic, Bearer, API key, OAuth 2.0
with its token fetched and refreshed, Digest, NTLM, AWS Signature v4, inherited), Vars (captures read from
the response), Scripts, Assert, Tests, Docs and Settings. Responses show Pretty, Tree (paths, capture),
Raw or Preview, filtered by a path, with headers, cookies, a timing waterfall, the timeline, test results
and the console. Collections are folders of plain files (`collection.json`, `environments/*.env.json`,
`folder.json`, `*.request.json`) to keep in Git; secret values, OAuth tokens and cookies stay in the
desk's store. Also: a runner with iterations and data rows, OpenAPI/Swagger/HAR/curl import, code in
eleven languages, an Assistant whose changes apply only on Apply, and commands for agents (`Mod+Alt+A`).

Every request is the curl program through `proc.spawn` without a shell, its whole request on curl's stdin
(`curl -q -K -`), HTTP and HTTPS only; scripts run in a worker made from a blob (the desk allows no eval
and no frames). A collection's scripts run once allowed, files outside it go out after a yes, typed
secrets are offered a move into secret variables, and secrets never follow a redirect to another host.

| Permission | Why |
| --- | --- |
| `proc:spawn` (`curl`) | Send requests with curl, and only curl |
| `brain:ask` | The Assistant: explain, write requests, tests, checks and docs |
| `fs:read`, `fs:write` (`${home}/**`) | Collections' files; bodies sent from files; saved responses and imports |
| `shell:open` (`http`, `https`) | Open a link in the docs |

| File | Purpose |
| --- | --- |
| `ui/model.js`, `url.js`, `vars.js`, `auth.js`, `oauth.js`, `cookies.js` | Requests as data, URL rows, variables, auth, tokens, the jar |
| `ui/curl-*.js`, `engine.js`, `send.js`, `expr.js`, `assert.js` | curl in and out, a request to a response, reading and checking it |
| `ui/collection-fs.js`, `collections*.js`, `environments.js`, `runner.js` | Files on disk, collection edits, environments and secrets, runs |
| `ui/scripts.js`, `script-prelude.js`, `openapi.js`, `har.js`, `yaml.js`, `codegen.js` | Scripts in workers; imports; code |
| `ui/guards.js`, `trust.js`, `file-guard.js`, `literal*.js`, `redirects.js`, `runtime.js`, `secret-names.js` | What a request may carry (ADR 0264) |
| `ui/app.js`, `actions.js`, `studio.js`, `features-*.js`, `commands.js`, `ai-*.js` | State, sending, the window, features, commands, AI |
| `ui/view-*.js`, `section-*.js`, `res-*.js`, `*-pane.js`, `assistant.js` | Side panels, tabs, request sections, the response, other tabs |
| `dev/` | The preview: `serve.mjs` (real curl, a made-up shop API, an example collection), the SDK shim, `shot.mjs` |

```bash
pnpm exec vitest run plugins/api-studio
node plugins/api-studio/dev/serve.mjs   # http://127.0.0.1:4338/?seed, the shop API on :4339; &scheme=light, &brain=demo
```
