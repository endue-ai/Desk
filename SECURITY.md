# Security policy

English · [日本語](docs/i18n/ja/SECURITY.md) · [中文](docs/i18n/zh/SECURITY.md) ·
[Français](docs/i18n/fr/SECURITY.md) · [Deutsch](docs/i18n/de/SECURITY.md) ·
[한국어](docs/i18n/ko/SECURITY.md)

## Reporting a vulnerability

Please do not open a public issue. Report privately, either way:

- Email team@endue.ai with "security" in the subject.
- Or use GitHub's "Report a vulnerability" button on the Security tab of this repository.

Include what you found, how to reproduce it, the affected version and OS, and the impact you expect.

## What happens next

| Step | Target |
| --- | --- |
| Acknowledgement | within 3 business days |
| First assessment and severity | within 10 business days |
| Fix released | as fast as severity requires |
| Public disclosure | when a fix ships, and at the latest 90 days after the report |

We credit reporters in the release notes unless you ask us not to.

## Supported versions

Desk is pre-1.0. Only the latest release on each channel (stable, beta, canary) receives security fixes.

## Scope

In scope: the desktop app, the Rust crates, the TypeScript packages, the built-in plugins, and the bridge
permission model (a plugin or agent reaching a primitive without permission is a vulnerability).

Out of scope: third-party plugins, and services outside this repository (report those to endue at the
same address).

## Threat model

[docs/security/threat-model.md](docs/security/threat-model.md) lists what Desk protects, the attackers it
considers and, for each trust boundary, the mitigation on `main` today or the gap and the issue that
closes it.
