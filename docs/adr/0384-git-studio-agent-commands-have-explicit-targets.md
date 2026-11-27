---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Git Studio agent commands have explicit targets

## Context and Problem Statement

Git Studio opened several confirmation and choice dialogs inside commands, including for a rejected
push after the desk had approved it. Most of the history operations were available through the
window only. Eris needs the Git operations as tools, with an answer when Git stops or rejects one.

## Decision Drivers

- Read data through the same Git operations as the window.
- Take destination, strategy and operation inputs through the command registry.
- Review operations that remove work or publish a branch.
- Keep one push limited to its configured remote and its named branch.

## Considered Options

- Use the window's flows for all callers, including the dialogs.
- Register commands with explicit arguments and share Git operations with the window.
- Add a second permission or review protocol for Git Studio.

## Decision Outcome

Use the command registry with explicit inputs. Git errors reach the invoker and the studio refreshes
after a change, including a merge that stops on conflicts. A default pull requires a fast-forward.
A first push takes a configured remote, sets its upstream and pushes only the current branch. A
rejected push reports an error with the next operation to try. The force-with-lease dialog is a
window action.

The desk reviews an agent's push, delete, discard, hard reset and proceed commands. The commands
that erase repository state bind a repository and a named target. Dropping a stash also checks its
commit id against the current index. Hard reset has its own command. Mixed reset refuses files that
have distinct staged and working changes. Reflog recovery uses Git's keep mode and checks the index
before moving HEAD, with a redo stack per repository and branch.

The read commands bound responses. Commit and blame data omit their email fields. Git diff and
blame read without text conversion.

## More Information

- Issue #733, Git Studio tools.
- ADR 0078, review for agent commands.
- ADR 0088, how plugins expose commands and data to agents.
