// 3-Level Workspace Hierarchy: GAME → FRAMEWORK → SPECIFIC_GAME

// Level 1: Base Game Category
const GAME_CATEGORY = {
  id: 'game',
  name: 'Game Development',
  description: 'Game development projects',
  icon: '🎮'
};

// Level 2: Framework/Engine Types
const FRAMEWORK_TYPES = {
  'hytopia-framework': {
    id: 'hytopia-framework',
    name: 'Hytopia SDK',
    description: 'Voxel-based game framework',
    category: 'game',
    baseCommand: 'hytopia start',
    commonFlags: {
      'NODE_ENV': {
        type: 'select',
        options: ['development', 'production'],
        default: 'development'
      },
      'AUTO_START_WITH_BOTS': {
        type: 'boolean',
        default: true
      },
      'DEBUG': {
        type: 'boolean',
        default: false
      },
      'LOG_LEVEL': {
        type: 'select',
        options: ['debug', 'info', 'warn', 'error'],
        default: 'info'
      }
    },
    defaultTerminalPairs: 6,
    maxTerminalPairs: 16,
    requiresServer: true,
    icon: '🎮',
    detectPatterns: {
      files: ['package.json'],
      content: { 'package.json': ['hytopia'] }
    }
  },
  'monogame-framework': {
    id: 'monogame-framework',
    name: 'MonoGame Framework',
    description: 'Cross-platform C# game framework',
    category: 'game',
    baseCommand: 'dotnet run',
    commonFlags: {
      'Configuration': {
        type: 'select',
        options: ['Debug', 'Release'],
        default: 'Debug'
      },
      'Platform': {
        type: 'select',
        options: ['AnyCPU', 'x64', 'x86'],
        default: 'AnyCPU'
      },
      'Verbosity': {
        type: 'select',
        options: ['minimal', 'normal', 'detailed'],
        default: 'normal'
      }
    },
    defaultTerminalPairs: 4,
    maxTerminalPairs: 8,
    requiresServer: false,
    icon: '🕹️',
    detectPatterns: {
      files: ['*.csproj'],
      content: { '*.csproj': ['MonoGame'] }
    }
  }
};

// Level 3: Specific Game Types (inherit from frameworks)
const WORKSPACE_TYPES = {
  // === HYTOPIA GAMES === (inherit from hytopia-framework)
  'voxfire-game': {
    id: 'voxfire-game',
    name: 'VoxFire (HyFire2)',
    description: 'Tactical 5v5 shooter with multiple game modes',
    inherits: 'hytopia-framework',
    gameSpecificModes: ['competitive', 'casual', 'team_deathmatch', 'ffa_deathmatch', 'zombies_horde'],
    defaultTerminalPairs: 8,
    maxTerminalPairs: 16,
    launchSettingsTemplate: 'voxfire-game',
    icon: '🔥',
    detectPatterns: {
      files: ['src/config/gameConfig.ts'],
      content: { 'src/config/gameConfig.ts': ['competitive', 'casual'] },
      path: '/games/hytopia/games/HyFire2'
    }
  },
  'zombies-fps-game': {
    id: 'zombies-fps-game',
    name: 'Zombies FPS',
    description: 'Zombie survival FPS game',
    inherits: 'hytopia-framework',
    gameSpecificModes: ['survival', 'waves', 'hardcore'],
    defaultTerminalPairs: 4,
    maxTerminalPairs: 8,
    launchSettingsTemplate: 'zombies-fps-game',
    icon: '🧟',
    detectPatterns: {
      path: '/games/hytopia/games/zombies-fps'
    }
  },
  'hytopia-2d-game': {
    id: 'hytopia-2d-game',
    name: 'Hytopia 2D Game',
    description: '2D game development with Hytopia SDK',
    inherits: 'hytopia-framework',
    gameSpecificModes: ['arcade', 'puzzle'],
    defaultTerminalPairs: 3,
    maxTerminalPairs: 6,
    launchSettingsTemplate: 'hytopia-2d-game',
    icon: '🎯',
    detectPatterns: {
      path: '/games/hytopia/games/hytopia-2d-game-test'
    }
  },
  'astro-breaker-game': {
    id: 'astro-breaker-game',
    name: 'Astro Breaker',
    description: 'Space-themed arcade game',
    inherits: 'hytopia-framework',
    gameSpecificModes: ['classic', 'endless'],
    defaultTerminalPairs: 3,
    maxTerminalPairs: 6,
    launchSettingsTemplate: 'astro-breaker-game',
    icon: '🚀',
    detectPatterns: {
      path: '/games/hytopia/games/astro-breaker'
    }
  },

  // === MONOGAME GAMES === (inherit from monogame-framework)
  'epic-survivors-game': {
    id: 'epic-survivors-game',
    name: 'Epic Survivors',
    description: 'Survivors-like game with MonoGame',
    inherits: 'monogame-framework',
    gameSpecificModes: ['debug', 'release', 'profiling'],
    defaultTerminalPairs: 4,
    maxTerminalPairs: 8,
    launchSettingsTemplate: 'epic-survivors-game',
    icon: '⚔️',
    detectPatterns: {
      files: ['EpicSurvivors.csproj'],
      path: '/games/monogame/epic-survivors'
    }
  },

  // === LEGACY COMPATIBILITY === (for existing workspaces)
  'hytopia-game': {
    id: 'hytopia-game',
    name: 'Hytopia Game (Generic)',
    description: 'Generic Hytopia SDK game',
    inherits: 'hytopia-framework',
    defaultTerminalPairs: 6,
    maxTerminalPairs: 16,
    launchSettingsTemplate: 'hytopia-game',
    icon: '🎮',
    detectPatterns: {
      files: ['package.json'],
      content: { 'package.json': ['hytopia'] }
    }
  },
  'monogame-game': {
    id: 'monogame-game',
    name: 'MonoGame Game (Generic)',
    description: 'Generic MonoGame framework game',
    inherits: 'monogame-framework',
    defaultTerminalPairs: 4,
    maxTerminalPairs: 8,
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

  const hasRepoPath = Boolean(
    workspace.repository &&
    typeof workspace.repository.path === 'string' &&
    workspace.repository.path.trim().length > 0
  );
  const allowEmptyRepo = workspace.empty === true || workspace.isBlank === true || workspace.allowEmptyRepository === true;

  if (!workspace.id || !/^[a-z0-9-]+$/.test(workspace.id)) {
    errors.push('Workspace ID must be lowercase alphanumeric with hyphens');
  }

  if (!workspace.name || workspace.name.trim().length === 0) {
    errors.push('Workspace name is required');
  }

  if (!workspace.type || !WORKSPACE_TYPES[workspace.type]) {
    errors.push(`Invalid workspace type: ${workspace.type}`);
  }

  if (!hasRepoPath && !allowEmptyRepo) {
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

/**
 * Resolve workspace type with inheritance from framework
 */
function resolveWorkspaceType(workspaceTypeId) {
  const workspaceType = WORKSPACE_TYPES[workspaceTypeId];
  if (!workspaceType) return null;

  // If no inheritance, return as-is
  if (!workspaceType.inherits) return workspaceType;

  // Merge with framework type
  const frameworkType = FRAMEWORK_TYPES[workspaceType.inherits];
  if (!frameworkType) {
    console.warn(`Framework ${workspaceType.inherits} not found for ${workspaceTypeId}`);
    return workspaceType;
  }

  // Merge framework and game-specific settings
  return {
    ...frameworkType,
    ...workspaceType,
    // Merge common flags with game-specific ones
    commonFlags: {
      ...frameworkType.commonFlags,
      ...(workspaceType.commonFlags || {})
    },
    // Keep both framework and game-specific detection patterns
    detectPatterns: {
      ...frameworkType.detectPatterns,
      ...workspaceType.detectPatterns
    }
  };
}

/**
 * Get workspace type info with inheritance resolved
 */
function getWorkspaceTypeInfoWithInheritance(workspaceTypeId) {
  return resolveWorkspaceType(workspaceTypeId);
}

/**
 * Get all workspace types organized by framework
 */
function getWorkspaceTypesByFramework() {
  const byFramework = {};

  // Add framework categories
  Object.values(FRAMEWORK_TYPES).forEach(framework => {
    byFramework[framework.id] = {
      framework: framework,
      games: []
    };
  });

  // Add games to their frameworks
  Object.values(WORKSPACE_TYPES).forEach(gameType => {
    if (gameType.inherits && byFramework[gameType.inherits]) {
      byFramework[gameType.inherits].games.push(gameType);
    } else {
      // Standalone types (website, tool-project, etc.)
      if (!byFramework['standalone']) {
        byFramework['standalone'] = { framework: null, games: [] };
      }
      byFramework['standalone'].games.push(gameType);
    }
  });

  return byFramework;
}

module.exports = {
  GAME_CATEGORY,
  FRAMEWORK_TYPES,
  WORKSPACE_TYPES,
  WORKSPACE_SCHEMA,
  validateWorkspace,
  getWorkspaceTypeInfo,
  getDefaultWorkspaceConfig,
  resolveWorkspaceType,
  getWorkspaceTypeInfoWithInheritance,
  getWorkspaceTypesByFramework
};
