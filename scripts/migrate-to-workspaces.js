#!/usr/bin/env node

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

async function migrateToWorkspaces() {
  log('🚀 Starting migration to workspace system...', 'blue');
  log('');

  const projectRoot = path.join(__dirname, '..');
  const orchestratorPath = path.join(os.homedir(), '.orchestrator');

  try {
    // 1. Ensure .orchestrator directory structure exists
    log('📁 Creating directory structure...', 'blue');
    await ensureDirectories(orchestratorPath);
    log('✅ Directory structure created', 'green');
    log('');

    // 2. Read current config
    log('📄 Reading current configuration...', 'blue');
    const oldConfigPath = path.join(projectRoot, 'config.json');
    let oldConfig = {};
    try {
      const content = await fs.readFile(oldConfigPath, 'utf8');
      oldConfig = JSON.parse(content);
      log('✅ Current config loaded', 'green');
    } catch (error) {
      log('⚠️  No existing config.json found, will create default', 'yellow');
    }
    log('');

    // 3. Create HyFire 2 workspace config
    log('🔥 Creating HyFire 2 workspace...', 'blue');
    const hyfire2Workspace = createHyFire2Workspace(oldConfig);
    const hyfire2Path = path.join(orchestratorPath, 'workspaces', 'hyfire2.json');
    await fs.writeFile(hyfire2Path, JSON.stringify(hyfire2Workspace, null, 2));
    log('✅ HyFire 2 workspace created', 'green');
    log(`   → ${hyfire2Path}`, 'blue');
    log('');

    // 4. Create master orchestrator config
    log('⚙️  Creating orchestrator config...', 'blue');
    const masterConfig = createMasterConfig(oldConfig);
    const masterConfigPath = path.join(orchestratorPath, 'config.json');
    await fs.writeFile(masterConfigPath, JSON.stringify(masterConfig, null, 2));
    log('✅ Orchestrator config created', 'green');
    log(`   → ${masterConfigPath}`, 'blue');
    log('');

    // 5. Backup old config
    if (fsSync.existsSync(oldConfigPath)) {
      log('💾 Backing up old config...', 'blue');
      const backupPath = path.join(projectRoot, 'config.json.pre-workspace-backup');
      await fs.copyFile(oldConfigPath, backupPath);
      log('✅ Old config backed up', 'green');
      log(`   → ${backupPath}`, 'blue');
      log('');
    }

    // 6. Create launch settings templates
    log('📋 Creating launch settings templates...', 'blue');
    await createLaunchSettingsTemplates(orchestratorPath);
    log('✅ Launch settings templates created', 'green');
    log('');

    // 7. Create example workspaces
    log('📝 Creating example workspace configs...', 'blue');
    await createExampleWorkspaces(orchestratorPath);
    log('✅ Example workspaces created', 'green');
    log('');

    // Success!
    log('════════════════════════════════════════════', 'green');
    log('✅ Migration completed successfully!', 'green');
    log('════════════════════════════════════════════', 'green');
    log('');
    log('📂 Workspace configs location:', 'blue');
    log(`   ${path.join(orchestratorPath, 'workspaces')}`, 'reset');
    log('');
    log('🎯 Next steps:', 'blue');
    log('   1. Review the generated workspace configs', 'reset');
    log('   2. Customize as needed', 'reset');
    log('   3. Restart the orchestrator', 'reset');
    log('');
    log('💡 Your HyFire 2 workspace is ready at:', 'blue');
    log(`   ${hyfire2Path}`, 'reset');
    log('');

  } catch (error) {
    log('❌ Migration failed:', 'red');
    log(error.message, 'red');
    console.error(error);
    process.exit(1);
  }
}

async function ensureDirectories(basePath) {
  const dirs = [
    basePath,
    path.join(basePath, 'workspaces'),
    path.join(basePath, 'templates', 'workspaces'),
    path.join(basePath, 'templates', 'launch-settings'),
    path.join(basePath, 'session-states')
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

function createHyFire2Workspace(oldConfig) {
  return {
    id: 'hyfire2',
    name: 'HyFire 2',
    type: 'hytopia-game',
    icon: '🔥',
    description: 'Tactical 5v5 shooter for Hytopia',
    access: 'team',

    repository: {
      path: '/home/ab/HyFire2',
      masterBranch: 'master',
      remote: 'https://github.com/web3dev1337/hyfire2'
    },

    worktrees: {
      enabled: true,
      count: 8,
      namingPattern: 'work{n}',
      autoCreate: false
    },

    terminals: {
      pairs: 8,
      defaultVisible: [1, 2, 3],
      layout: 'dynamic'
    },

    launchSettings: {
      type: 'hytopia-game',
      defaults: {
        envVars: 'AUTO_START_WITH_BOTS=true NODE_ENV=development',
        nodeOptions: '--max-old-space-size=4096',
        gameArgs: '--mode=casual --roundtime=60 --buytime=10 --warmup=5 --maxrounds=13 --teamsize=5'
      },
      perWorktree: {}
    },

    shortcuts: [
      {
        label: 'Play in Hytopia',
        icon: '🎮',
        action: 'playInHytopia',
        visibility: 'server-running'
      },
      {
        label: 'Build Production',
        icon: '📦',
        action: 'buildProduction'
      },
      {
        label: 'Replay Viewer',
        icon: '📹',
        action: 'openReplayViewer',
        visibility: 'claude-session'
      }
    ],

    quickLinks: [
      {
        category: 'Monitoring',
        links: [
          { label: 'Sentry Dashboard', url: 'https://sentry.io/organizations/your-org/issues/' },
          { label: 'Game Analytics', url: 'https://sentry.io/organizations/your-org/performance/' }
        ]
      },
      {
        category: 'Documentation',
        links: [
          { label: 'Hytopia Docs', url: 'https://docs.hytopia.com' },
          { label: 'API Reference', url: 'https://docs.hytopia.com/api' }
        ]
      }
    ],

    theme: {
      primaryColor: '#ff6b35',
      icon: '🔥'
    },

    notifications: {
      enabled: true,
      background: true,
      types: {
        error: true,
        buildComplete: true,
        prReady: true,
        claudeWaiting: false
      },
      priority: 'high'
    }
  };
}

function createMasterConfig(oldConfig) {
  return {
    version: '2.0.0',
    activeWorkspace: 'hyfire2',
    workspaceDirectory: path.join(os.homedir(), '.orchestrator', 'workspaces'),

    discovery: {
      scanPaths: [
        path.join(os.homedir(), 'GitHub', 'games'),
        path.join(os.homedir(), 'GitHub', 'website'),
        path.join(os.homedir(), 'GitHub', 'tools')
      ],
      exclude: ['node_modules', '.git', 'dist', 'build', 'target']
    },

    globalShortcuts: [
      {
        label: 'GitHub Profile',
        url: 'https://github.com/web3dev1337',
        icon: '💻'
      },
      {
        label: 'Claude Code Docs',
        url: 'https://docs.claude.com',
        icon: '📚'
      }
    ],

    server: {
      port: oldConfig.server?.port || 3000,
      host: oldConfig.server?.host || '0.0.0.0'
    },

    ui: {
      theme: 'dark',
      startupDashboard: false,  // Start with HyFire 2 by default (backward compat)
      rememberLastWorkspace: true
    },

    orchestratorStartup: {
      autoUpdate: true,
      openBrowserOnStart: true,
      checkForNewRepos: false
    },

    user: {
      username: 'web3dev1337',
      teammates: [
        {
          username: 'Anrokx',
          access: 'team',
          repos: ['hyfire2', 'epic-survivors']
        }
      ]
    }
  };
}

async function createLaunchSettingsTemplates(basePath) {
  const templatesPath = path.join(basePath, 'templates', 'launch-settings');

  // Hytopia Game template (based on current HyFire settings)
  const hytopiaTemplate = {
    id: 'hytopia-game',
    name: 'Hytopia Game Settings',
    modalStructure: {
      tabs: ['game-rules', 'timing', 'server', 'advanced']
    },
    defaults: {
      envVars: 'AUTO_START_WITH_BOTS=true NODE_ENV=development',
      nodeOptions: '--max-old-space-size=4096',
      gameArgs: '--mode=casual --roundtime=60 --buytime=10 --warmup=5 --maxrounds=13 --teamsize=5'
    }
  };

  await fs.writeFile(
    path.join(templatesPath, 'hytopia-game.json'),
    JSON.stringify(hytopiaTemplate, null, 2)
  );

  // Website template
  const websiteTemplate = {
    id: 'website',
    name: 'Website Settings',
    modalStructure: {
      tabs: ['server', 'build']
    },
    defaults: {
      envVars: 'NODE_ENV=development',
      nodeOptions: '',
      gameArgs: ''
    }
  };

  await fs.writeFile(
    path.join(templatesPath, 'website.json'),
    JSON.stringify(websiteTemplate, null, 2)
  );

  // Writing template (minimal)
  const writingTemplate = {
    id: 'writing',
    name: 'Writing Project Settings',
    modalStructure: {
      tabs: []
    },
    defaults: {
      envVars: '',
      nodeOptions: '',
      gameArgs: ''
    }
  };

  await fs.writeFile(
    path.join(templatesPath, 'writing.json'),
    JSON.stringify(writingTemplate, null, 2)
  );
}

async function createExampleWorkspaces(basePath) {
  const workspacesPath = path.join(basePath, 'workspaces');

  // Example: Book workspace
  const bookWorkspace = {
    id: 'book',
    name: 'Book Writing',
    type: 'writing',
    icon: '📖',
    description: 'Writing and editing book manuscript',
    access: 'private',

    repository: {
      path: path.join(os.homedir(), 'writing', 'book'),
      masterBranch: 'main',
      remote: ''
    },

    worktrees: {
      enabled: false,
      count: 1,
      namingPattern: 'work{n}',
      autoCreate: false
    },

    terminals: {
      pairs: 1,
      defaultVisible: [1],
      layout: 'dynamic'
    },

    launchSettings: {
      type: 'writing',
      defaults: {
        envVars: '',
        nodeOptions: '',
        gameArgs: ''
      },
      perWorktree: {}
    },

    shortcuts: [
      {
        label: 'Preview Markdown',
        icon: '👁',
        action: 'previewMarkdown'
      },
      {
        label: 'Export PDF',
        icon: '📄',
        action: 'exportPDF'
      }
    ],

    quickLinks: [],

    theme: {
      primaryColor: '#8b5cf6',
      icon: '📖'
    },

    notifications: {
      enabled: true,
      background: false,
      types: {},
      priority: 'low'
    }
  };

  await fs.writeFile(
    path.join(workspacesPath, 'book.json.example'),
    JSON.stringify(bookWorkspace, null, 2)
  );
}

// Run migration
migrateToWorkspaces();