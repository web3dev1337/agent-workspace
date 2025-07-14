# Allow Node.js through firewall
# Run as Administrator in PowerShell

# Find Node.js path
$nodePath = (Get-Command node).Source
Write-Host "Found Node.js at: $nodePath"

# Create firewall rule for Node.js
New-NetFirewallRule -DisplayName "Node.js JavaScript Runtime" `
    -Direction Inbound `
    -Program $nodePath `
    -Action Allow `
    -Profile Private,Public

Write-Host "Firewall rule added for Node.js"

# Also check if Windows is blocking on private network
Get-NetConnectionProfile | Select Name, NetworkCategory

Write-Host "`nIf your network shows as 'Public', run this to change it to Private:"
Write-Host "Set-NetConnectionProfile -Name 'YourNetworkName' -NetworkCategory Private"