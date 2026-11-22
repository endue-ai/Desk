// Make the historical installer identities independent of the display name. The release installs
// cargo-packager 0.11.8 with Cargo; use its exact templates, including its maintained UI and files.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const legacy = "endue Desk";
// cargo-packager derives WiX UpgradeCode from the unchanged executable plus ".app.x64".
const upgradeCode = "{6DF1A592-6BAD-590D-9FF0-F3C26EC6A138}";
const pins = {
  "nsis/installer.nsi": "3ff5fde09ae24dfc031ab91f939b290f394e2c6d3549f2c43c37414716a47b7a",
  "wix/main.wxs": "393b9e4b821eb824864fab0637a3f7e77c1d2f50a7c8f9ab3e2d4d12437f2b67",
};

export function nsisIdentity(template) {
  return template
    .replaceAll('${PRODUCTNAME}"', (match, offset, source) => {
      const line = source.slice(source.lastIndexOf("\n", offset) + 1, offset);
      return /UNINSTKEY|MANUPRODUCTKEY|MULTIUSER_INSTALLMODE_INSTDIR|StrCpy \$INSTDIR/u.test(line)
        ? `${legacy}"`
        : match;
    })
    .replace(
      "!insertmacro MUI_PAGE_STARTMENU",
      `!define MUI_STARTMENUPAGE_DEFAULTFOLDER "${legacy}"\n!insertmacro MUI_PAGE_STARTMENU`,
    )
    .replace(
      / {2}; Uninstall previous WiX installation if exists\.[\s\S]+? {2}wix_done:/u,
      `  ; Only an MSI in the original upgrade family belongs to this application.
  System::Call 'msi::MsiEnumRelatedProductsW(w "${upgradeCode}", i 0, i 0, w .r1) i.r0'
  StrCmp $0 0 0 wix_done
  StrCpy $R7 "wix"
  StrCpy $R6 "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$1"
  Goto compare_version
  wix_done:`,
    )
    .replace(
      "Section EarlyChecks",
      `Section EarlyChecks
  ; Preserve an unrelated installation even when the user selects its folder.
  IfFileExists "$INSTDIR\\*.*" 0 endue_directory_ok
  ReadRegStr $4 SHCTX "\${MANUPRODUCTKEY}" ""
  StrCmp $4 "$INSTDIR" endue_directory_ok
  MessageBox MB_OK "Choose an empty folder or the existing endue installation." /SD IDOK
  SetErrorLevel 1
  Abort
  endue_directory_ok:`,
    )
    .replace(
      /^( {2}CreateShortcut "([^"]+)")/gmu,
      (_, create, path) => `  IfFileExists "${path}" endue_shortcut_done 0\n${create}`,
    )
    .replace(
      /^( {2}ApplicationID::Set "([^"]+)" "\$\{IDENTIFIER\}")$/gmu,
      (_, set, path) =>
        `${set}\n  WriteRegStr SHCTX "\${MANUPRODUCTKEY}" "${path.startsWith("$DESKTOP") ? "DesktopLink" : "StartLink"}" "${path}"\n  endue_shortcut_done:`,
    )
    .replace(
      /^( {2}Delete "(\$(?:DESKTOP|SMPROGRAMS)[^"]+\.lnk)")$/gmu,
      (_, del, path) =>
        `  ReadRegStr $4 SHCTX "\${MANUPRODUCTKEY}" "${path.startsWith("$DESKTOP") ? "DesktopLink" : "StartLink"}"\n  StrCmp $4 "${path}" 0 +2\n${del}`,
    );
}

export function wixIdentity(template) {
  const key = String.raw`Software\\{{manufacturer}}\\{{product_name}}`;
  return template
    .replaceAll(key, String.raw`Software\\{{manufacturer}}\\${legacy}`)
    .replaceAll('Id="INSTALLDIR" Name="{{product_name}}"', `Id="INSTALLDIR" Name="${legacy}"`)
    .replace(
      'Id="ApplicationProgramsFolder" Name="{{product_name}}"',
      `Id="ApplicationProgramsFolder" Name="${legacy}"`,
    )
    .replace(
      '<Property Id="INSTALLDIR">',
      `<Property Id="ENDUE_DESKTOP_LINK">
            <DirectorySearch Id="EndueDesktopDir" Path="[DesktopFolder]" Depth="0">
                <FileSearch Id="EndueDesktopFile" Name="endue.lnk" />
            </DirectorySearch>
        </Property>
        <Property Id="ENDUE_OWNS_DESKTOP_LINK">
            <RegistrySearch Id="EndueOwnedDesktop" Root="HKCU" Key="Software\\endue\\endue Desk" Name="EndueDesktopLink" Type="raw" />
        </Property>
        <Property Id="INSTALLDIR">`,
    )
    .replace(
      '<Shortcut Id="ApplicationDesktopShortcut"',
      '<Condition>NOT ENDUE_DESKTOP_LINK OR ENDUE_OWNS_DESKTOP_LINK</Condition>\n                    <Shortcut Id="ApplicationDesktopShortcut"',
    )
    .replace('Name="Desktop Shortcut" Type="integer"', 'Name="EndueDesktopLink" Type="integer"');
}

export function stageWindowsTemplates(
  stage,
  cargoHome = process.env.CARGO_HOME || join(homedir(), ".cargo"),
) {
  const registry = join(cargoHome, "registry", "src");
  for (const [file, digest] of Object.entries(pins)) {
    const path = readdirSync(registry)
      .map((index) => join(registry, index, "cargo-packager-0.11.8/src/package", file))
      .find(existsSync);
    if (!path)
      throw new Error("Install cargo-packager 0.11.8 with Cargo before packaging for Windows.");
    const template = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    if (createHash("sha256").update(template).digest("hex") !== digest)
      throw new Error(`Unexpected cargo-packager 0.11.8 template: ${file}`);
    const result = file.startsWith("nsis") ? nsisIdentity(template) : wixIdentity(template);
    writeFileSync(join(stage, file.split("/")[1]), result);
  }
}
