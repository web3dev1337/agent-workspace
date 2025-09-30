// Debug script to trace cascading config merge
const { WorkspaceManager } = require('./server/workspaceManager');

async function debugCascade() {
  console.log('🔍 Debugging Cascaded Config Merge\n');

  const wm = new WorkspaceManager();
  await wm.initialize();

  console.log('📋 Testing HyFire2 cascade:');

  // Get the specific game config
  const hyfire2 = wm.discoveredWorkspaceTypes.games?.['hyfire2-game'];
  console.log('\n1️⃣ HyFire2 Specific Config:');
  console.log('  - id:', hyfire2?.id);
  console.log('  - inherits:', hyfire2?.inherits);
  console.log('  - buttons:', JSON.stringify(hyfire2?.buttons, null, 4));

  // Get framework
  const frameworkId = hyfire2?.inherits;
  const framework = frameworkId && wm.discoveredWorkspaceTypes.frameworks?.[frameworkId];
  console.log('\n2️⃣ Hytopia Framework Config:');
  console.log('  - id:', framework?.id);
  console.log('  - buttons:', JSON.stringify(framework?.buttons, null, 4));

  // Get category
  const categoryId = framework?.category;
  const category = categoryId && wm.discoveredWorkspaceTypes.categories?.[categoryId];
  console.log('\n3️⃣ Games Category Config:');
  console.log('  - id:', category?.id);
  console.log('  - buttons:', category?.buttons ? JSON.stringify(category.buttons, null, 4) : 'none');

  // Get cascaded result
  console.log('\n4️⃣ Cascaded Result (getCascadedConfig):');
  const cascaded = wm.getCascadedConfig('hyfire2-game');
  console.log('  - buttons:', JSON.stringify(cascaded?.buttons, null, 4));

  // Manual merge test
  console.log('\n5️⃣ Manual Merge Test:');
  console.log('Merging framework buttons with project buttons...');
  const frameworkButtons = framework?.buttons || {};
  const projectButtons = hyfire2?.buttons || {};
  console.log('  - Framework buttons:', JSON.stringify(frameworkButtons, null, 4));
  console.log('  - Project buttons:', JSON.stringify(projectButtons, null, 4));
  const merged = wm.mergeConfigs(frameworkButtons, projectButtons);
  console.log('  - Merged result:', JSON.stringify(merged, null, 4));
}

debugCascade().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});