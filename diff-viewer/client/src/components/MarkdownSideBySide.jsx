import React, { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import mermaid from 'mermaid';
import { useTheme } from '../context/theme';
import './MarkdownSideBySide.css';

let lastMermaidTheme = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildMarkedInstance() {
  const renderer = new marked.Renderer();

  renderer.code = (...args) => {
    let code = '';
    let infostring = '';

    // Marked v14 passes a token object; older versions pass (code, infostring, escaped)
    if (args[0] && typeof args[0] === 'object') {
      code = String(args[0].text || '');
      infostring = String(args[0].lang || '');
    } else {
      code = String(args[0] || '');
      infostring = String(args[1] || '');
    }

    const lang = String(infostring || '').trim().split(/\s+/)[0]?.toLowerCase();
    if (lang === 'mermaid') {
      return `<div class="mermaid">${escapeHtml(code)}</div>`;
    }
    const klass = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    return `<pre><code${klass}>${escapeHtml(code)}</code></pre>`;
  };

  marked.setOptions({
    gfm: true,
    breaks: false,
    headerIds: false,
    mangle: false,
    renderer
  });

  return marked;
}

const markedInstance = buildMarkedInstance();

function renderMarkdownToHtml(markdown) {
  const raw = markedInstance.parse(String(markdown || ''));
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true }
  });
}

function MarkdownPane({ title, markdown, testId }) {
  const { theme } = useTheme();
  const containerRef = useRef(null);

  const html = useMemo(() => renderMarkdownToHtml(markdown), [markdown]);

  useEffect(() => {
    const mermaidTheme = theme === 'dark' ? 'dark' : 'default';
    if (lastMermaidTheme !== mermaidTheme) {
      lastMermaidTheme = mermaidTheme;
      mermaid.initialize({
        startOnLoad: false,
        theme: mermaidTheme,
        securityLevel: 'strict'
      });
    }
  }, [theme]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const nodes = root.querySelectorAll('.mermaid');
    if (!nodes.length) return;

    (async () => {
      try {
        await mermaid.run({ nodes });
      } catch (error) {
        // Mermaid rendering is best-effort; if it fails, leave raw text visible.
        // eslint-disable-next-line no-console
        console.warn('Mermaid render failed:', error);
      }
    })();
  }, [html]);

  return (
    <div className="md-pane">
      <div className="md-pane-header">
        <span className="md-pane-title">{title}</span>
      </div>
      <div
        ref={containerRef}
        className="md-pane-body markdown-rendered"
        data-testid={testId}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export default function MarkdownSideBySide({ oldText, newText }) {
  return (
    <div className="md-side-by-side" data-testid="markdown-side-by-side">
      <MarkdownPane title="Original" markdown={oldText} testId="markdown-original" />
      <MarkdownPane title="Changed" markdown={newText} testId="markdown-changed" />
    </div>
  );
}
