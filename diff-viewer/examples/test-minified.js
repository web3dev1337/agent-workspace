// Example test case for minified file diff
const MinifiedDiffEngine = require('../server/diff-engine/minified-diff');

const engine = new MinifiedDiffEngine();

// Example 1: Minified JavaScript
const oldJS = 'function calculate(a,b){var c=a+b;return c*2;}var x=calculate(5,3);console.log(x);';
const newJS = 'function calculate(a,b,c){var d=a+b+c;return d*3;}var x=calculate(5,3,2);var y=x+10;console.log(y);';

console.log('JavaScript Minified Diff:');
const jsDiff = engine.generateMinifiedDiff(oldJS, newJS, 'app.min.js');
console.log(JSON.stringify(jsDiff, null, 2));

// Example 2: Minified CSS
const oldCSS = '.btn{color:red;padding:10px;margin:5px}.container{width:100%;display:flex}';
const newCSS = '.btn{color:blue;padding:15px;margin:5px;border:1px solid}.container{width:90%;display:grid;gap:10px}';

console.log('\nCSS Minified Diff:');
const cssDiff = engine.generateMinifiedDiff(oldCSS, newCSS, 'styles.min.css');
console.log(JSON.stringify(cssDiff, null, 2));