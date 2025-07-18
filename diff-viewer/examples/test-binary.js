// Example test case for binary file diff
const BinaryDiffEngine = require('../server/diff-engine/binary-diff');

const engine = new BinaryDiffEngine();

async function testBinaryDiff() {
  // Example 1: Image file
  console.log('Testing Image Binary Diff:');
  const oldImage = Buffer.from('fake old image data here', 'utf8');
  const newImage = Buffer.from('fake new image data here with more content and changes', 'utf8');
  
  const imageDiff = await engine.computeBinaryDiff(oldImage, newImage, 'logo.png');
  const formattedImage = engine.formatBinaryDiff(imageDiff);
  console.log(JSON.stringify(formattedImage, null, 2));
  
  // Example 2: PDF document
  console.log('\n\nTesting PDF Binary Diff:');
  const oldPdf = Buffer.alloc(1024 * 50); // 50KB
  oldPdf.fill('A');
  const newPdf = Buffer.alloc(1024 * 75); // 75KB
  newPdf.fill('B');
  
  const pdfDiff = await engine.computeBinaryDiff(oldPdf, newPdf, 'document.pdf');
  const formattedPdf = engine.formatBinaryDiff(pdfDiff);
  console.log(JSON.stringify(formattedPdf, null, 2));
  
  // Example 3: Unchanged binary
  console.log('\n\nTesting Unchanged Binary:');
  const sameData = Buffer.from('same content', 'utf8');
  const unchangedDiff = await engine.computeBinaryDiff(sameData, sameData, 'data.bin');
  const formattedUnchanged = engine.formatBinaryDiff(unchangedDiff);
  console.log(JSON.stringify(formattedUnchanged, null, 2));
}

testBinaryDiff().catch(console.error);