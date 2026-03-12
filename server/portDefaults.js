// Centralized port defaults for the orchestrator.
// All port constants live here. .env values override these defaults.
//
// Default range: 9460-9463 (unregistered IANA ports with zero known conflicts)

const PORTS = {
  ORCHESTRATOR: parseInt(process.env.ORCHESTRATOR_PORT || process.env.PORT || '9460', 10),
  CLIENT: parseInt(process.env.CLIENT_PORT || '9461', 10),
  DIFF_VIEWER: parseInt(process.env.DIFF_VIEWER_PORT || '9462', 10),
  TAURI_DEV: parseInt(process.env.TAURI_DEV_PORT || '9463', 10),
};

module.exports = { PORTS };
