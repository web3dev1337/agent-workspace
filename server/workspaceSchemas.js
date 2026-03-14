// Enhanced workspace schemas supporting mixed-repo workspaces
const path = require('path');

const WORKSPACE_TYPES = {
  'single-repo': {
    description: 'Traditional workspace with all terminals from one repository',
    schema: 'single-repo'
  },
  'mixed-repo': {
    description: 'Advanced workspace with terminals from multiple repositories',
    schema: 'mixed-repo'
  }
};

// Schema for single-repo workspaces (current approach)
const SINGLE_REPO_SCHEMA = {
  required: ['id', 'name', 'workspaceType', 'repository'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' },
    name: { type: 'string', minLength: 1 },
    workspaceType: { type: 'string', enum: ['single-repo'] },
    projectType: { type: 'string' }, // hytopia-game, monogame-game, etc.
    icon: { type: 'string', default: '📁' },
    description: { type: 'string', default: '' },
    access: { type: 'string', enum: ['private', 'team', 'public'], default: 'private' },

    repository: {
      type: 'object',
      required: ['path', 'type'],
      properties: {
        path: { type: 'string' },
        type: { type: 'string' }, // hytopia-game, monogame-game, etc.
        masterBranch: { type: 'string', default: 'master' },
        remote: { type: 'string' }
      }
    },

    worktrees: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        count: { type: 'number', min: 1, max: 16, default: 8 },
        namingPattern: { type: 'string', default: 'work{n}' },
        autoCreate: { type: 'boolean', default: true }
      }
    },

    terminals: {
      type: 'object',
      properties: {
        pairs: { type: 'number', min: 1, max: 16 },
        defaultVisible: { type: 'array', items: { type: 'number' } },
        layout: { type: 'string', enum: ['dynamic', '1x1', '1x2', '2x2', '2x4'], default: 'dynamic' }
      }
    }
  }
};

// Schema for mixed-repo workspaces (new approach)
const MIXED_REPO_SCHEMA = {
  required: ['id', 'name', 'workspaceType', 'terminals'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' },
    name: { type: 'string', minLength: 1 },
    workspaceType: { type: 'string', enum: ['mixed-repo'] },
    icon: { type: 'string', default: '🔄' },
    description: { type: 'string', default: '' },
    access: { type: 'string', enum: ['private', 'team', 'public'], default: 'private' },

    // Array of individual terminals, each with its own repo
    terminals: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'repository', 'worktree', 'terminalType'],
        properties: {
          id: { type: 'string' }, // e.g., "hyfire-work1-claude"
          repository: {
            type: 'object',
            required: ['name', 'path', 'type'],
            properties: {
              name: { type: 'string' }, // e.g., "HyFire2"
              path: { type: 'string' }, // Full path to repo
              type: { type: 'string' }, // hytopia-game, monogame-game, etc.
              masterBranch: { type: 'string', default: 'master' }
            }
          },
          worktree: { type: 'string' }, // e.g., "work1", "work2"
          worktreePath: { type: 'string' }, // Optional override for cwd/worktree path
          terminalType: { type: 'string', enum: ['claude', 'server'] },
          visible: { type: 'boolean', default: true },
          // Optional: run a command immediately on terminal spawn (service-style terminals)
          startCommand: { type: 'string' },
          // Optional: override inactivity timeout for this session (ms). 0 disables timeout.
          timeoutMs: { type: 'number' }
        }
      }
    },

    layout: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['dynamic', 'custom'], default: 'dynamic' },
        arrangement: { type: 'string', default: 'auto' }
      }
    }
  }
};

function validateWorkspace(workspace) {
  const errors = [];

  if (!workspace.workspaceType) {
    workspace.workspaceType = 'single-repo'; // Default for backward compatibility
  }

  const schema = workspace.workspaceType === 'mixed-repo' ? MIXED_REPO_SCHEMA : SINGLE_REPO_SCHEMA;

  // Basic validation
  if (!workspace.id || !/^[a-z0-9-]+$/.test(workspace.id)) {
    errors.push('Workspace ID must be lowercase alphanumeric with hyphens');
  }

  if (!workspace.name || workspace.name.trim().length === 0) {
    errors.push('Workspace name is required');
  }

  // Schema-specific validation
  if (workspace.workspaceType === 'single-repo') {
    if (!workspace.repository || !workspace.repository.path) {
      errors.push('Repository path is required for single-repo workspaces');
    }
  } else if (workspace.workspaceType === 'mixed-repo') {
    if (!workspace.terminals || !Array.isArray(workspace.terminals) || workspace.terminals.length === 0) {
      errors.push('At least one terminal is required for mixed-repo workspaces');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function convertSingleToMixed(singleWorkspace) {
  // Convert single-repo workspace to mixed-repo format
  const terminals = [];
  const terminalPairs = singleWorkspace.terminals?.pairs || 1;

  // Extract repository name from path (e.g., "/path/to/HyFire2" -> "HyFire2")
  const repositoryName = path.basename(String(singleWorkspace.repository.path || '').replace(/[\\/]+$/, '')) || singleWorkspace.id;

  for (let i = 1; i <= terminalPairs; i++) {
    const worktreeName = singleWorkspace.worktrees?.namingPattern?.replace('{n}', i) || `work${i}`;

    terminals.push(
      {
        id: `${repositoryName}-${worktreeName}-claude`,
        repository: {
          name: repositoryName,
          path: singleWorkspace.repository.path,
          type: singleWorkspace.projectType || singleWorkspace.repository.type,
          masterBranch: singleWorkspace.repository.masterBranch || 'master'
        },
        worktree: worktreeName,
        terminalType: 'claude',
        visible: (singleWorkspace.terminals?.defaultVisible || [1, 2, 3]).includes(i)
      },
      {
        id: `${repositoryName}-${worktreeName}-server`,
        repository: {
          name: repositoryName,
          path: singleWorkspace.repository.path,
          type: singleWorkspace.projectType || singleWorkspace.repository.type,
          masterBranch: singleWorkspace.repository.masterBranch || 'master'
        },
        worktree: worktreeName,
        terminalType: 'server',
        visible: (singleWorkspace.terminals?.defaultVisible || [1, 2, 3]).includes(i)
      }
    );
  }

  return {
    ...singleWorkspace,
    workspaceType: 'mixed-repo',
    terminals: terminals,
    layout: {
      type: 'dynamic',
      arrangement: 'auto'
    }
  };
}

module.exports = {
  WORKSPACE_TYPES,
  SINGLE_REPO_SCHEMA,
  MIXED_REPO_SCHEMA,
  validateWorkspace,
  convertSingleToMixed
};
