---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Eris changes explicit desk preferences

## Context and Problem Statement

Changing a theme or enabling Do Not Disturb from the palette works. In conversation, Eris needs
a way to read the current setting and its source, then make the change the person names.

## Decision Drivers

* Reuse the settings window's validation and preference storage.
* Keep commands that delete history or a saved profile behind approval.
* Keep trust, executable selection and safeguards under the person's control.

## Considered Options

* Expose the existing toggles and let Eris infer their current values.
* Offer commands that read the current state and apply explicit values.

## Decision Outcome

Register agent specs for the settings, theme, notification and profile commands. Settings reads
show the effective value, declared default and winning layer. Settings writes validate the
declaration before applying and keeping a personal preference. The protected list in #725 covers
trust sources, executable choices, consent and retention. The terminal environment is omitted
from agent settings reads.

Theme and Do Not Disturb commands take explicit values. Dismissing by notification ID preserves
history. Eris can switch to an existing profile and save the current setup under a new ID. The
save uses the desk folder's rename operation to refuse an existing destination. Eris's profile
results contain names and IDs. Clearing history and removing profiles use action approval.

### Consequences

* Eris can resolve the current layer and adjust routine preferences without a scope prompt.
* Existing palette toggles and pickers remain available to the person.
* The protected settings list needs review when a built-in adds a trust-sensitive setting.

## More Information

- [Issue #725](https://github.com/endue-ai/endue/issues/725)
- [ADR 0368](0368-desk-marks-irreversible-commands.md) and [ADR 0369](0369-eris-runs-safe-desk-commands-without-a-scope-prompt.md)
