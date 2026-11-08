---
status: proposed
date: 2026-11-07
decision-makers: Team endue
---

# The desk signs in to endue ID at auth.endue.ai, through the platform's device flow

## Context and Problem Statement

The person asked the desk to sign in, or to create an account, with endue ID the way the endue.ai web
does. ADR 0089 had the desk sign in with the device authorization grant at `https://id.endue.ai`, as
client `endue-desk` with scope `brain` at `/oauth/device/code` and `/oauth/token`. None of that exists.
endue ID for people is Keycloak 26, realm `endue`, at `https://auth.endue.ai/realms/endue`. Its only
OAuth client, `endue-platform`, is confidential and has no desktop redirect. The web reaches it through
the platform's auth BFF at `https://platform.endue.ai/api/v1/auth/*`, which holds the client secret.
The BFF returns the refresh token only as the `endue_rt` cookie and rotates it on every refresh. Access
tokens live 300 s. How does a native desk sign in today, keep the session, and stay ready for a
desktop client later?

## Decision Drivers

* The same identity and the same hosted pages as the web: sign-in, sign-up with email verification and
  terms, Google
* No client secret on the desk; no change to closed services from this repository
* No token crosses the bridge or reaches a plugin
* A session survives a restart, and every refresh rotates the cookie
* Every failure says what happened and offers a way on

## Considered Options

* The platform's device flow: `POST /api/v1/auth/device/start` with a PKCE S256 challenge, then poll
  `/api/v1/auth/device/token`, take `endue_rt` from `Set-Cookie` and send it back as `Cookie`
* Authorization code with PKCE in the system browser, a loopback redirect and
  `/api/v1/auth/exchange` with a native client header, as endue-for-android does
* A public Keycloak client `endue-desk` with the device grant, called directly
* An email and password form in the desk

## Decision Outcome

Chosen option: "the platform's device flow". It is the only native-capable flow the server offers
today. It needs no Origin header (requests from Rust send none, which the gateway's CSRF check lets
through) and no change to the realm. The person signs in or signs up on endue ID's own pages.

* **Hosts.** `AccountOptions::from_env`: `DESK_ENDUE_PLATFORM_URL` (default
  `https://platform.endue.ai`) and `DESK_ENDUE_AUTH_URL` (default `https://auth.endue.ai/realms/endue`;
  `https://id-dev.endue.ai/realms/endue` when the platform is `https://platform.dev.endue.ai`). The
  desk opens a device page only when it is on the realm's origin.
* **Sign-in.** `account.signIn` answers `signing-in` with the code and opens `verificationUriComplete`
  in the system browser; asked again, it opens the same page. `screen: sign-up` (Create account) adds
  `prompt=create`. That is a hint: Keycloak's device page may ignore it, and its sign-in form links to
  "New to Endue? Create an account" either way. A thread polls at the interval endue names; a
  `slow_down` comes back as a longer interval and a notice.
* **Session.** `<data>/account.json`, mode 0600: the access token, the `endue_rt` cookie, when the
  token was issued and expires, and the profile. A keeper renews the token 90 s before it expires,
  or halfway for a shorter-lived one. One refresh runs at a time. A caller that waited finds the cookie
  rotated and takes the new token.
* **Rules** (the web's `refresher.ts`). A 400 or 401 ends the session, and the desk is signed out with
  `session-expired`. A 403 is `rejected`: the session is kept, with a notice. Anything else is retried
  after 400, 1200 and 3000 ms, then kept with `offline` or `unavailable`. Device-flow errors map from
  the platform's envelope: `DEVICE_CODE_EXPIRED`, `DEVICE_LOGIN_DENIED`, `ACCOUNT_SUSPENDED` and 429.
* **Profile.** `GET /api/v1/users/me` (`display_name`, `email`, `avatar_url`). The picture is fetched
  by the core and handed over as a data: URL, at most 64 KB, because the webview loads no remote
  images. The access token's own claims stand in when the user service cannot answer.
* **Sign-out.** The session is forgotten at once, then `POST /api/v1/auth/logout` with the cookie
  revokes it on the server.
* **Bridge.** `AccountStatus` gains `profile` and `reason`, `AccountSignIn` gains `screen`, and
  account.signIn takes `screen`. No method is added. The runtime words each reason in
  `system/account-copy.ts`, after the web's lines.
* **First run.** Scene 5 (`plugins/onboarding/ui/account.js`) offers the web's entry: Sign in with
  endue ID, Create account, and Skip for now, which stays local and leaves endue's agents out. The
  built-in first run declares `account:manage`, so it calls account.* itself.

### Consequences

* Good, because sign-in and sign-up work today against the running server, with the web's pages.
* Good, because the person confirms a code they can see on both sides, and the desk finishes by itself.
* Bad, because the desk depends on a cookie contract meant for browsers. If the BFF stops sending
  `endue_rt` to non-browser callers, sign-in fails with `failed`.
* Bad, because the session sits in a plain file until the OS keychain (SYS-06), which belongs to
  desk-sys's lane.
* Bad, because Create account cannot open Keycloak's registration page directly, since the device page
  keeps its own flow.

### Target: browser PKCE with a loopback redirect

When the identity team registers a desktop client, the desk moves to the authorization code flow with
PKCE and `state` in the system browser. Sign-in goes to `/protocol/openid-connect/auth` and sign-up to
`/registrations`. The redirect goes to a one-shot `http://127.0.0.1:<port>/callback` (RFC 8252 §7.3),
then `/api/v1/auth/exchange` with a desktop `X-Endue-Client`, and the refresh token comes back in the
body. The bridge does not change: `screen` keeps its meaning, and `signIn` loses only the code. The
server needs these, all in endue-ai: a loopback redirect URI on `endue-platform` (realm JSON and the
running realms), `desktop` accepted as `X-Endue-Client` by identity-service and forwarded by the
gateway, and optionally a body refresh token from the device flow for native clients.

## More Information

Supersedes ADR 0089's endue ID bullet. Code: `crates/desk-core/src/account.rs` and its children in
`account/` (`pkce`, `cookie`, `session`, `bff`, `device`, `keeper`, `profile`), `account_client.rs`,
`core_account.rs`. Runtime: `system/endue-id.ts`, `AccountBar.ts`, `account-copy.ts`. Spec:
`specs/bridge/v0/account.schema.json`. Tests: `crates/desk-core/tests/account_auth.rs` against a fake
BFF on 127.0.0.1. Server facts are cited from endue-ai's identity-service (`auth.controller.ts`,
`keycloak.service.ts`), the api-gateway (`routes/api/v1/auth/index.ts`, `common/origins.ts`) and the
realm (`endue-realm.json`). A manual request to `/api/v1/auth/device/start` on 2026-11-07 returned
`{device_code, user_code, verification_uri: https://auth.endue.ai/realms/endue/device,
verification_uri_complete, expires_in: 600, interval: 5}`.
