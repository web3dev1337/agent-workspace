const { DiffEngine } = require('./server/diff-engine/engine');

async function main() {
  const engine = new DiffEngine();

  const patch = [
    '@@ -1,12 +1,14 @@',
    '-foo();',
    '-foo();',
    '-foo();',
    '+bar();',
    '+bar();',
    '+bar();',
    ' function keepThisContextLine() {',
    '   return true;',
    ' }',
    '+console.log(\"DUP\");',
    '+console.log(\"DUP\");',
    '@@ -20,3 +22,0 @@',
    '-moveMe1',
    '-moveMe2',
    '-moveMe3',
    '@@ -40,0 +45,3 @@',
    '+moveMe1',
    '+moveMe2',
    '+moveMe3'
  ].join('\n');

  const analysis = await engine.analyzeDiff({
    filename: 'test.js',
    patch
  });

  const sampleUpdated = analysis?.richText?.hunks
    ?.flatMap(h => h.rows)
    ?.find(r => r.type === 'updated');

  console.log(
    JSON.stringify(
      {
        type: analysis?.type,
        changes: analysis?.changes?.length,
        stats: analysis?.stats,
        richType: analysis?.richText?.type,
        operations: analysis?.richText?.operations,
        findReplace: analysis?.richText?.findReplace,
        movedBlocks: analysis?.richText?.movedBlocks,
        copyPaste: analysis?.richText?.copyPaste,
        sampleUpdated: sampleUpdated
          ? {
              oldLine: sampleUpdated.oldLine,
              newLine: sampleUpdated.newLine,
              oldContent: sampleUpdated.oldContent,
              newContent: sampleUpdated.newContent,
              oldSegments: sampleUpdated.oldSegments,
              newSegments: sampleUpdated.newSegments
            }
          : null
      },
      null,
      2
    )
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
