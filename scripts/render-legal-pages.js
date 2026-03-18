const fs = require('fs/promises');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const docs = [
  {
    source: path.join(repoRoot, 'docs', 'legal', 'TERMS_OF_USE.md'),
    target: path.join(repoRoot, 'site', 'terms.html'),
    title: 'Agent Workspace Terms of Use'
  },
  {
    source: path.join(repoRoot, 'docs', 'legal', 'PRIVACY_POLICY.md'),
    target: path.join(repoRoot, 'site', 'privacy.html'),
    title: 'Agent Workspace Privacy Policy'
  }
];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text) {
  let rendered = escapeHtml(text);
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = href.trim();
    const external = /^https?:\/\//i.test(safeHref);
    const attrs = external ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${safeHref}"${attrs}>${label}</a>`;
  });
  rendered = rendered.replace(/`([^`]+)`/g, '<code>$1</code>');
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return rendered;
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function createSection(title, parts) {
  return `<section class="legal-section">\n<h2>${renderInline(title)}</h2>\n${parts.join('\n')}\n</section>`;
}

function renderBody(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const content = [];
  let sectionTitle = null;
  let sectionParts = [];
  let paragraphLines = [];
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const html = `<p>${renderInline(paragraphLines.join(' ').trim())}</p>`;
    if (sectionTitle) sectionParts.push(html);
    else content.push(html);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const html = `<ul>\n${listItems.map((item) => `  <li>${renderInline(item)}</li>`).join('\n')}\n</ul>`;
    if (sectionTitle) sectionParts.push(html);
    else content.push(html);
    listItems = [];
  };

  const flushSection = () => {
    flushParagraph();
    flushList();
    if (!sectionTitle) return;
    content.push(createSection(sectionTitle, sectionParts));
    sectionTitle = null;
    sectionParts = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith('## ')) {
      flushSection();
      sectionTitle = line.slice(3).trim();
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushList();
      const html = `<h3>${renderInline(line.slice(4).trim())}</h3>`;
      if (sectionTitle) sectionParts.push(html);
      else content.push(html);
      continue;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      listItems.push(line.slice(2).trim());
      continue;
    }

    paragraphLines.push(line);
  }

  flushSection();
  flushParagraph();
  flushList();

  return content.join('\n\n');
}

function extractDocument(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const titleLineIndex = lines.findIndex((line) => line.startsWith('# '));
  if (titleLineIndex === -1) {
    throw new Error('Missing top-level markdown title');
  }

  const heading = lines[titleLineIndex].slice(2).trim();
  let effectiveDate = '';
  let startIndex = titleLineIndex + 1;

  for (let index = titleLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      startIndex = index + 1;
      continue;
    }
    if (/^Effective date:/i.test(line)) {
      effectiveDate = line;
      startIndex = index + 1;
    }
    break;
  }

  const bodyMarkdown = lines.slice(startIndex).join('\n').trim();
  const bodyHtml = renderBody(bodyMarkdown);
  const firstParagraphMatch = bodyHtml.match(/<p>(.*?)<\/p>/i);
  const descriptionSource = stripTags(firstParagraphMatch ? firstParagraphMatch[1] : bodyHtml);
  const description = descriptionSource.length > 160
    ? `${descriptionSource.slice(0, 157).replace(/\s+\S*$/, '').trim()}...`
    : descriptionSource;
  return {
    heading,
    effectiveDate,
    bodyHtml,
    description
  };
}

function renderPage({ title, sourcePath, heading, effectiveDate, bodyHtml, description }) {
  const sourceRelative = path.relative(repoRoot, sourcePath).replace(/\\/g, '/');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
  <link rel="stylesheet" href="styles.css">
</head>
<body class="legal-page">
  <main class="legal-main">
    <div class="legal-shell">
      <a class="legal-back" href="index.html">← Back to Agent Workspace</a>
      <article class="legal-card">
        <!-- Generated from ${sourceRelative}. Do not edit by hand. Run npm run site:legal. -->
        <p class="legal-kicker">Agent Workspace</p>
        <h1>${escapeHtml(heading)}</h1>
        <p class="legal-updated">${escapeHtml(effectiveDate)}</p>
        ${bodyHtml}
      </article>
    </div>
  </main>

  <footer class="fluid-footer">
    <div class="footer-content">
      <div class="brand">
        <div class="brand-orb small"></div>
        <span>Agent Workspace</span>
      </div>
      <div class="footer-links">
        <a href="index.html">Home</a>
        <a href="terms.html">Terms</a>
        <a href="privacy.html">Privacy</a>
        <a href="https://github.com/web3dev1337/agent-workspace/releases/latest" target="_blank" rel="noopener">Download</a>
      </div>
      <div class="copyright">© <span id="copy-year"></span> <a href="https://github.com/web3dev1337/agent-workspace" target="_blank" rel="noopener">Neural Pixel</a></div>
    </div>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`;
}

async function renderDoc(config) {
  const markdown = await fs.readFile(config.source, 'utf8');
  const parsed = extractDocument(markdown);
  const html = renderPage({
    title: config.title,
    sourcePath: config.source,
    ...parsed
  });
  await fs.writeFile(config.target, html, 'utf8');
}

async function main() {
  for (const doc of docs) {
    await renderDoc(doc);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
