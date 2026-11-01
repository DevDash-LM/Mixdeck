; Mixdeck NSIS hooks (Tauri `bundle.windows.nsis.installerHooks`).
;
; tauri-plugin-autostart ("Launch at login") writes a value named "Mixdeck" under the current
; user's Run key, and Windows/auto-launch also keep one under Explorer\StartupApproved\Run.
; Tauri's uninstaller removes the Run value but not the StartupApproved one, which would leave a
; stale entry in Task Manager's Startup apps. Remove both on a real uninstall, but not when the
; uninstaller runs as part of an update ($UpdateMode = 1), so autostart survives upgrades.
;
; Presets live outside the app-data folder Tauri deletes (%APPDATA%\Mixdeck\presets, see
; presets.rs), so remove them only when the user ticked "Delete the application data".

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Mixdeck"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Mixdeck"
    ${If} $DeleteAppDataCheckboxState = 1
      RmDir /r "$APPDATA\Mixdeck\presets"
      RmDir "$APPDATA\Mixdeck"
    ${EndIf}
  ${EndIf}
!macroend
