; aether.chat NSIS installer hooks.
; Versions up to 0.2.0 were installed under the product name "AetherChat". After installing
; aether.chat, silently remove that old copy so users don't end up with two apps. Both share the
; same app identifier, so sign-in and settings (WebView2 data) carry over untouched.

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AetherChat" "UninstallString"
  ${If} $0 != ""
    DetailPrint "Removing the previous AetherChat installation..."
    ExecWait '$0 /S'
  ${EndIf}
!macroend
