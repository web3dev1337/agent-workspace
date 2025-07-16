// Debug script to test the API
const fetch = require('node-fetch');

async function testAPI() {
  console.log('Testing diff viewer API...\n');
  
  // Test health endpoint
  try {
    const health = await fetch('http://localhost:7655/api/health');
    const healthData = await health.json();
    console.log('✅ Health check:', healthData);
  } catch (e) {
    console.log('❌ Health check failed:', e.message);
  }
  
  // Test a known public PR for comparison
  try {
    console.log('\n📋 Testing with a public repo (facebook/react #25000)...');
    const response = await fetch('http://localhost:7655/api/github/pr/facebook/react/25000');
    const data = await response.json();
    
    if (data.error) {
      console.log('❌ Error:', data.error);
    } else {
      console.log('✅ PR fetched successfully');
      console.log('   Files:', data.files.length);
      console.log('   First file:', data.files[0]?.filename);
      console.log('   Has patch?', !!data.files[0]?.patch);
      console.log('   Has oldContent?', !!data.files[0]?.oldContent);
      console.log('   Has newContent?', !!data.files[0]?.newContent);
      
      // Show a sample of the content
      if (data.files[0]?.patch) {
        console.log('\n📄 Sample patch (first 200 chars):');
        console.log(data.files[0].patch.substring(0, 200) + '...');
      }
      
      if (data.files[0]?.oldContent) {
        console.log('\n📄 Sample oldContent (first 200 chars):');
        console.log(data.files[0].oldContent.substring(0, 200) + '...');
      }
    }
  } catch (e) {
    console.log('❌ API test failed:', e.message);
  }
  
  // Test your private repo
  console.log('\n📋 Testing with HyFire2 PR #876...');
  try {
    const response = await fetch('http://localhost:7655/api/github/pr/NeuralPixelGames/HyFire2/876');
    const data = await response.json();
    
    if (data.error) {
      console.log('❌ Error:', data.error, data.message);
    } else {
      console.log('✅ PR fetched successfully');
      console.log('   Files:', data.files.length);
      data.files.slice(0, 3).forEach((file, i) => {
        console.log(`\n   File ${i + 1}: ${file.filename}`);
        console.log(`   - Status: ${file.status}`);
        console.log(`   - Changes: +${file.additions} -${file.deletions}`);
        console.log(`   - Has patch? ${!!file.patch}`);
        console.log(`   - Has content? old=${!!file.oldContent} new=${!!file.newContent}`);
        console.log(`   - Patch length: ${file.patch?.length || 0}`);
      });
    }
  } catch (e) {
    console.log('❌ Private repo test failed:', e.message);
  }
}

// Make sure fetch is available
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

testAPI();