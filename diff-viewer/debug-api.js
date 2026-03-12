// Debug script to test the API
const fetch = require('node-fetch');

const BASE_URL = process.env.DIFF_VIEWER_BASE_URL || 'http://localhost:9462';
const OWNER = process.env.DIFF_VIEWER_DEBUG_OWNER || 'facebook';
const REPO = process.env.DIFF_VIEWER_DEBUG_REPO || 'react';
const PR_NUMBER = process.env.DIFF_VIEWER_DEBUG_PR || '25000';

async function testAPI() {
  console.log('Testing diff viewer API...\n');
  
  // Test health endpoint
  try {
    const health = await fetch(`${BASE_URL}/api/health`);
    const healthData = await health.json();
    console.log('✅ Health check:', healthData);
  } catch (e) {
    console.log('❌ Health check failed:', e.message);
  }
  
  // Test a PR (override via env: DIFF_VIEWER_DEBUG_OWNER/REPO/PR)
  try {
    console.log(`\n📋 Testing PR fetch (${OWNER}/${REPO} #${PR_NUMBER})...`);
    const response = await fetch(`${BASE_URL}/api/github/pr/${OWNER}/${REPO}/${PR_NUMBER}`);
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
}

// Make sure fetch is available
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

testAPI();
