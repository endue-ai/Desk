---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Browser history and saved Web reads

## Context and Problem Statement

Browser asked for approval for every key, option selection and edit, including actions that only
prepared an input. Its history commands could revisit a submitted form through CEF. Saved Web
files had no assistant read tools.

## Decision Drivers

- Keep the current view, caller and origin permission checks on Browser action calls.
- Classify submission and editing from the actual action presented to the core.
- Inspect and revalidate the destination before traversing native history.
- Read saved files through their existing models and grants.

## Considered Options

- Apply the same approval rule to every action or history step.
- Use the actual input and native history entry to select which steps need review.

## Decision Outcome

Browser's ordinary movement keys, option selection and typing without submit run under the
current site's permission. Click, Enter, Space, Backspace, Delete and type with submit use the
view and site approval from ADR 0375. A separate navigation key command accepts movement or
dismissal keys only. Following a link resolves its live HTTP or HTTPS target and loads it through
the view's browse boundary. Browser can also stop, find and zoom and report loading and history.

CEF exposes whether an entry includes POST data. Its reload checks for a repost and its history
commands traverse the saved Chromium entry. The core asks for approval once per traversal to
such an entry. The CEF UI thread checks the URL, position, completion stamp and POST flag again.
Back and forward send the inspected Chromium history ID explicitly, since the toolbar can skip
entries. If the entry cannot be verified, the command asks the operator to read again.

Web's read and entry commands return saved text or link metadata as source content. The caller
can read the active file or name a path with an existing grant. The reader uses an inert
template for saved HTML and leaves page resources unresolved.

## More Information

- Issue #739 and ADR 0375.
- [CEF navigation snapshot and reload](https://github.com/chromiumembedded/cef/blob/master/libcef/browser/browser_host_base.cc).
- [CEF navigation entry POST flag](https://github.com/chromiumembedded/cef/blob/master/libcef/browser/navigation_entry_impl.cc).
- [Chromium history traversal](https://github.com/chromium/chromium/blob/main/content/browser/renderer_host/navigation_controller_impl.cc).
