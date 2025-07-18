import React, { useState, useEffect } from 'react';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import './AISummary.css';

const AISummary = ({ diffData, metadata, type }) => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const { owner, repo } = parseGitHubInfo(metadata);
  const id = metadata.number || metadata.sha;

  useEffect(() => {
    // Listen for AI summary updates via WebSocket
    const handleSummaryUpdate = (event) => {
      if (event.detail && event.detail.type === 'ai-summary') {
        setSummary(event.detail.data);
      }
    };

    window.addEventListener('diff-update', handleSummaryUpdate);
    return () => window.removeEventListener('diff-update', handleSummaryUpdate);
  }, []);

  const generateSummary = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post('/api/ai/generate', {
        type,
        owner,
        repo,
        id,
        diffData,
        metadata
      });

      setSummary(response.data);
    } catch (err) {
      console.error('Failed to generate AI summary:', err);
      setError(err.response?.data?.message || 'Failed to generate summary');
    } finally {
      setLoading(false);
    }
  };

  const getRiskIcon = (severity) => {
    switch (severity) {
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  };

  const getRiskTypeIcon = (type) => {
    switch (type) {
      case 'security': return '🔒';
      case 'performance': return '⚡';
      case 'complexity': return '🧩';
      case 'testing': return '🧪';
      default: return '📋';
    }
  };

  if (!summary && !loading && !error) {
    return (
      <div className="ai-summary-prompt">
        <h3>AI-Powered Analysis</h3>
        <p>Get an intelligent summary of this {type === 'pr' ? 'pull request' : 'commit'} with risk analysis.</p>
        <button 
          className="generate-summary-btn"
          onClick={generateSummary}
        >
          🤖 Generate AI Summary
        </button>
      </div>
    );
  }

  return (
    <div className="ai-summary-container">
      <div className="ai-summary-header" onClick={() => setExpanded(!expanded)}>
        <h3>
          🤖 AI Analysis
          {summary && summary.stats && (
            <span className="summary-stats">
              {summary.stats.filesAnalyzed} files analyzed
              {summary.stats.semanticReduction > 0 && 
                ` • ${summary.stats.semanticReduction}% reduction`}
            </span>
          )}
        </h3>
        <button className="expand-toggle">
          {expanded ? '▼' : '▶'}
        </button>
      </div>

      {expanded && (
        <div className="ai-summary-content">
          {loading && (
            <div className="summary-loading">
              <LoadingSpinner message="Analyzing changes..." size="small" />
            </div>
          )}

          {error && (
            <div className="summary-error">
              <p>❌ {error}</p>
              <button onClick={generateSummary}>Retry</button>
            </div>
          )}

          {summary && (
            <>
              <div className="summary-text">
                <h4>Summary</h4>
                <div className="summary-content">
                  {summary.summary.split('\n').map((paragraph, idx) => (
                    paragraph.trim() && <p key={idx}>{paragraph}</p>
                  ))}
                </div>
              </div>

              {summary.risks && summary.risks.length > 0 && (
                <div className="risk-analysis">
                  <h4>Risk Analysis</h4>
                  <div className="risk-list">
                    {summary.risks.map((risk, idx) => (
                      <div key={idx} className={`risk-item ${risk.severity}`}>
                        <span className="risk-icon">
                          {getRiskIcon(risk.severity)} {getRiskTypeIcon(risk.type)}
                        </span>
                        <div className="risk-details">
                          <div className="risk-description">{risk.description}</div>
                          {risk.file && (
                            <div className="risk-file">{risk.file}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="summary-footer">
                Generated {new Date(summary.generatedAt).toLocaleTimeString()}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Helper to parse GitHub info from metadata
function parseGitHubInfo(metadata) {
  // Try to extract from various metadata formats
  if (metadata.base && metadata.base.repo) {
    return {
      owner: metadata.base.repo.owner.login,
      repo: metadata.base.repo.name
    };
  }
  
  // Fallback parsing from URL or other fields
  return {
    owner: 'unknown',
    repo: 'unknown'
  };
}

export default AISummary;