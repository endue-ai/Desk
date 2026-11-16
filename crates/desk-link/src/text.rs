//! Percent-encoding as links use it: every byte but the unreserved ones (`A-Z a-z 0-9 - . _ ~`) is
//! `%XX`. Decoding takes upper or lower hex, refuses a broken escape and bytes that are not UTF-8.

use crate::Refused;

/// `text` with every byte but the unreserved ones percent-encoded.
pub fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `text` with its `%XX` escapes decoded.
pub fn decode(text: &str) -> Result<String, Refused> {
    let broken = || Refused("This link has a broken %-escape in it.".to_owned());
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3).ok_or_else(broken)?;
            // Two hex digits exactly: from_str_radix alone would take `+A`.
            if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(broken());
            }
            out.push(u8::from_str_radix(hex, 16).map_err(|_| broken())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    let text = String::from_utf8(out).map_err(|_| broken())?;
    if text.chars().any(|c| c.is_control() || crate::hidden(c)) {
        return Err(Refused(
            "This link has control characters in it.".to_owned(),
        ));
    }
    Ok(text)
}
