const {
  parseArgs,
  scanMarkdown,
  renderJsonReport,
  resolveOutputFormat,
  filterScansForActionable
} = require('../../scripts/scan-markdown-remaining');

describe('scan-markdown-remaining helpers', () => {
  test('parseArgs supports --format and --json', () => {
    const a = parseArgs(['--scope', 'recent', '--since-days', '14', '--format', 'json']);
    expect(a.scope).toBe('recent');
    expect(a.sinceDays).toBe(14);
    expect(a.format).toBe('json');

    const b = parseArgs(['--json']);
    expect(b.format).toBe('json');

    const c = parseArgs(['--actionable-only']);
    expect(c.actionableOnly).toBe(true);
  });

  test('resolveOutputFormat infers json from output extension', () => {
    expect(resolveOutputFormat({ format: null }, '/tmp/report.json')).toBe('json');
    expect(resolveOutputFormat({ format: null }, '/tmp/report.md')).toBe('markdown');
    expect(resolveOutputFormat({ format: 'markdown' }, '/tmp/report.json')).toBe('markdown');
  });

  test('renderJsonReport returns structured payload', () => {
    const scanned = [
      scanMarkdown('PLANS/A.md', '# Remaining\n- [ ] one\n'),
      scanMarkdown('PLANS/B.md', '# Done\n')
    ];
    const raw = renderJsonReport({ scope: 'all', sinceDays: 7, files: scanned });
    const parsed = JSON.parse(raw);

    expect(parsed.scope).toBe('all');
    expect(parsed.summary.scanned).toBe(2);
    expect(parsed.summary.withRemaining).toBe(1);
    expect(parsed.filesWithRemaining).toHaveLength(1);
    expect(parsed.filesWithoutRemaining).toEqual(['PLANS/B.md']);
  });

  test('filterScansForActionable keeps only actionable backlog rows', () => {
    const scans = [
      scanMarkdown('PLANS/A.md', '# Remaining\n- [ ] one\n'),
      scanMarkdown('PLANS/2026-02-02/REMAINING_WORK_LAST_10_DAYS_SCAN.md', '# Remaining\nTODO token\n'),
      scanMarkdown('PLANS/2026-01-20/CHECKLIST.md', '- [ ] template item\n'),
      scanMarkdown('PLANS/B.md', '# Done\n')
    ];
    const filtered = filterScansForActionable(scans);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].filePath).toBe('PLANS/A.md');
  });
});
