//! Which channel a desk follows (ADR 0054, ADR 0092): the person's `desk.update.channel` when it
//! names one, else the channel its build came from. A line's candidate follows beta, so a CEF beta
//! desk never reads canary, which still lists Tauri builds (#98).

use desk_update::Channel;

#[test]
fn an_rc_desk_with_no_channel_set_follows_beta() {
    assert_eq!(Channel::of_version("0.4.0-rc.31"), Channel::Beta);
    assert_eq!(Channel::of_version("1.2.3-rc.7"), Channel::Beta);
    assert_eq!(Channel::followed(None, "0.4.0-rc.31"), Channel::Beta);
}

#[test]
fn a_canary_desk_follows_canary() {
    assert_eq!(Channel::of_version("0.5.0-pre.212"), Channel::Canary);
    assert_eq!(Channel::followed(None, "0.5.0-pre.212"), Channel::Canary);
}

#[test]
fn a_final_follows_stable() {
    assert_eq!(Channel::of_version("0.4.0"), Channel::Stable);
    assert_eq!(Channel::followed(None, "0.4.0"), Channel::Stable);
}

#[test]
fn only_an_rc_pre_release_is_a_candidate() {
    // Build metadata does not change where a build came from.
    assert_eq!(Channel::of_version("0.4.0-rc.31+c46d12b"), Channel::Beta);
    assert_eq!(Channel::of_version("0.4.0+c46d12b"), Channel::Stable);
    // Any other pre-release, or a name that merely starts with rc, stays on canary as before.
    assert_eq!(Channel::of_version("0.4.0-rcx.1"), Channel::Canary);
    assert_eq!(Channel::of_version("0.4.0-pre.rc.1"), Channel::Canary);
    assert_eq!(Channel::of_version("0.0.0-dev"), Channel::Canary);
}

#[test]
fn an_explicit_setting_wins() {
    assert_eq!(
        Channel::followed(Some("canary"), "0.4.0-rc.31"),
        Channel::Canary
    );
    assert_eq!(
        Channel::followed(Some("stable"), "0.4.0-rc.31"),
        Channel::Stable
    );
    assert_eq!(
        Channel::followed(Some("beta"), "0.5.0-pre.212"),
        Channel::Beta
    );
    assert_eq!(Channel::followed(Some("beta"), "0.4.0"), Channel::Beta);
}

#[test]
fn a_setting_that_names_no_channel_is_ignored() {
    assert_eq!(
        Channel::followed(Some("nightly"), "0.4.0-rc.31"),
        Channel::Beta
    );
    assert_eq!(Channel::followed(Some(""), "0.4.0"), Channel::Stable);
}
