; Agent Workspace NSIS installer hooks
; Kills ONLY the node.exe spawned by Agent Workspace (path-filtered),
; not the user's other Node.js processes.

!macro NSIS_HOOK_PREINSTALL
  ; Kill any running Agent Workspace instance (safe — it's our app)
  nsExec::ExecToLog 'taskkill /IM "Agent Workspace.exe" /F'

  ; Kill ONLY node.exe running from the agent-workspace install directory.
  ; Uses PowerShell path filter so we never touch the user's other Node processes.
  ; -ErrorAction SilentlyContinue: no error if nothing to kill.
  nsExec::ExecToLog "powershell -NoProfile -Command $\"Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '*agent-workspace*' } | Stop-Process -Force -ErrorAction SilentlyContinue$\""

  ; Let Windows release file handles
  Sleep 1000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /IM "Agent Workspace.exe" /F'
  nsExec::ExecToLog "powershell -NoProfile -Command $\"Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '*agent-workspace*' } | Stop-Process -Force -ErrorAction SilentlyContinue$\""
  Sleep 1000
!macroend
