# VM Control

`vmctl` is a small SSH-to-PowerShell bridge for the Windows VM exposed through the `vmwin` SSH alias.

## Commands

```bash
node scripts/vm/vmctl.js info
node scripts/vm/vmctl.js exec --command "Write-Output hello"
node scripts/vm/vmctl.js exec --cwd "C:\Users\administrator" --command "Get-Location"
node scripts/vm/vmctl.js shell
```

## What It Does

- Uses SSH as the transport and PowerShell as the remote execution layer
- Encodes remote commands with `-EncodedCommand` so quoting stays stable across nested shells
- Adds a status probe that reports the VM host, current user, PowerShell version, working directory, and common tool availability
- Supports an interactive PowerShell shell for manual work

## Environment Variables

- `VMCTL_HOST`
- `VMCTL_REMOTE_EXE`
- `VMCTL_CONNECT_TIMEOUT_MS`
- `VMCTL_SERVER_ALIVE_INTERVAL`
- `VMCTL_SERVER_ALIVE_COUNT_MAX`
- `VMCTL_TIMEOUT_MS`

## Notes

- The default SSH alias is `vmwin`
- `exec` is safe for multi-line PowerShell because the command body is encoded before transmission
- `info --json` is convenient when another tool needs to parse the VM status
