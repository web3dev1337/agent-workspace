import React, { useState } from 'react';
import './CollapsibleHeader.css';

const CollapsibleHeader = ({ metadata, diff, onToggleView, showSemanticView }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [showAI, setShowAI] = useState(false);

  const pr = metadata?.pr;
  const stats = diff?.stats;
  
  // Extract owner/repo from the URL or metadata
  const owner = metadata?.owner || window.location.pathname.split('/')[2];
  const repo = metadata?.repo || window.location.pathname.split('/')[3];

  return (
    <div className="collapsible-header">
      {/* Minimal always-visible bar */}
      <div className="header-bar">
        <div className="header-left">
          <h2 className="pr-title">
            Diff Viewer 
            {pr && (
              <>
                {' • '}
                <a 
                  href={`https://github.com/${owner}/${repo}/pull/${pr.number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pr-link"
                  title="Open in GitHub"
                >
                  PR #{pr.number}: {pr.title}
                </a>
              </>
            )}
          </h2>
          {stats && (
            <div className="quick-stats">
              <span className="stat-badge additions">+{stats.additions}</span>
              <span className="stat-badge deletions">-{stats.deletions}</span>
              <span className="stat-badge files">{stats.files} files</span>
            </div>
          )}
        </div>
        
        <div className="header-actions">
          <button 
            className="toggle-btn"
            onClick={() => onToggleView(!showSemanticView)}
            title="Toggle semantic/raw view (S)"
          >
            {showSemanticView ? '📊' : '📝'}
          </button>
          
          <button 
            className="toggle-btn"
            onClick={() => setShowAI(!showAI)}
            title="AI Analysis"
          >
            🤖
          </button>
          
          <button 
            className="toggle-btn"
            onClick={() => setShowDetails(!showDetails)}
            title="More options"
          >
            {showDetails ? '▼' : '▶'}
          </button>
        </div>
      </div>

      {/* Collapsible details section */}
      {showDetails && (
        <div className="header-details">
          <div className="pr-meta">
            {pr && (
              <>
                <span>by <span className="author">{pr.user}</span></span>
                <span className="branch">{pr.base} ← {pr.head}</span>
                <span>{new Date(pr.created_at).toLocaleDateString()}</span>
              </>
            )}
          </div>
          
          <div className="export-options">
            <button className="export-btn">📄 PDF</button>
            <button className="export-btn">📝 Markdown</button>
            <button className="export-btn">🔗 Share</button>
          </div>
        </div>
      )}

      {/* AI Analysis popup */}
      {showAI && (
        <div className="ai-popup">
          <div className="ai-header">
            <h3>AI Analysis</h3>
            <button onClick={() => setShowAI(false)} className="close-btn">✕</button>
          </div>
          <div className="ai-content">
            <p className="ai-placeholder">
              AI-powered analysis would appear here. 
              Enable with CLAUDE_API_KEY in .env
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollapsibleHeader;