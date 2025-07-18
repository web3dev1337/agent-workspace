// Example test case for JSON/YAML semantic diff
const JsonYamlDiffEngine = require('../server/diff-engine/json-yaml-diff');

const engine = new JsonYamlDiffEngine();

// Example 1: Package.json changes
const oldPackageJson = `{
  "name": "my-app",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.0",
    "lodash": "^4.17.21"
  },
  "scripts": {
    "start": "node index.js",
    "test": "jest"
  }
}`;

const newPackageJson = `{
  "name": "my-app",
  "version": "1.1.0",
  "dependencies": {
    "express": "^4.19.0",
    "lodash": "^4.17.21",
    "axios": "^1.6.0"
  },
  "scripts": {
    "start": "node src/index.js",
    "test": "jest --coverage",
    "build": "webpack"
  },
  "author": "John Doe"
}`;

console.log('Package.json Semantic Diff:');
const jsonDiff = engine.computeSemanticDiff(oldPackageJson, newPackageJson, 'package.json');
const formattedJson = engine.formatDiff(jsonDiff);
console.log(JSON.stringify(formattedJson, null, 2));

// Example 2: YAML config changes
const oldYaml = `
app:
  name: myapp
  version: 1.0.0
  port: 3000
  
database:
  host: localhost
  port: 5432
  name: mydb
  
features:
  - auth
  - logging
`;

const newYaml = `
app:
  name: myapp
  version: 2.0.0
  port: 8080
  ssl: true
  
database:
  host: db.example.com
  port: 5432
  name: mydb
  pool:
    min: 2
    max: 10
    
features:
  - auth
  - logging
  - caching
  - metrics
`;

console.log('\n\nYAML Config Semantic Diff:');
const yamlDiff = engine.computeSemanticDiff(oldYaml, newYaml, 'config.yml');
const formattedYaml = engine.formatDiff(yamlDiff);
console.log(JSON.stringify(formattedYaml, null, 2));