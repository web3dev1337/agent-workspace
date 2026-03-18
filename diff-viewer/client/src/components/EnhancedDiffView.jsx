import React from 'react';
import DiffEditor from '@monaco-editor/react';
import SmartDiffView from './SmartDiffView';
import './EnhancedDiffView.css';
import { useTheme } from '../context/theme';

const EnhancedDiffView = ({ file, diffData }) => {
  // Handle different diff types
  switch (diffData.type) {
    case 'binary':
      return <BinaryDiffView file={file} diff={diffData.diff} />;
    
    case 'minified':
      return <MinifiedDiffView file={file} diff={diffData.diff} />;
    
    case 'structured':
      return <StructuredDiffView file={file} diff={diffData.diff} />;
    
    case 'semantic':
      // Use SmartDiffView for semantic diffs with advanced analysis
      if (diffData.refactorings || diffData.movedBlocks || diffData.netNewLogic !== undefined) {
        return <SmartDiffView analysis={diffData} file={file} />;
      }
      // Fall through to standard view if no advanced analysis
    case 'text':
    default:
      return <StandardDiffView file={file} diffData={diffData} />;
  }
};

const BinaryDiffView = ({ file, diff }) => {
  if (diff.status === 'unchanged') {
    return (
      <div className="binary-diff-view">
        <div className="binary-unchanged">
          <span className="icon">✓</span>
          {diff.message}
        </div>
      </div>
    );
  }

  return (
    <div className="binary-diff-view">
      <div className="binary-header">
        <h3>Binary File Changes</h3>
        <span className="file-type">{diff.fileType}</span>
      </div>
      
      <div className="binary-changes">
        {diff.changes.map((change, idx) => (
          <div key={idx} className={`change-row ${change.changeType}`}>
            <span className="change-label">{change.label}:</span>
            <span className="old-value">{change.oldValue}</span>
            <span className="arrow">→</span>
            <span className="new-value">{change.newValue}</span>
            {change.diff && (
              <span className={`diff-badge ${change.changeType}`}>
                {change.diff}
              </span>
            )}
          </div>
        ))}
      </div>
      
      {diff.summary && (
        <div className="binary-summary">
          <p>{diff.summary}</p>
        </div>
      )}
    </div>
  );
};

const MinifiedDiffView = ({ file, diff }) => {
  return (
    <div className="minified-diff-view">
      <div className="minified-header">
        <h3>Minified File Changes</h3>
        <span className="suggestion">{diff.suggestion}</span>
      </div>
      
      <div className="token-stats">
        <div className="stat">
          <span className="label">Tokens Added:</span>
          <span className="value additions">+{diff.tokenDiff.stats.tokensAdded}</span>
        </div>
        {diff.tokenDiff.stats.tokensRemoved > 0 && (
          <div className="stat">
            <span className="label">Tokens Removed:</span>
            <span className="value deletions">-{diff.tokenDiff.stats.tokensRemoved}</span>
          </div>
        )}
        <div className="stat">
          <span className="label">Total Tokens:</span>
          <span className="value">{diff.tokenDiff.stats.totalNewTokens}</span>
        </div>
      </div>
      
      <div className="token-changes">
        <h4>Key Changes (Token Level)</h4>
        {diff.displayChunks.map((chunk, idx) => (
          <div key={idx} className={`token-chunk ${chunk.type}`}>
            <span className="chunk-type">{chunk.type}:</span>
            <code className="chunk-content">{chunk.content}</code>
            {chunk.isLarge && (
              <span className="chunk-info">({chunk.tokenCount} tokens total)</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const StructuredDiffView = ({ file, diff }) => {
  const { type, summary, complexity, grouped, stats } = diff;
  
  return (
    <div className="structured-diff-view">
      <div className="structured-header">
        <h3>{type.toUpperCase()} Structure Changes</h3>
        <span className={`complexity-badge ${complexity}`}>{complexity}</span>
      </div>
      
      <div className="structure-summary">
        <p>{summary}</p>
      </div>
      
      <div className="structure-changes">
        {grouped.added.length > 0 && (
          <div className="change-group additions">
            <h4>Added Keys ({grouped.added.length})</h4>
            {grouped.added.map((change, idx) => (
              <div key={idx} className="structure-change">
                <span className="path">{change.path}</span>
                <span className="value">{change.newValueStr}</span>
              </div>
            ))}
          </div>
        )}
        
        {grouped.removed.length > 0 && (
          <div className="change-group deletions">
            <h4>Removed Keys ({grouped.removed.length})</h4>
            {grouped.removed.map((change, idx) => (
              <div key={idx} className="structure-change">
                <span className="path">{change.path}</span>
                <span className="value">{change.oldValueStr}</span>
              </div>
            ))}
          </div>
        )}
        
        {grouped.modified.length > 0 && (
          <div className="change-group modifications">
            <h4>Modified Values ({grouped.modified.length})</h4>
            {grouped.modified.map((change, idx) => (
              <div key={idx} className="structure-change">
                <span className="path">{change.path}</span>
                <div className="value-change">
                  <span className="old">{change.oldValueStr}</span>
                  <span className="arrow">→</span>
                  <span className="new">{change.newValueStr}</span>
                  {change.typeChange && (
                    <span className="type-change">Type changed!</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const StandardDiffView = ({ file, diffData }) => {
  const { theme } = useTheme();
  // If we have a patch, show it as a unified diff
  if (file.patch) {
    const lines = file.patch.split('\n');
    return (
      <div className="standard-diff-view" style={{ height: '100%', overflow: 'auto', backgroundColor: 'var(--bg-primary)' }}>
        <div style={{ padding: '20px', fontFamily: 'Consolas, Monaco, monospace', fontSize: '13px', color: 'var(--text-primary)' }}>
          {lines.map((line, idx) => {
            let className = '';
            let style = {
              margin: 0,
              padding: '2px 5px',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word'
            };
            
            if (line.startsWith('+')) {
              className = 'added';
              style.backgroundColor = 'var(--diff-added-bg)';
              style.color = 'var(--text-primary)';
            } else if (line.startsWith('-')) {
              className = 'deleted';
              style.backgroundColor = 'var(--diff-removed-bg)';
              style.color = 'var(--text-primary)';
            } else if (line.startsWith('@@')) {
              className = 'hunk-header';
              style.backgroundColor = 'var(--diff-hunk-bg)';
              style.color = 'var(--text-primary)';
              style.fontWeight = 'bold';
            } else {
              style.color = 'var(--text-primary)';
            }
            
            return (
              <div key={idx} className={className} style={style}>
                {line || ' '}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  
  // Fallback to Monaco editor if we have old/new content
  const oldContent = file.oldContent || '';
  const newContent = file.newContent || '';
  
  return (
    <DiffEditor
      height="100%"
      theme={theme === 'light' ? 'vs' : 'vs-dark'}
      original={oldContent}
      modified={newContent}
      language={getLanguageFromPath(file.path || file.filename)}
      options={{
        readOnly: true,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
        minimap: { enabled: false }
      }}
    />
  );
};

const getLanguageFromPath = (path) => {
  const ext = path.split('.').pop().toLowerCase();
  const langMap = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    css: 'css',
    html: 'html'
  };
  return langMap[ext] || 'plaintext';
};

export default EnhancedDiffView;
