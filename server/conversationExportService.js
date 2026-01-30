const sanitizeFilename = (value) => String(value || '')
  .trim()
  .replace(/[^a-zA-Z0-9._-]+/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '');

const renderMessageContentToText = (content) => {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (!part) return '';
      if (typeof part === 'string') return part;
      if (part.type === 'text') return String(part.text || '');
      if (part.type === 'tool_use') return `[tool_use:${part.name || ''}]`;
      if (part.type === 'tool_result') return `[tool_result]`;
      return `[${String(part.type || 'part')}]`;
    }).filter(Boolean).join('\n');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  return String(content);
};

const formatConversationAsMarkdown = (conversation) => {
  const conv = conversation && typeof conversation === 'object' ? conversation : {};
  const headerLines = [];

  const title = String(conv.project || conv.gitRepo || conv.cwd || conv.id || 'Conversation').trim();
  headerLines.push(`# ${title}`);

  const meta = {
    id: conv.id || conv.sessionId || null,
    source: conv.source || null,
    model: conv.model || null,
    branch: conv.branch || null,
    cwd: conv.cwd || null,
    gitRepo: conv.gitRepo || null,
    firstTimestamp: conv.firstTimestamp || null,
    lastTimestamp: conv.lastTimestamp || null
  };

  const metaLines = Object.entries(meta)
    .filter(([, v]) => v != null && String(v).trim().length > 0)
    .map(([k, v]) => `- **${k}**: ${String(v)}`);

  if (metaLines.length) {
    headerLines.push('');
    headerLines.push('## Meta');
    headerLines.push(...metaLines);
  }

  const messages = Array.isArray(conv.messages) ? conv.messages : [];
  headerLines.push('');
  headerLines.push(`## Messages (${messages.length})`);

  const bodyLines = [];
  for (const msg of messages) {
    const role = String(msg?.role || 'unknown');
    const ts = msg?.timestamp ? String(msg.timestamp) : '';
    bodyLines.push('');
    bodyLines.push(`### ${role}${ts ? ` (${ts})` : ''}`);
    bodyLines.push('');
    const text = renderMessageContentToText(msg?.content);
    bodyLines.push('```');
    bodyLines.push(String(text || '').replace(/\r\n/g, '\n'));
    bodyLines.push('```');
  }

  return [...headerLines, ...bodyLines].join('\n').trim() + '\n';
};

module.exports = {
  sanitizeFilename,
  formatConversationAsMarkdown
};

