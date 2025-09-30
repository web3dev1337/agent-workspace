// Test script to verify button merge logic
const { WorkspaceManager } = require('./server/workspaceManager');

async function testButtonMerge() {
  console.log('🧪 Testing Button Merge Logic\n');

  // Initialize workspace manager
  const wm = new WorkspaceManager();
  await wm.initialize();

  // Test 1: Get cascaded config for hyfire2-game
  console.log('📋 Test 1: HyFire2 Cascaded Config');
  const hyfire2Config = wm.getCascadedConfig('hyfire2-game');
  if (hyfire2Config) {
    console.log('✅ HyFire2 config loaded');
    if (hyfire2Config.buttons) {
      console.log('✅ Buttons exist:', Object.keys(hyfire2Config.buttons));
      if (hyfire2Config.buttons.server) {
        console.log('   Server buttons:', Object.keys(hyfire2Config.buttons.server));
      }
      if (hyfire2Config.buttons.claude) {
        console.log('   Claude buttons:', Object.keys(hyfire2Config.buttons.claude));
      }
    } else {
      console.log('❌ No buttons in config');
    }
    if (hyfire2Config.gameModes) {
      console.log('✅ Game modes:', Object.keys(hyfire2Config.gameModes).length, 'modes');
    }
  } else {
    console.log('❌ Failed to load hyfire2-game config');
  }

  console.log('\n📋 Test 2: Hytopia 2D Test Cascaded Config');
  const hytopia2dConfig = wm.getCascadedConfig('hytopia-2d-game-test-game');
  if (hytopia2dConfig) {
    console.log('✅ Hytopia 2D Test config loaded');
    if (hytopia2dConfig.buttons) {
      console.log('✅ Buttons exist:', Object.keys(hytopia2dConfig.buttons));
      if (hytopia2dConfig.buttons.server) {
        console.log('   Server buttons:', Object.keys(hytopia2dConfig.buttons.server));
      }
      if (hytopia2dConfig.buttons.claude) {
        console.log('   Claude buttons:', Object.keys(hytopia2dConfig.buttons.claude || {}));
      }
    } else {
      console.log('❌ No buttons in config');
    }
  } else {
    console.log('❌ Failed to load hytopia-2d-game-test-game config');
  }

  console.log('\n📋 Test 3: Direct Merge Test');
  // Test the merge function directly
  const base = {
    buttons: {
      server: {
        play: { icon: '🎮', action: 'playInHytopia' }
      }
    }
  };

  const override = {
    buttons: {
      server: {
        website: { icon: '🌐', action: 'openWebsite' }
      },
      claude: {
        replay: { icon: '📹', action: 'openReplay' }
      }
    }
  };

  const merged = wm.mergeConfigs(base, override);
  console.log('Base buttons:', JSON.stringify(base.buttons, null, 2));
  console.log('Override buttons:', JSON.stringify(override.buttons, null, 2));
  console.log('Merged buttons:', JSON.stringify(merged.buttons, null, 2));

  if (merged.buttons.server.play && merged.buttons.server.website) {
    console.log('✅ Server buttons merged correctly (both play and website exist)');
  } else {
    console.log('❌ Server buttons NOT merged correctly');
  }

  if (merged.buttons.claude && merged.buttons.claude.replay) {
    console.log('✅ Claude buttons added correctly');
  } else {
    console.log('❌ Claude buttons NOT added correctly');
  }

  console.log('\n🎉 Button merge test complete!');
}

testButtonMerge().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});