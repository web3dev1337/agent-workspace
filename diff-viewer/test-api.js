const fetch = require('node-fetch');

const BASE_URL = process.env.DIFF_VIEWER_BASE_URL || 'http://localhost:9462';
const OWNER = process.env.DIFF_VIEWER_DEBUG_OWNER || 'facebook';
const REPO = process.env.DIFF_VIEWER_DEBUG_REPO || 'react';
const PR_NUMBER = process.env.DIFF_VIEWER_DEBUG_PR || '25000';

async function testAPI() {
  console.log('🧪 Testing Diff Viewer API...\n');
  
  try {
    // Test GitHub API
    console.log('📥 Fetching PR data from GitHub API...');
    const githubResponse = await fetch(`${BASE_URL}/api/github/pr/${OWNER}/${REPO}/${PR_NUMBER}`);
    const githubData = await githubResponse.json();
    
    if (githubData.error) {
      console.error('❌ GitHub API Error:', githubData.error);
      return;
    }
    
    console.log(`✅ Fetched ${githubData.files.length} files\n`);
    
    // Check first 3 files
    githubData.files.slice(0, 3).forEach((file, i) => {
      console.log(`📄 File ${i + 1}: ${file.filename}`);
      console.log(`   Status: ${file.status}`);
      console.log(`   Has patch: ${!!file.patch} (${file.patch?.length || 0} chars)`);
      console.log(`   oldContent: ${file.oldContent?.length || 0} chars`);
      console.log(`   newContent: ${file.newContent?.length || 0} chars`);
      
      if (file.newContent) {
        console.log(`   First 100 chars of new content:`);
        console.log(`   "${file.newContent.substring(0, 100)}..."`);
      }
      console.log('');
    });
    
    // Test Diff Analysis API
    console.log('📊 Testing Diff Analysis API...');
    const diffResponse = await fetch(`${BASE_URL}/api/diff/pr/${OWNER}/${REPO}/${PR_NUMBER}`);
    const diffData = await diffResponse.json();
    
    console.log(`✅ Analyzed ${diffData.files.length} files\n`);
    
    // Check first file from diff analysis
    const firstDiff = diffData.files[0];
    console.log('🔍 First file from diff analysis:');
    console.log(`   Path: ${firstDiff.path}`);
    console.log(`   Type: ${firstDiff.type}`);
    console.log(`   Has oldContent: ${!!firstDiff.oldContent}`);
    console.log(`   Has newContent: ${!!firstDiff.newContent}`);
    console.log(`   Has changes array: ${!!firstDiff.changes} (${firstDiff.changes?.length || 0} items)`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Make fetch available
global.fetch = require('node-fetch');
testAPI();
