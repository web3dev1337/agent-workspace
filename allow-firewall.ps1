# PowerShell script to allow orchestrator through Windows firewall
# Run this in PowerShell as Administrator

New-NetFirewallRule -DisplayName "Agent Workspace" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 9460,9461 `
    -Action Allow `
    -Profile Private

Write-Host "Firewall rule added for ports 9460 and 9461 on private networks"
