//! MIME types by file extension, for what the desk serves itself.

/// The MIME type of `path` by its extension; `application/octet-stream` when unknown.
pub fn for_path(path: &str) -> &'static str {
    let extension = path
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "html" | "htm" => "text/html",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "glb" => "model/gltf-binary",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::for_path;

    #[test]
    fn known_extensions_map_and_unknown_ones_are_octet_streams() {
        assert_eq!(for_path("index.html"), "text/html");
        assert_eq!(for_path("assets/app-1a2b.JS"), "text/javascript");
        assert_eq!(for_path("fonts/a.woff2"), "font/woff2");
        assert_eq!(for_path("decoder.wasm"), "application/wasm");
        assert_eq!(for_path("noextension"), "application/octet-stream");
        assert_eq!(for_path("archive.xyz"), "application/octet-stream");
    }
}
