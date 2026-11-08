//! What an approval card shows of an agent's irreversible call (ADR 0078): a unified diff for a
//! write when the file and the new content are text, the command line for a spawn, the args of a
//! command. Every preview is bounded: the file at 1 MiB, the diff at 200 changed lines, any text at
//! 64 KiB (a command line or args at 4 KiB); `truncated` says that it was cut.

use std::borrow::Cow;
use std::fs;
use std::path::Path;

use desk_bridge::{ApprovalPreview, ApprovalPreviewKind};
use serde_json::{Map, Value};

/// The largest file a write's preview reads to diff against.
const MAX_FILE: u64 = 1 << 20;
/// How many changed lines a diff shows.
const MAX_CHANGED: usize = 200;
/// Lines of context around each change.
const CONTEXT: usize = 3;
/// The longest preview text, and the longest command line or args.
const MAX_TEXT: usize = 64 << 10;
const MAX_SHORT: usize = 4 << 10;
/// The largest table the diff fills (old lines times new lines) before it shows a change as a
/// whole: the lines removed, then the lines added.
const MAX_CELLS: usize = 1_000_000;

/// A write of `bytes` to `file` (`name` in the caller's terms): a unified diff of the file as it is
/// against `bytes`, all additions for a new file. None when either side is not text, the file is
/// over 1 MiB, or it is not a plain file.
pub(crate) fn write_preview(name: &str, file: &Path, bytes: &[u8]) -> Option<ApprovalPreview> {
    let new = text(bytes)?;
    let old = match fs::metadata(file) {
        Ok(meta) if meta.is_file() && meta.len() <= MAX_FILE => Some(fs::read(file).ok()?),
        Ok(_) => return None,
        Err(_) => None,
    };
    let old = match &old {
        Some(bytes) => Some(text(bytes)?),
        None => None,
    };
    let (diff, cut) = unified(name, old, new);
    Some(preview(ApprovalPreviewKind::Diff, diff, cut, MAX_TEXT))
}

/// A spawn's command line, each word quoted for a POSIX shell where it needs it.
pub(crate) fn command_preview(command: &str, args: &[String]) -> ApprovalPreview {
    let words = std::iter::once(command).chain(args.iter().map(String::as_str));
    let line = words.map(quote).collect::<Vec<_>>().join(" ");
    preview(ApprovalPreviewKind::Command, line, false, MAX_SHORT)
}

/// A command's args as JSON (`{}` without any).
pub(crate) fn args_preview(args: Option<&Map<String, Value>>) -> ApprovalPreview {
    let args = Value::Object(args.cloned().unwrap_or_default());
    preview(
        ApprovalPreviewKind::Args,
        args.to_string(),
        false,
        MAX_SHORT,
    )
}

/// The fact memory.remember would keep, in the person's words (ADR 0096).
pub(crate) fn fact_preview(text: &str) -> ApprovalPreview {
    preview(ApprovalPreviewKind::Fact, text.to_owned(), false, MAX_SHORT)
}

/// A fetch's method and URL.
pub(crate) fn url_preview(method: &str, url: &str) -> ApprovalPreview {
    preview(
        ApprovalPreviewKind::Url,
        format!("{method} {url}"),
        false,
        MAX_SHORT,
    )
}

fn preview(kind: ApprovalPreviewKind, mut text: String, cut: bool, max: usize) -> ApprovalPreview {
    let cut = cut || text.len() > max;
    if text.len() > max {
        let mut end = max;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    ApprovalPreview {
        kind,
        text,
        truncated: cut.then_some(true),
    }
}

/// Bytes as text: UTF-8 without NUL.
fn text(bytes: &[u8]) -> Option<&str> {
    std::str::from_utf8(bytes)
        .ok()
        .filter(|t| !t.contains('\0'))
}

fn quote(word: &str) -> Cow<'_, str> {
    let plain = !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c));
    if plain {
        Cow::Borrowed(word)
    } else {
        Cow::Owned(format!("'{}'", word.replace('\'', "'\\''")))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Op {
    Same,
    Removed,
    Added,
}

/// `old` against `new` as a unified diff with three lines of context, the first 200 changed lines
/// of it, and whether more were left out.
fn unified(name: &str, old: Option<&str>, new: &str) -> (String, bool) {
    let a: Vec<&str> = old.map(|t| t.lines().collect()).unwrap_or_default();
    let b: Vec<&str> = new.lines().collect();
    let script = script(&a, &b);
    let from = if old.is_some() { name } else { "/dev/null" };
    let mut out = format!("--- {from}\n+++ {name}\n");
    // Each op's old and new line number (1-based).
    let (mut old_at, mut new_at) = (Vec::new(), Vec::new());
    let (mut o, mut n) = (1, 1);
    for (op, _) in &script {
        old_at.push(o);
        new_at.push(n);
        o += usize::from(*op != Op::Added);
        n += usize::from(*op != Op::Removed);
    }
    let mut hunks: Vec<(usize, usize)> = Vec::new();
    for (i, _) in script
        .iter()
        .enumerate()
        .filter(|(_, (op, _))| *op != Op::Same)
    {
        let (start, end) = (
            i.saturating_sub(CONTEXT),
            (i + CONTEXT + 1).min(script.len()),
        );
        match hunks.last_mut() {
            Some(last) if start <= last.1 => last.1 = end,
            _ => hunks.push((start, end)),
        }
    }
    let mut budget = MAX_CHANGED;
    for (start, end) in hunks {
        if budget == 0 {
            return (out, true);
        }
        let mut stop = end;
        let mut used = 0;
        for (i, (op, _)) in script.iter().enumerate().take(end).skip(start) {
            if *op == Op::Same {
                continue;
            }
            if used == budget {
                stop = i;
                break;
            }
            used += 1;
        }
        budget -= used;
        let body = &script[start..stop];
        let old_len = body.iter().filter(|(op, _)| *op != Op::Added).count();
        let new_len = body.iter().filter(|(op, _)| *op != Op::Removed).count();
        let old_start = old_at[start] - usize::from(old_len == 0);
        let new_start = new_at[start] - usize::from(new_len == 0);
        out.push_str(&format!(
            "@@ -{old_start},{old_len} +{new_start},{new_len} @@\n"
        ));
        for (op, line) in body {
            out.push(match op {
                Op::Same => ' ',
                Op::Removed => '-',
                Op::Added => '+',
            });
            out.push_str(line);
            out.push('\n');
        }
        if stop < end {
            return (out, true);
        }
    }
    (out, false)
}

/// The lines to keep, remove and add to turn `a` into `b`: the common start and end kept, the
/// middle by its longest common subsequence while that table stays small, else removed and added
/// whole.
fn script<'a>(a: &[&'a str], b: &[&'a str]) -> Vec<(Op, &'a str)> {
    let prefix = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let rest = (a.len() - prefix).min(b.len() - prefix);
    let suffix = (0..rest)
        .take_while(|i| a[a.len() - 1 - i] == b[b.len() - 1 - i])
        .count();
    let (mid_a, mid_b) = (&a[prefix..a.len() - suffix], &b[prefix..b.len() - suffix]);
    let mut out: Vec<(Op, &str)> = a[..prefix].iter().map(|l| (Op::Same, *l)).collect();
    if mid_a.len().saturating_mul(mid_b.len()) <= MAX_CELLS {
        out.extend(common(mid_a, mid_b));
    } else {
        out.extend(mid_a.iter().map(|l| (Op::Removed, *l)));
        out.extend(mid_b.iter().map(|l| (Op::Added, *l)));
    }
    out.extend(a[a.len() - suffix..].iter().map(|l| (Op::Same, *l)));
    out
}

/// The edit script of `a` to `b` by their longest common subsequence.
fn common<'a>(a: &[&'a str], b: &[&'a str]) -> Vec<(Op, &'a str)> {
    let width = b.len() + 1;
    // table[i * width + j]: the longest common subsequence of a[i..] and b[j..].
    let mut table = vec![0u32; (a.len() + 1) * width];
    for i in (0..a.len()).rev() {
        for j in (0..b.len()).rev() {
            table[i * width + j] = if a[i] == b[j] {
                table[(i + 1) * width + j + 1] + 1
            } else {
                table[(i + 1) * width + j].max(table[i * width + j + 1])
            };
        }
    }
    let (mut i, mut j, mut out) = (0, 0, Vec::new());
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            out.push((Op::Same, a[i]));
            (i, j) = (i + 1, j + 1);
        } else if table[(i + 1) * width + j] >= table[i * width + j + 1] {
            out.push((Op::Removed, a[i]));
            i += 1;
        } else {
            out.push((Op::Added, b[j]));
            j += 1;
        }
    }
    out.extend(a[i..].iter().map(|l| (Op::Removed, *l)));
    out.extend(b[j..].iter().map(|l| (Op::Added, *l)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_in_the_middle_keeps_three_lines_of_context() {
        let old = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
        let new = "1\n2\n3\n4\nfive\n6\n7\n8\n9\n";
        let (diff, cut) = unified("~/n.txt", Some(old), new);
        assert!(!cut);
        assert_eq!(
            diff,
            "--- ~/n.txt\n+++ ~/n.txt\n@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n"
        );
    }

    #[test]
    fn a_new_file_is_all_additions_and_far_changes_are_two_hunks() {
        let (diff, _) = unified("~/new.txt", None, "a\nb\n");
        assert_eq!(
            diff,
            "--- /dev/null\n+++ ~/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n"
        );
        let old: String = (1..=20).map(|n| format!("{n}\n")).collect();
        let new: String = (1..=20)
            .map(|n| match n {
                2 => "two\n".to_owned(),
                19 => "nineteen\n".to_owned(),
                n => format!("{n}\n"),
            })
            .collect();
        let (diff, _) = unified("~/n.txt", Some(&old), &new);
        assert_eq!(diff.matches("\n@@ ").count(), 2, "{diff}");
    }

    #[test]
    fn words_are_quoted_only_where_a_shell_needs_it() {
        let args = ["-m".to_owned(), "it's done".to_owned(), String::new()];
        assert_eq!(
            command_preview("git", &args).text,
            "git -m 'it'\\''s done' ''"
        );
    }
}
