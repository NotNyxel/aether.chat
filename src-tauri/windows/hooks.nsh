; Aether NSIS installer hooks.
; The app has been renamed twice: "AetherChat" (up to 0.2.0) and "aether.chat" (0.3.0 to 1.5.x).
; After installing Aether, silently remove an older copy so people don't end up with two apps.
; All of them share the same app identifier, so sign-in and settings (WebView2 data) carry over.

!macro AETHER_REMOVE_OLD NAME
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NAME}" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Removing the previous ${NAME} installation..."
    ; Keep "open at sign-in" working: move the startup entry over to the new name.
    ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${NAME}"
    ${If} $1 != ""
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" --autostart'
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${NAME}"
    ${EndIf}
    ExecWait '$0 /S'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro AETHER_REMOVE_OLD "AetherChat"
  !insertmacro AETHER_REMOVE_OLD "aether.chat"
!macroend
