; Agent Workspace NSIS installer hooks
; Kills orphaned node.exe and Agent Workspace processes before install/update
; to prevent "Error opening file for writing" on bundled node.exe

!macro NSIS_HOOK_PREINSTALL
  ; Kill any running Agent Workspace instance (the Tauri app itself)
  nsExec::ExecToLog 'taskkill /IM "Agent Workspace.exe" /F'

  ; Kill orphaned node.exe that was spawned by the app's backend server.
  ; The bundled node.exe lives under AppData\Local\agent-workspace and holds
  ; a file lock on itself while running - the installer cannot overwrite it.
  ; We use /F (force) because node may not respond to graceful shutdown.
  nsExec::ExecToLog 'taskkill /IM node.exe /F'

  ; Brief pause to let Windows release file handles after process termination
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Same cleanup before uninstall to ensure clean file removal
  nsExec::ExecToLog 'taskkill /IM "Agent Workspace.exe" /F'
  nsExec::ExecToLog 'taskkill /IM node.exe /F'
  Sleep 1000
!macroend
