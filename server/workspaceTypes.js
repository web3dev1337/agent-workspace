// Workspace type definitions and validation

const WORKSPACE_TYPES = {
  'hytopia-game': {
    id: 'hytopia-game',
    name: 'Hytopia Game',
    description: 'Full game development environment for Hytopia SDK games',
    defaultTerminalPairs: 8,
    maxTerminalPairs: 16,
    requiresServer: true,
    launchSettingsTemplate: 'hytopia-game',
    icon: '🎮',
    detectPatterns: {
      files: ['package.json'],
      content: { 'package.json': ['hytopia'] }
    }
  },
  'voxfire-game': {
    id: 'voxfire-game',
    name: 'VoxFire Game',
    description: 'VoxFire (HyFire2) tactical shooter with multiple game modes',
    defaultTerminalPairs: 8,
    maxTerminalPairs: 16,
    requiresServer: true,
    launchSettingsTemplate: 'voxfire-game',
    icon: '🔥',
    detectPatterns: {
      files: ['package.json', 'src/config/gameConfig.ts'],
      content: { 'package.json': ['hytopia'], 'src/config/gameConfig.ts': ['competitive', 'casual'] }
    }
  },
  'monogame-game': {
    id: 'monogame-game',
    name: 'MonoGame Game',
    description: 'C# game development with MonoGame framework',
    defaultTerminalPairs: 6,
    maxTerminalPairs: 8,
    requiresServer: true,
    launchSettingsTemplate: 'monogame-game',
    icon: '🕹️',
    detectPatterns: {
      files: ['*.csproj'],
      content: { '*.csproj': ['MonoGame'] }
    }
  },
  'website': {
    id: 'website',
    name: 'Website/Web App',
    description: 'Frontend or fullstack web application',
    defaultTerminalPairs: 3,
    maxTerminalPairs: 6,
    requiresServer: true,
    launchSettingsTemplate: 'website',
    icon: '🌐',
    detectPatterns: {
      files: ['package.json', 'index.html'],
      content: { 'package.json': ['react', 'vue', 'next', 'vite', 'webpack'] }
    }
  },
  'minecraft-mod': {
    id: 'minecraft-mod',
    name: 'Minecraft Mod',
    description: 'Minecraft mod development (Forge/Fabric)',
    defaultTerminalPairs: 4,
    maxTerminalPairs: 6,
    requiresServer: true,
    launchSettingsTemplate: 'minecraft-mod',
    icon: '⛏️',
    detectPatterns: {
      files: ['build.gradle', 'gradle.properties'],
      content: { 'build.gradle': ['minecraft', 'forge', 'fabric'] }
    }
  },
  'rust-game': {
    id: 'rust-game',
    name: 'Rust Game',
    description: 'Game development with Rust',
    defaultTerminalPairs: 6,
    maxTerminalPairs: 8,
    requiresServer: true,
    launchSettingsTemplate: 'rust-game',
    icon: '🦀',
    detectPatterns: {
      files: ['Cargo.toml'],
      content: { 'Cargo.toml': ['bevy', 'ggez', 'piston', 'amethyst'] }
    }
  },
  'web-game': {
    id: 'web-game',
    name: 'Web Game',
    description: 'Browser-based game development',
    defaultTerminalPairs: 3,
    maxTerminalPairs: 6,
    requiresServer: true,
    launchSettingsTemplate: 'web-game',
    icon: '🎯',
    detectPatterns: {
      files: ['package.json'],
      content: { 'package.json': ['phaser', 'three', 'babylon', 'pixi'] }
    }
  },
  'tool-project': {
    id: 'tool-project',
    name: 'Tool/Utility Project',
    description: 'Development tools, scripts, utilities',
    defaultTerminalPairs: 2,
    maxTerminalPairs: 4,
    requiresServer: false,
    launchSettingsTemplate: 'tool-project',
    icon: '🛠️',
    detectPatterns: {
      files: ['package.json', 'Cargo.toml', 'go.mod'],
      content: {}
    }
  },
  'writing': {
    id: 'writing',
    name: 'Writing Project',
    description: 'Books, articles, documentation, scripts',
    defaultTerminalPairs: 2,
    maxTerminalPairs: 8,
    requiresServer: true,
    launchSettingsTemplate: 'writing',
    icon: '📖',
    detectPatterns: {
      files: ['*.md', '*.txt', '*.tex'],
      content: {}
    }
  },
  'ruby-rails': {
    id: 'ruby-rails',
    name: 'Ruby on Rails',
    description: 'Ruby on Rails web application',
    defaultTerminalPairs: 3,
    maxTerminalPairs: 6,
    requiresServer: true,
    launchSettingsTemplate: 'ruby-rails',
    icon: '💎',
    detectPatterns: {
      files: ['Gemfile', 'config.ru'],
      content: { 'Gemfile': ['rails'] }
    }
  },
  'custom': {
    id: 'custom',
    name: 'Custom Project',
    description: 'Custom project with manual configuration',
    defaultTerminalPairs: 4,
    maxTerminalPairs: 16,
    requiresServer: false,
    launchSettingsTemplate: 'simple',
    icon: '⚙️',
    detectPatterns: {}
  }
};

const WORKSPACE_SCHEMA = {
  required: ['id', 'name', 'type', 'repository'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' },
    name: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: Object.keys(WORKSPACE_TYPES) },
    icon: { type: 'string', default: '📁' },
    description: { type: 'string', default: '' },
    access: { type: 'string', enum: ['private', 'team', 'public'], default: 'private' },

    repository: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string' },
        masterBranch: { type: 'string', default: 'master' },
        remote: { type: 'string' }
      }
    },

    worktrees: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        count: { type: 'number', min: 1, max: 16, default: 8 },
        namingPattern: { type: 'string', default: 'work{n}' },
        autoCreate: { type: 'boolean', default: false }
      }
    },

    terminals: {
      type: 'object',
      properties: {
        pairs: { type: 'number', min: 1, max: 16 },
        defaultVisible: { type: 'array', items: { type: 'number' } },
        layout: { type: 'string', enum: ['dynamic', '1x1', '1x2', '2x2', '2x4'], default: 'dynamic' }
      }
    },

    launchSettings: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        defaults: {
          type: 'object',
          properties: {
            envVars: { type: 'string', default: '' },
            nodeOptions: { type: 'string', default: '' },
            gameArgs: { type: 'string', default: '' }
          }
        },
        perWorktree: { type: 'object', default: {} }
      }
    },

    shortcuts: { type: 'array', default: [] },
    quickLinks: { type: 'array', default: [] },

    theme: {
      type: 'object',
      properties: {
        primaryColor: { type: 'string' },
        icon: { type: 'string' }
      }
    },

    notifications: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        background: { type: 'boolean', default: true },
        types: { type: 'object', default: {} },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'], default: 'normal' }
      }
    }
  }
};

function validateWorkspace(workspace) {
  const errors = [];

  if (!workspace.id || !/^[a-z0-9-]+$/.test(workspace.id)) {
    errors.push('Workspace ID must be lowercase alphanumeric with hyphens');
  }

  if (!workspace.name || workspace.name.trim().length === 0) {
    errors.push('Workspace name is required');
  }

  if (!workspace.type || !WORKSPACE_TYPES[workspace.type]) {
    errors.push(`Invalid workspace type: ${workspace.type}`);
  }

  if (!workspace.repository || !workspace.repository.path) {
    errors.push('Repository path is required');
  }

  if (workspace.terminals && workspace.terminals.pairs) {
    const maxPairs = WORKSPACE_TYPES[workspace.type]?.maxTerminalPairs || 16;
    if (workspace.terminals.pairs > maxPairs) {
      errors.push(`Terminal pairs (${workspace.terminals.pairs}) exceeds maximum (${maxPairs}) for type ${workspace.type}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function getWorkspaceTypeInfo(typeId) {
  return WORKSPACE_TYPES[typeId] || null;
}

function getDefaultWorkspaceConfig(type) {
  const typeInfo = WORKSPACE_TYPES[type];
  if (!typeInfo) return null;

  return {
    type,
    icon: typeInfo.icon,
    terminals: {
      pairs: typeInfo.defaultTerminalPairs,
      defaultVisible: [1, 2, 3],
      layout: 'dynamic'
    },
    worktrees: {
      enabled: true,
      count: 8,
      namingPattern: 'work{n}',
      autoCreate: true
    },
    launchSettings: {
      type: typeInfo.launchSettingsTemplate,
      defaults: {
        envVars: '',
        nodeOptions: '',
        gameArgs: ''
      },
      perWorktree: {}
    },
    shortcuts: [],
    quickLinks: [],
    notifications: {
      enabled: true,
      background: true,
      types: {},
      priority: 'normal'
    }
  };
}

module.exports = {
  WORKSPACE_TYPES,
  WORKSPACE_SCHEMA,
  validateWorkspace,
  getWorkspaceTypeInfo,
  getDefaultWorkspaceConfig
};