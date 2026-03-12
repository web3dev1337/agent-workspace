// Centralized port defaults for Agent Workspace.
// Environment variables override the defaults.

const DEFAULT_PORTS = Object.freeze({
  ORCHESTRATOR: 9460,
  CLIENT: 9461,
  DIFF_VIEWER: 9462,
  TAURI_DEV: 9463
});

const DEFAULT_DEV_PORTS = Object.freeze({
  ORCHESTRATOR: 9470,
  CLIENT: 9471,
  DIFF_VIEWER: 9472,
  TAURI_DEV: 9473
});

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const diffViewerPort = parsePort(process.env.DIFF_VIEWER_PORT, DEFAULT_PORTS.DIFF_VIEWER);

const PORTS = Object.freeze({
  ORCHESTRATOR: parsePort(process.env.ORCHESTRATOR_PORT || process.env.PORT, DEFAULT_PORTS.ORCHESTRATOR),
  CLIENT: parsePort(process.env.CLIENT_PORT, DEFAULT_PORTS.CLIENT),
  DIFF_VIEWER: diffViewerPort,
  TAURI_DEV: parsePort(process.env.TAURI_DEV_PORT, DEFAULT_PORTS.TAURI_DEV),
  DIFF_VIEWER_CLIENT: parsePort(process.env.DIFF_VIEWER_CLIENT_PORT, diffViewerPort + 2)
});

module.exports = {
  DEFAULT_PORTS,
  DEFAULT_DEV_PORTS,
  PORTS
};
