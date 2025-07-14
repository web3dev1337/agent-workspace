# PowerShell script to allow orchestrator through Windows firewall
# Run this in PowerShell as Administrator

New-NetFirewallRule -DisplayName "Claude Orchestrator" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 3000 `
    -Action Allow `
    -Profile Private

Write-Host "Firewall rule added for port 3000 on private networks"