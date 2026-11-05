// Which icon a row shows: a glyph (glyphs.js draws it) and a tone, the theme colour it is drawn in.
// Folders take the theme's primary text colour; a file takes one of the theme's eight chart colours
// by what it holds (its name first, then its extension), so every theme recolours the whole tree.
// Pure: the tests run it in Node.

/**
 * @typedef {import("./tree.js").Row} Row
 * @typedef {"folder" | "folder-open" | "home" | "link" | "more" | "file" | "text" | "markdown"
 *   | "readme" | "license" | "code" | "style" | "data" | "terminal" | "config" | "lock" | "key"
 *   | "git" | "package" | "image" | "video" | "audio" | "archive" | "sheet" | "slides" | "font"
 *   | "database" | "book"} Glyph
 * @typedef {"accent" | "muted" | "warning" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8"} Tone
 * `accent` is the primary text colour, `warning` the warning text colour, `1`..`8` the chart colours.
 * @typedef {{ glyph: Glyph, tone: Tone }} Icon
 */

/**
 * A lookup from `"<glyph> <tone>"` keys to the names they cover, written as one string each.
 * @param {Array<[string, string]>} groups
 * @returns {Map<string, Icon>}
 */
function table(groups) {
  /** @type {Map<string, Icon>} */
  const map = new Map();
  for (const [key, names] of groups) {
    const [glyph, tone] = /** @type {[Glyph, Tone]} */ (key.split(" "));
    for (const name of names.split(/\s+/)) if (name !== "") map.set(name, { glyph, tone });
  }
  return map;
}

/** Whole file names, lower case, that say more than their extension. */
const BY_NAME = table([
  [
    "package 6",
    "package.json cargo.toml pyproject.toml go.mod composer.json gemfile podfile build.gradle " +
      "build.gradle.kts settings.gradle pom.xml deno.json deno.jsonc pubspec.yaml mix.exs setup.py " +
      "setup.cfg requirements.txt pipfile build.sbt project.clj",
  ],
  [
    "lock muted",
    "package-lock.json npm-shrinkwrap.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb cargo.lock " +
      "gemfile.lock poetry.lock pipfile.lock uv.lock composer.lock podfile.lock pubspec.lock " +
      "mix.lock deno.lock flake.lock go.sum",
  ],
  [
    "package 4",
    "dockerfile containerfile .dockerignore docker-compose.yml docker-compose.yaml compose.yml " +
      "compose.yaml",
  ],
  [
    "terminal 6",
    "makefile gnumakefile justfile .justfile rakefile procfile brewfile vagrantfile jenkinsfile " +
      "caddyfile",
  ],
  [
    "git 7",
    ".gitignore .gitattributes .gitmodules .gitkeep .gitconfig .gitmessage .mailmap " +
      ".git-blame-ignore-revs",
  ],
  [
    "key warning",
    ".env .envrc .netrc .pgpass .htpasswd id_rsa id_dsa id_ecdsa id_ed25519 known_hosts " +
      "authorized_keys",
  ],
  ["config 8", "codeowners owners"],
  ["text 8", "changelog authors contributors"],
]);

/** Extensions, lower case, without the dot. */
const BY_EXTENSION = table([
  ["code 3", "js mjs cjs jsx nim"],
  [
    "code 4",
    "ts mts cts tsx py pyi pyw pyx c h cpp cc cxx hpp hh hxx ino m mm lua r pl pm f90 pas gd nix",
  ],
  ["code 7", "rs swift zig ml mli fs fsx ipynb sol"],
  ["code 2", "go dart elm"],
  ["code 5", "java scala sc groovy gradle rb erb rake cr"],
  ["code 1", "kt kts cs vb php ex exs erl hrl hs lhs jl wat purs tf hcl"],
  ["code 6", "clj cljs cljc edn vim el lisp scm rkt vue"],
  ["code 8", "asm nasm"],
  // Markup and templates.
  [
    "code 7",
    "html htm xhtml xml xsl xslt xsd svelte astro hbs handlebars ejs pug njk liquid twig jinja j2 " +
      "mustache",
  ],
  ["style 4", "css pcss postcss less"],
  ["style 5", "scss sass styl"],
  [
    "data 3",
    "json jsonc json5 jsonl ndjson geojson webmanifest yaml yml toml plist cson hjson ron",
  ],
  ["data 1", "graphql gql proto prisma thrift avsc"],
  ["terminal 6", "sh bash zsh fish ksh csh tcsh nu ps1 psm1 psd1 bat cmd command awk mk"],
  ["config 8", "ini cfg conf config properties prefs desktop service reg"],
  ["markdown 4", "md mdx markdown mdown mkd mkdn"],
  ["text 8", "txt text log nfo srt vtt"],
  ["text 2", "rst adoc asciidoc org tex bib ltx sty cls typ"],
  ["text 4", "doc docx docm dot dotx odt rtf pages wpd"],
  ["text 5", "pdf xps oxps"],
  ["sheet 6", "csv tsv xls xlsx xlsm xlsb xltx ods numbers"],
  ["slides 7", "ppt pptx pptm potx odp"],
  [
    "image 2",
    "png apng jpg jpeg jpe jfif pjpeg gif webp avif heic heif jxl bmp dib tif tiff ico cur icns " +
      "svg svgz tga pnm pbm pgm ppm pam qoi dds hdr exr ktx eps wmf emf dng cr2 cr3 crw nef nrw " +
      "arw srf sr2 orf rw2 raf pef srw 3fr erf kdc mrw dcm fits fts nii",
  ],
  ["image 1", "psd psb ai sketch fig xd afdesign afphoto kra xcf"],
  ["video 1", "mp4 m4v mov webm mkv ogv 3gp 3g2 mpg mpeg avi wmv flv f4v vob mxf m2ts"],
  ["audio 5", "mp3 m4a m4b aac wav wave flac ogg oga opus aif aiff aifc wma mid midi caf amr wv"],
  [
    "archive 3",
    "zip zipx tar gz tgz bz2 tbz tbz2 xz txz zst tzst lz lz4 lzma tlz 7z rar cab lzh lha z cpio " +
      "br arj xar sit sitx",
  ],
  ["archive 8", "iso dmg img vhd vhdx vmdk qcow qcow2 vdi squashfs sfs wim esd sparseimage"],
  [
    "package 6",
    "deb rpm apk aab ipa msi msix appx pkg snap flatpak appimage jar war ear whl gem nupkg vsix " +
      "xpi crx crate",
  ],
  ["package 8", "exe dll so dylib a lib o obj ko bin elf com sys wasm class pyc pyo node"],
  ["package 4", "dockerfile containerfile"],
  ["font 8", "ttf otf woff woff2 eot fon fnt pfb pfm ttc dfont"],
  [
    "database 2",
    "db sqlite sqlite3 db3 s3db mdb accdb duckdb realm parquet arrow feather avro orc",
  ],
  ["database 7", "sql psql mysql pgsql plsql"],
  ["book 7", "epub mobi azw azw3 kfx djvu djv fb2 cbz cbr cb7 cbt ibooks chm"],
  [
    "key warning",
    "pem key crt cer der p12 pfx p7b p7c jks keystore pub gpg pgp asc sig kdbx age csr env",
  ],
  ["git 7", "diff patch"],
  ["lock muted", "lock lockb"],
]);

/** The home folder, as a person types it or as the bridge names it. */
const HOME = /^(~|\$\{home\})$/;
const README = /^readme([._-]|$)/;
const LICENSE = /^(licen[cs]e|unlicense|copying|notice)([._-]|$)/;
/** Extensions a readme or licence is written in; "" is none. */
const PLAIN = new Set(["", "md", "markdown", "mdx", "txt", "text", "rst", "adoc", "org"]);
const ENV = /^\.env\./;
/** Env files that only show what goes in one. */
const ENV_SAMPLE = /^\.env\.(example|sample|template|dist|defaults)$/;

/**
 * The icon for one row.
 * @param {Pick<Row, "kind" | "name" | "path" | "expanded">} row
 * @returns {Icon}
 */
export function iconOf(row) {
  if (row.kind === "more") return { glyph: "more", tone: "muted" };
  if (row.kind === "symlink") return { glyph: "link", tone: "muted" };
  if (row.kind === "dir") {
    if (HOME.test(row.path)) return { glyph: "home", tone: "accent" };
    return { glyph: row.expanded ? "folder-open" : "folder", tone: "accent" };
  }
  return fileIcon(row.name);
}

/**
 * The icon for a file name: a known name, an env file, a readme or licence in plain text, the
 * extension, and a plain page for the rest. Dotfiles with no other dot are settings files.
 * @param {string} name
 * @returns {Icon}
 */
export function fileIcon(name) {
  const lower = name.toLowerCase();
  const named = BY_NAME.get(lower);
  if (named) return named;
  if (ENV_SAMPLE.test(lower)) return { glyph: "config", tone: "8" };
  if (ENV.test(lower)) return { glyph: "key", tone: "warning" };
  const dot = lower.lastIndexOf(".");
  const extension = dot > 0 ? lower.slice(dot + 1) : "";
  if (PLAIN.has(extension)) {
    if (README.test(lower)) return { glyph: "readme", tone: "4" };
    if (LICENSE.test(lower)) return { glyph: "license", tone: "3" };
  }
  const known = BY_EXTENSION.get(extension);
  if (known) return known;
  if (dot === 0) return { glyph: "config", tone: "8" };
  return { glyph: "file", tone: "muted" };
}
