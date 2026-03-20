# Fix: NSIS installer "Error opening file for writing" on node.exe

## Problem
Windows NSIS installer fails with "Error opening file for writing: C:\Users\AB\AppData\Local\agent-workspace\resources\backend\node\node.exe" when reinstalling after uninstall.

## Root Cause
The bundled node.exe (backend server) is still running as an orphaned process after app close/uninstall, holding a file lock. The installer can't overwrite a locked file.

## Solution
Add NSIS preinstall hook that kills node.exe and Agent Workspace.exe before file extraction.
