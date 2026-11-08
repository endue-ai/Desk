; Offer Desk in Open With; never replace extension defaults or Explorer UserChoice.
; SHELL_CONTEXT follows Tauri's per-user/per-machine installation context.
!macro DeskAssociationContext
  !if "${INSTALLMODE}" == "perMachine"
    SetShellVarContext all
  !else if "${INSTALLMODE}" == "both"
    ${If} $MultiUser.InstallMode == "AllUsers"
      SetShellVarContext all
    ${Else}
      SetShellVarContext current
    ${EndIf}
  !else
    SetShellVarContext current
  !endif
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro DeskAssociationContext
  WriteRegStr SHELL_CONTEXT "Software\Classes\ai.endue.desk.file" "" "endue Desk document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ai.endue.desk.file\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\ai.endue.desk.file\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.txt\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.csv\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.xlsx\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.docx\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.pptx\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.png\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.jpg\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.jpeg\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.gif\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.webp\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.mp3\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.mp4\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.zip\OpenWithProgids" "ai.endue.desk.file" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\.html\OpenWithProgids" "ai.endue.desk.file" ""
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Tauri may switch to current while deleting app data. Restore the installation context.
  !insertmacro DeskAssociationContext
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.md\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.txt\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.csv\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.xlsx\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.docx\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pptx\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.png\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.jpg\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.jpeg\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.gif\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.webp\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mp3\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.mp4\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.zip\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.html\OpenWithProgids" "ai.endue.desk.file"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ai.endue.desk.file"
  !insertmacro UPDATEFILEASSOC
!macroend
