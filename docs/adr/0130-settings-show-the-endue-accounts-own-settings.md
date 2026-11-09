---
status: accepted
date: 2026-11-09
decision-makers: Team endue
---

# Settings show the endue account's own settings, read and changed on endue

## Context and Problem Statement

Signed in to endue ID (ADR 0111), the desk showed only the account's name, email and picture, in the
account popover. endue.ai's settings show more of the same account: its Account tab holds the profile
(name, picture address, email, user id, status, join date) and its General tab the display language,
the time zone and which notifications reach the person's endue.ai inbox. The person asked for those
basic settings to be set up and shown in Desk once it is signed in. Where do they live on the desk, who
keeps them, and how does a change reach endue.ai?

## Decision Drivers

* endue.ai and the desk show the same values: one truth, on endue, nothing mirrored on the desk
* The token stays in the core (ADR 0111, ADR 0122); no plugin and no frame sees it
* Closed services only through a written contract and a client crate, testable without the network
* A part endue does not answer for does not hide the rest
* No setting endue.ai keeps only in a browser (its theme) or for its own screens (window layout,
  model favourites, list views, agent routing) is copied onto the desk

## Considered Options

* `account.settings.get` and `account.settings.update` under `account:manage`, served by the core
  through desk-platform from user-service and notification-service, shown in a new first section of
  Settings, "endue account"
* Mirror the settings into init.yaml or the preferences record and sync them both ways
* Open endue.ai's settings page in the browser from the account popover
* A built-in plugin with a new permission that calls the platform itself

## Decision Outcome

Chosen option: "account.settings.* in the core, shown in Settings", because it keeps endue as the
only keeper of these values and needs no new permission: the runtime already holds `account:manage`.

* **Contract.** `specs/platform/v0` gains `getMe`, `updateMe`, `getMyPreferences`,
  `updateMyPreferences`, `getNotificationPreferences` and `updateNotificationPreferences`, with the
  services' own bodies (user-service bare, notification-service `{ data, meta }`). Desk sends only the
  name, the picture's address, `locale`, `timezone` and the inbox (`in_app`) channel; `window_layout`
  and the other preferences are refused by the contract's request schemas.
* **Bridge.** `AccountSettings` is `{ user, language?, timeZone?, notifications, problems }`. The
  account itself must answer; preferences and notifications are read beside it, and one that does
  not answer is named in `problems`. Five kinds are shown, the ones endue.ai's settings show, in its
  order. `account.settings.update` writes the profile, then the preferences, then the notifications,
  each only when given; a refusal stops there. Signed out it is `signed_out` before anything is sent.
* **Checks.** endue stores a language or a time zone unchecked, so the core sends only a BCP 47 tag
  and an IANA-shaped name, an http or https picture address (empty clears it, as endue.ai's web does)
  and a trimmed name of 1 to 200 characters. A stored language that is not a tag is left out.
* **Profile.** A changed name or picture renews account.status's profile (`Account::refresh_profile`)
  and goes out as `account.changed`, so the account bar follows.
* **Runtime.** Settings opens with an "endue account" section first in its list: signed out it offers
  endue ID's sign-in and sign-up and shows the code; signed in, the profile, Language & Region and
  Notifications, each saved on endue at once. The sidebar's identity shows the signed-in person and
  leads there, and the account popover gains "Account settings". The display language is endue.ai's:
  the desk's own language still follows the computer, and the section says so.

### Consequences

* Good, because a change on either side shows on the other the next time it is read.
* Good, because the token never leaves the core and every test runs against desk-platform's fake.
* Bad, because the contract follows closed services by hand; their DTOs are cited, not shared.
* Bad, because endue.ai offers Korean only to an account already in it, so a Korean desk shows an
  English, Japanese, German or French choice for endue.ai.
* Bad, because a changed name costs one more `/users/me` read for the account bar's profile.

## More Information

Builds on ADR 0111 (sign-in) and ADR 0122 (desk-platform). Server facts are from endue-ai's
`platform` at origin/develop `cc2fd67`: `packages/shared-types/src/dto/users.ts`,
`apps/user-service/src/{controllers/user.controller.ts,services/preference.service.ts}`,
`apps/notification-service/src/{controllers/preference.controller.ts,services/notification-preference.service.ts}`
and the api-gateway's `routes/api/v1/users/index.ts`; the web's settings are
`src/widgets/settingsModal/ui/{AccountTab,GeneralTab,copy}.tsx` at `da758e3`. Code:
`crates/desk-platform/src/{me,wire_account}.rs`, `crates/desk-core/src/{core_account_settings,account_settings}.rs`,
`packages/runtime/src/settings-ui/account*.ts`. Not carried over yet: push and email channels
(per device on endue.ai), marketing consent, agent routing and the secretary.
