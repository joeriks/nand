; Register Open With candidates without replacing extension defaults or UserChoice.
; The installer is per-user, so every registration stays in HKCU.
!macro NAND_FILE_TYPE EXT DESCRIPTION
  WriteRegStr HKCU "Software\Classes\nand.${EXT}" "" "${DESCRIPTION}"
  WriteRegStr HKCU "Software\Classes\nand.${EXT}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "Software\Classes\nand.${EXT}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "nand.${EXT}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr HKCU "Software\nand\Capabilities\FileAssociations" ".${EXT}" "nand.${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro NAND_FILE_TYPE "txt" "Textfil i nand"
  !insertmacro NAND_FILE_TYPE "md" "Markdown-dokument i nand"
  !insertmacro NAND_FILE_TYPE "csv" "CSV-tabell i nand"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "nand"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr HKCU "Software\nand\Capabilities" "ApplicationName" "nand"
  WriteRegStr HKCU "Software\nand\Capabilities" "ApplicationDescription" "Notes and more"
  WriteRegStr HKCU "Software\RegisteredApplications" "nand" "Software\nand\Capabilities"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NAND_REMOVE_FILE_TYPE EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "nand.${EXT}"
  DeleteRegKey HKCU "Software\Classes\nand.${EXT}"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro NAND_REMOVE_FILE_TYPE "txt"
  !insertmacro NAND_REMOVE_FILE_TYPE "md"
  !insertmacro NAND_REMOVE_FILE_TYPE "csv"
  DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey HKCU "Software\nand\Capabilities"
  DeleteRegValue HKCU "Software\RegisteredApplications" "nand"
  !insertmacro UPDATEFILEASSOC
!macroend
