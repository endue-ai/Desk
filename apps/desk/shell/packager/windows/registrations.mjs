// What the Windows installers register (#310): the `endue` URL scheme, and an "Open with" entry for
// each document type macOS names (macos/Info.plist), under one ProgID that is never an extension's
// default. cargo-packager's own fileAssociations would make the desk the default handler, so the
// NSIS installer gets a section of its own (`nsis.preinstallSection`, current user, HKCU) and the
// MSI the fragment in registrations.wxs (per machine, HKCR). Nothing here touches the disk.
import { join } from "node:path";

/** The extensions macOS opens with the desk, as "Alternate" viewers; Windows offers the same. */
export const EXTENSIONS = [
  "md",
  "txt",
  "csv",
  "xlsx",
  "docx",
  "pptx",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "mp3",
  "mp4",
  "zip",
  "html",
];
export const SCHEME = "endue";
export const PROGID = "ai.endue.desk.file";
/** The WiX ComponentGroup registrations.wxs defines. */
export const WIX_GROUP = "DeskRegistrations";

const classes = "Software\\Classes";
/**
 * How Windows starts the desk for a link or a file: `--single-argument` (as Chrome and Edge register)
 * makes everything after it one argument, so a link holding `"` can add no switch of its own (the
 * class of CVE-2018-1000006). The shell reads what follows as the link or path (`open_files.rs`).
 */
export const COMMAND = '"$INSTDIR\\endue-desk.exe" --single-argument %1';

/** The NSIS section that registers the scheme and the "Open with" entries for the current user. */
export function nsisSection() {
  const lines = [
    "Section DeskRegistrations",
    `  WriteRegStr HKCU "${classes}\\${SCHEME}" "" "URL:endue Desk link"`,
    `  WriteRegStr HKCU "${classes}\\${SCHEME}" "URL Protocol" ""`,
    `  WriteRegStr HKCU "${classes}\\${SCHEME}\\shell\\open\\command" "" '${COMMAND}'`,
    `  WriteRegStr HKCU "${classes}\\${PROGID}" "" "endue Desk document"`,
    `  WriteRegStr HKCU "${classes}\\${PROGID}\\shell\\open\\command" "" '${COMMAND}'`,
    ...EXTENSIONS.map(
      (ext) => `  WriteRegStr HKCU "${classes}\\.${ext}\\OpenWithProgids" "${PROGID}" ""`,
    ),
    "SectionEnd",
  ];
  return lines.join("\n");
}

/** The Windows parts of the cargo-packager config, from the packager folder `packager`. */
export function windowsRegistrations(packager) {
  return {
    nsis: { preinstallSection: nsisSection() },
    wix: {
      fragmentPaths: [join(packager, "windows/registrations.wxs")],
      componentGroupRefs: [WIX_GROUP],
    },
  };
}
