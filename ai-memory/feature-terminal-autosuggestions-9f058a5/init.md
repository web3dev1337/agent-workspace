# Terminal Autosuggestions Feature

## User Request
Investigate how terminal autocompletion/autosuggestions work (like zsh-autosuggestions) and implement it in the orchestrator terminals.

## Research Summary
- zsh-autosuggestions uses POSTDISPLAY + shell history for gray ghost text
- fish shell has built-in autosuggestions from history + completions
- xterm.js has NO built-in autosuggestion addon
- VS Code uses shell integration + DOM overlay (very complex)
- Best approach: client-side input tracking + server-side history + DOM overlay

## Implementation Approach
1. Server: CommandHistoryService - tracks commands per session + reads ~/.bash_history
2. Server: Socket.IO events for suggestion requests/responses
3. Client: Input buffer tracking, debounced requests, DOM overlay display
4. Client: Right-arrow acceptance, alternate buffer detection
