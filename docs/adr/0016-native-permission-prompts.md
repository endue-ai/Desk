---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# Permission prompts are native dialogs, bounded by the manifest

## Context and Problem Statement

Every primitive is denied until the person grants it (`specs/bridge/v0`, "Deny by default"), and
`perm.request` is how a caller asks. Until now the core's prompter was `RefuseAll`, so every request was
refused and only built-in plugins (granted from their manifests at install) could do anything. Who draws
the prompt, what may a plugin ask for, and how do we keep a plugin from wearing the person down?

## Decision Drivers

* A plugin must not be able to draw or imitate the prompt (UI plugins are web pages on the desk)
* The text the person reads must come from the core, not from the caller
* A plugin may never be granted more than its manifest declares (`specs/plugin/v0`: "everything the
  plugin may ask for")
* Asking again after a refusal must not turn into a pressure loop
* A prompt waiting for an answer must not freeze the app

## Considered Options

* A native dialog shown by the Tauri shell (tauri-plugin-dialog)
* A prompt surface drawn by the web runtime
* A trusted overlay webview owned by the shell

## Decision Outcome

Chosen option: "A native dialog shown by the Tauri shell". `NativePrompter` (apps/desk) implements the
core's `Prompter`; only its Allow button grants, and closing or Escape refuses. The core decides what is
shown: the caller's manifest name and id, a summary of the permission written by the core
(`desk_core::describe`), and the caller's reason, cut to 300 characters and cleaned of control
characters, quoted as the caller's words.

Rules in the core, before any prompt:

* A grant that already covers the request answers at once, without a prompt.
* A plugin caller must be installed, ready and enabled, and one of its manifest permissions must cover
  the request; otherwise the request is refused without a prompt. The runtime (`desk`) has no manifest
  and may ask for anything.
* One prompt at a time. After a refusal, asking again for the same permission or a wider one is refused
  without a prompt for the rest of the session; a narrower request is still shown.

Bridge calls now run on a blocking thread (`bridge_call` is async), so a prompt or a slow call blocks
only its own call.

### Consequences

* Good, because web content cannot fake or cover the prompt, and the person sees the core's words.
* Good, because the manifest is a hard ceiling: a plugin cannot talk its way past what it declared.
* Bad, because a native dialog looks different on each OS and cannot show rich detail (path lists,
  icons). A trusted overlay can replace it later behind the same `Prompter` trait.
* Bad, because the dialog's default button is Allow on every OS; a prompt that appears while the person
  is typing could be accepted with Enter. Refusals being remembered limits repeated attempts.
* Grants still live in memory: after a restart plugins ask again. Persisting grants is separate work.

## More Information

`crates/desk-core/src/core_perm.rs`, `crates/desk-core/src/prompt.rs`, `apps/desk/src-tauri/src/prompt.rs`;
tests in `crates/desk-core/tests/prompt.rs`. Design: `docs/ko/desk-structure.md` principle 6 ("들여다보기
전에 묻는다").
