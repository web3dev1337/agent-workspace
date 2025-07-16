const MinifiedDiffEngine = require('./server/diff-engine/minified-diff');
const JsonYamlDiffEngine = require('./server/diff-engine/json-yaml-diff');
const BinaryDiffEngine = require('./server/diff-engine/binary-diff');

// Test Minified Diff Engine
console.log('Testing Minified Diff Engine...');
const minifiedEngine = new MinifiedDiffEngine();

const oldMinified = 'function calculate(a,b){var c=a+b;return c*2;}var x=calculate(5,3);console.log(x);';
const newMinified = 'function calculate(a,b,c){var d=a+b+c;return d*3;}var x=calculate(5,3,2);var y=x+10;console.log(y);';

const minifiedDiff = minifiedEngine.generateMinifiedDiff(oldMinified, newMinified, 'test.min.js');
console.log('Minified Diff Result:');
console.log(JSON.stringify(minifiedDiff, null, 2));
console.log('\n---\n');

// Test JSON/YAML Diff Engine
console.log('Testing JSON/YAML Diff Engine...');
const jsonYamlEngine = new JsonYamlDiffEngine();

const oldJson = JSON.stringify({
  name: 'test-app',
  version: '1.0.0',
  dependencies: {
    express: '^4.18.0',
    lodash: '^4.17.21'
  },
  scripts: {
    start: 'node index.js',
    test: 'jest'
  }
}, null, 2);

const newJson = JSON.stringify({
  name: 'test-app',
  version: '1.1.0',
  dependencies: {
    express: '^4.19.0',
    lodash: '^4.17.21',
    axios: '^1.6.0'
  },
  scripts: {
    start: 'node src/index.js',
    test: 'jest',
    build: 'webpack'
  },
  author: 'Test Author'
}, null, 2);

const jsonDiff = jsonYamlEngine.computeSemanticDiff(oldJson, newJson, 'package.json');
const formattedJsonDiff = jsonYamlEngine.formatDiff(jsonDiff);
console.log('JSON Diff Result:');
console.log(JSON.stringify(formattedJsonDiff, null, 2));
console.log('\n---\n');

// Test Binary Diff Engine  
console.log('Testing Binary Diff Engine...');
const binaryEngine = new BinaryDiffEngine();

// Simulate binary data
const oldBinary = Buffer.from('Old binary content here with some data', 'utf8');
const newBinary = Buffer.from('New binary content here with much more data and changes', 'utf8');

(async () => {
  const binaryDiff = await binaryEngine.computeBinaryDiff(oldBinary, newBinary, 'test.png');
  const formattedBinaryDiff = binaryEngine.formatBinaryDiff(binaryDiff);
  console.log('Binary Diff Result:');
  console.log(JSON.stringify(formattedBinaryDiff, null, 2));
})();