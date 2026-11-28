---
status: accepted
date: 2026-11-28
decision-makers: Team endue
---

# The app's identifier is ai.endue.desktop

## Context and Problem Statement

ADR 0333 renamed the product to **endue** and kept the identifier `ai.endue.desk`, so that existing
installations would upgrade in place and reopen their data. The identifier names the bundle, the data
folder, the socket, the keychain service, the login item and the Windows ProgID. 0.5.0 is the first
release signed with the Developer ID and the first that can update itself. No released build can
update itself yet, and the only installations are the team's own. Should the identifier still name the
old product?

## Decision Drivers

- The identifier outlives the name: once a signed, self-updating build ships, changing it splits every
  installation into two apps with two data folders and two sets of OS permissions.
- The identifier should say which endue it is, so the desktop app can sit beside a mobile app.
- Nobody has to be carried over today.

## Considered Options

- Keep `ai.endue.desk`, as ADR 0333 decided.
- `ai.endue.desktop`.
- `ai.endue.app`: short, but a mobile app is an app too.
- `ai.endue.endue`: repeats the company in the product.

## Decision Outcome

Chosen option: `ai.endue.desktop`, before the first signed release. It replaces `ai.endue.desk`
everywhere it is the app's identity: `CFBundleIdentifier` and the helpers' identifiers
(`ai.endue.desktop.helper[.x]`), the URL scheme name, the data folder and `desk.sock` in it, the
keychain service, the login item, notifications, the CLI's `open -b`, and the Windows ProgID
`ai.endue.desktop.file`. This supersedes the identifier part of ADR 0333's first two rows.

Unchanged: the display name **endue**, the executable and package names (`endue-desk`), `~/.desk`, the
`desk` command and the Windows upgrade code. Container labels (`ai.endue.desk.created-by`,
`ai.endue.desk.test`) are label names, not the app's identity, and stay as they are.

### Consequences

- Good: the identifier matches the product, and the first signed release carries the one it will keep.
- Bad: a build from before this change is a different app. Its data folder, keychain entries, login
  item and the OS permissions granted to it (screen recording, accessibility) are not carried over. The
  team reinstalls, signs in again and grants the permissions again; the old data folder can be copied
  into `ai.endue.desktop` by hand.
- Bad: earlier ADRs still name `ai.endue.desk`; they record what was decided then.
