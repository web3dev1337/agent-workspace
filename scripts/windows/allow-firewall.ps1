# PowerShell script to allow Agent Workspace through Windows firewall.
# Run this in PowerShell as Administrator.

New-NetFirewallRule -DisplayName "Agent Workspace" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 3000 `
    -Action Allow `
    -Profile Private

Write-Host "Firewall rule added for port 3000 on private networks"
