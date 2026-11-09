//! The account's settings as endue keeps them (desk-platform's `wire_account`, snake_case) in the
//! bridge's account.settings.* shapes (camelCase, ADR 0130), and the checks a value passes before
//! it is sent: endue stores a language or a time zone as given, so the desk sends only well-formed
//! ones, and leaves out a stored one that is not.

use desk_bridge::{AccountNotificationKind, AccountUser, AccountUserStatus};
use desk_platform::wire_account::{User, UserStatus};

use crate::studio::map::cut;

/// The kinds endue.ai's settings show, in its order, with endue's own names for them.
pub(crate) const KINDS: [(AccountNotificationKind, &str); 5] = [
    (
        AccountNotificationKind::ConversationReply,
        "conversation_reply",
    ),
    (
        AccountNotificationKind::RoutineCompleted,
        "routine_completed",
    ),
    (AccountNotificationKind::RoutineFailed, "routine_failed"),
    (AccountNotificationKind::RoutineSkipped, "routine_skipped"),
    (AccountNotificationKind::AgentNotice, "agent_notice"),
];

/// endue's name of `kind`.
pub(crate) fn endue_kind(kind: &AccountNotificationKind) -> &'static str {
    KINDS
        .iter()
        .find(|(known, _)| known == kind)
        .map_or("conversation_reply", |(_, name)| name)
}

/// `tag` when it is a BCP 47 tag the bridge takes (`en-US`, `ja-JP`).
pub(crate) fn language(tag: &str) -> Option<String> {
    let mut parts = tag.split('-');
    let primary = parts.next()?;
    let primary_ok =
        (2..=3).contains(&primary.len()) && primary.bytes().all(|b| b.is_ascii_lowercase());
    let rest_ok =
        parts.all(|p| (2..=8).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric()));
    (primary_ok && rest_ok && tag.len() <= 35).then(|| tag.to_owned())
}

/// `zone` when it is shaped like an IANA name (`Asia/Seoul`, `America/Argentina/Buenos_Aires`, `UTC`).
pub(crate) fn time_zone(zone: &str) -> Option<String> {
    let parts: Vec<&str> = zone.split('/').collect();
    let named = |p: &&str| {
        !p.is_empty()
            && p.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'+' | b'-'))
    };
    let first = zone.bytes().next().is_some_and(|b| b.is_ascii_alphabetic());
    let whole = parts.len() <= 3 && parts.iter().all(named) && zone.len() <= 64;
    (first && whole).then(|| zone.to_owned())
}

/// endue's `2026-03-14T09:00:00.000Z` as RFC 3339 without the fraction, or as it came.
fn instant(text: &str) -> String {
    match (text.find('.'), text.strip_suffix('Z')) {
        (Some(dot), Some(_))
            if text[dot + 1..text.len() - 1]
                .bytes()
                .all(|b| b.is_ascii_digit()) =>
        {
            format!("{}Z", &text[..dot])
        }
        _ => text.to_owned(),
    }
}

/// The account as the bridge shows it.
pub(crate) fn user(user: User) -> AccountUser {
    let some = |text: Option<String>, max: usize| {
        text.map(|t| t.trim().to_owned())
            .filter(|t| !t.is_empty() && t.chars().count() <= max)
    };
    AccountUser {
        id: cut(&user.id, 128),
        email: cut(&user.email, 320),
        display_name: some(user.display_name, 200),
        avatar_url: some(user.avatar_url, 2048),
        status: match user.status {
            UserStatus::Active => AccountUserStatus::Active,
            UserStatus::Inactive => AccountUserStatus::Inactive,
            UserStatus::Suspended => AccountUserStatus::Suspended,
        },
        joined_at: instant(&user.created_at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn languages_and_time_zones_are_checked_by_shape() {
        for good in ["en", "en-US", "ja-JP", "zh-Hant-TW", "fil"] {
            assert_eq!(language(good).as_deref(), Some(good));
        }
        for bad in ["", "EN", "english", "en_US", "en-", "e"] {
            assert_eq!(language(bad), None, "{bad}");
        }
        for good in [
            "UTC",
            "Asia/Seoul",
            "America/Argentina/Buenos_Aires",
            "Etc/GMT+5",
        ] {
            assert_eq!(time_zone(good).as_deref(), Some(good));
        }
        for bad in ["", "+09:00", "Asia/", "/Seoul", "Asia Seoul", "a/b/c/d"] {
            assert_eq!(time_zone(bad), None, "{bad}");
        }
    }

    #[test]
    fn endues_instants_lose_their_fraction() {
        assert_eq!(instant("2026-03-14T09:00:00.000Z"), "2026-03-14T09:00:00Z");
        assert_eq!(instant("2026-03-14T09:00:00Z"), "2026-03-14T09:00:00Z");
        assert_eq!(
            instant("2026-03-14T09:00:00.5+09:00"),
            "2026-03-14T09:00:00.5+09:00"
        );
    }
}
