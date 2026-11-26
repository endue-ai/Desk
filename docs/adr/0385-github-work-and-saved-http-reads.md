---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# GitHub work and saved HTTP reads

## Context and Problem Statement

The GitHub connector already syncs work into the local index. API Studio can send and run
requests, and the approval flag on its send command applies to every HTTP method.
Eris needs those reads, plus ways to prepare requests and save them under the person's controls.

## Decision Drivers

- The work lookup reads the existing local index with the GitHub scope.
- The safe send validates the effective HTTP request and keeps normal secret and redirect handling.
- A writable native destination is sufficient for a new collection.

## Considered Options

- Read the connector index or run a GitHub search again for each tool call.
- Add a separate API Studio command for safe saved reads or decide the send approval by method.
- Keep destination folder approval in API Studio or use the desk's write destination dialog.

## Decision Outcome

The desk registers the GitHub command while the HTTP connector is enabled. The tool reads only
its synced tasks, using the existing representation of issues and pull requests, and returns a
bounded summary. The board and timeline keep their manifest aliases and now accept agent calls.

The API Studio manifest keeps approval for general send and collection runs. A separate command
resolves a unique saved request and checks for GET, HEAD or OPTIONS again after preparation.
It rejects a prepared body or method override and uses the reviewed send when OAuth renewal is
needed. Script trust, redirects and file controls remain part of the shared send path. Read
commands return redacted request, response and code data without running a request.

An agent can save a draft to an open collection using its existing save and secret prompts.
Imports and new collections choose a writable destination through the desk. Calls waiting for
the same folder grant share the prompt, and a later retry can ask again.

## More Information

- Issue #734, GitHub and API Studio tools.
- ADR 0106, HTTP connectors.
- ADR 0264, API Studio.
- ADR 0374, dialog grants for selected files and folders.
